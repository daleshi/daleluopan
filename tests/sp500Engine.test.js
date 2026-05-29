'use strict';

/**
 * 标普 500 投资策略引擎 — 单元测试
 */

jest.mock('../services/dataFetcher', () => ({
    fetchHistoryKlines: jest.fn(),
}));
jest.mock('../services/fundFetcher', () => ({
    fetchEastmoneyFundData: jest.fn(),
}));
jest.mock('../services/etfFetcher', () => ({
    fetchETFIopvBySecid: jest.fn(),
}));

const {
    computePriceDrawdown5Y,
    matchOffsiteTier,
    matchOnsiteSignal,
    evaluatePremiumGate,
    computeRecommendation,
} = require('../services/sp500StrategyEngine');
const { fetchHistoryKlines } = require('../services/dataFetcher');
const { fetchEastmoneyFundData } = require('../services/fundFetcher');
const { fetchETFIopvBySecid } = require('../services/etfFetcher');

const DEFAULT_STRATEGY = {
    name: '标普500投资策略',
    indexCode: 'SPX',
    indexSecid: '100.SPX',
    offsite: {
        fundCode: '017641',
        fundName: '摩根标普500',
        monthlyAmount: 1000,
        tiers: [
            { id: 'pause',  label: '暂停', color: 'purple', multiplier: 0,   drawdownLt: 3 },
            { id: 'half',   label: '减半', color: 'yellow', multiplier: 50,  drawdownLt: 10 },
            { id: 'normal', label: '正常', color: 'green',  multiplier: 100, drawdownLt: 20 },
            { id: 'double', label: '加倍', color: 'red',    multiplier: 200, drawdownLt: null },
        ],
    },
    onsite: {
        etfCode: '513500',
        etfName: '博时标普500',
        etfSecid: '1.513500',
        signals: [
            { id: 'idle',   label: '未到时机', color: 'gray',   amount: 0,     drawdownLt: 3 },
            { id: 'watch',  label: '可关注',   color: 'yellow', amount: 5000,  drawdownLt: 10 },
            { id: 'buy',    label: '可加仓',   color: 'orange', amount: 10000, drawdownLt: 20 },
            { id: 'strong', label: '强烈加仓', color: 'red',    amount: 15000, drawdownLt: null },
        ],
        premiumGate: { fullPassMaxPct: 0.5, halfPassMaxPct: 1.5 },
    },
};

function buildKlines(days, closeFn) {
    const oneDay = 24 * 3600 * 1000;
    const start = Date.now() - days * oneDay;
    const arr = [];
    for (let i = 0; i < days; i++) {
        const ts = start + i * oneDay;
        arr.push({ date: new Date(ts).toISOString().split('T')[0], close: parseFloat(closeFn(i, days).toFixed(4)) });
    }
    return arr;
}

describe('SP500 Engine — computePriceDrawdown5Y', () => {
    it('空数组返回全 null', () => {
        const r = computePriceDrawdown5Y([]);
        expect(r.drawdownFromPeak5Y).toBeNull();
    });

    it('数据点 < 60 → null', () => {
        const r = computePriceDrawdown5Y(buildKlines(50, () => 100));
        expect(r.drawdownFromPeak5Y).toBeNull();
    });

    it('单调上升 → drawdown = 0', () => {
        const r = computePriceDrawdown5Y(buildKlines(100, (i) => 100 + i * 0.5));
        expect(r.drawdownFromPeak5Y).toBe(0);
    });

    it('5500 高点 / 4900 当前 → drawdown ≈ 10.91', () => {
        const klines = buildKlines(100, (i) => {
            if (i <= 10) return 5000 + i * 50;
            return 5500 - (i - 10) * (600 / 89);
        });
        const r = computePriceDrawdown5Y(klines);
        expect(r.peakClose5Y).toBeCloseTo(5500, 0);
        expect(r.drawdownFromPeak5Y).toBeGreaterThan(10);
        expect(r.drawdownFromPeak5Y).toBeLessThan(12);
    });

    it('容忍非法 close 字段', () => {
        const klines = buildKlines(100, (i) => 100 + i);
        klines[10].close = null;
        klines[20].close = NaN;
        const r = computePriceDrawdown5Y(klines);
        expect(r.drawdownFromPeak5Y).not.toBeNull();
    });
});

describe('SP500 Engine — matchOffsiteTier', () => {
    const tiers = DEFAULT_STRATEGY.offsite.tiers;

    it.each([
        [1.5, 'pause'], [2.99, 'pause'],
        [3, 'half'], [9.99, 'half'],
        [10, 'normal'], [19.99, 'normal'],
        [20, 'double'], [60, 'double'],
    ])('drawdown=%f → %s', (d, id) => {
        expect(matchOffsiteTier(d, tiers).hitTier?.id).toBe(id);
    });

    it('drawdown=null → 兜底 double', () => {
        expect(matchOffsiteTier(null, tiers).hitTier?.id).toBe('double');
    });

    it('tierScans 命中后续标"已被前置规则命中"', () => {
        const r = matchOffsiteTier(6, tiers);
        expect(r.tierScans).toHaveLength(4);
        expect(r.tierScans[1].hit).toBe(true);
        expect(r.tierScans[2].summary).toBe('已被前置规则命中');
    });
});

describe('SP500 Engine — matchOnsiteSignal', () => {
    const signals = DEFAULT_STRATEGY.onsite.signals;

    it.each([
        [1.5, 'idle'], [3, 'watch'], [10, 'buy'], [20, 'strong'],
    ])('drawdown=%f → %s', (d, id) => {
        expect(matchOnsiteSignal(d, signals).hitSignal?.id).toBe(id);
    });

    it('共享回撤边界（同档对应）', () => {
        const tiers = DEFAULT_STRATEGY.offsite.tiers;
        const map = { pause: 'idle', half: 'watch', normal: 'buy', double: 'strong' };
        for (const dwn of [1.5, 6, 14, 32]) {
            const off = matchOffsiteTier(dwn, tiers);
            const on = matchOnsiteSignal(dwn, signals);
            expect(map[off.hitTier.id]).toBe(on.hitSignal.id);
        }
    });
});

describe('SP500 Engine — evaluatePremiumGate', () => {
    const gate = DEFAULT_STRATEGY.onsite.premiumGate;

    it('溢价 0.3% → fullPass，全额', () => {
        const r = evaluatePremiumGate(0.3, gate, 10000);
        expect(r.status).toBe('fullPass');
        expect(r.suggestedAmount).toBe(10000);
    });

    it('溢价 0.8% → halfPass，半额 5000', () => {
        const r = evaluatePremiumGate(0.8, gate, 10000);
        expect(r.status).toBe('halfPass');
        expect(r.suggestedAmount).toBe(5000);
    });

    it('溢价 2.5% → blocked，金额 0', () => {
        const r = evaluatePremiumGate(2.5, gate, 10000);
        expect(r.status).toBe('blocked');
        expect(r.suggestedAmount).toBe(0);
        expect(r.message).toMatch(/建议改买场外/);
    });

    it('溢价 null → iopvUnavailable，全额放行', () => {
        const r = evaluatePremiumGate(null, gate, 10000);
        expect(r.status).toBe('iopvUnavailable');
        expect(r.suggestedAmount).toBe(10000);
        expect(r.value).toBeNull();
    });

    it('baseAmount=0 时所有 status 下都是 0', () => {
        for (const p of [0.3, 0.8, 2.5, null]) {
            expect(evaluatePremiumGate(p, gate, 0).suggestedAmount).toBe(0);
        }
    });

    it('边界 — fullMax=0.5 不命中 fullPass（严格 <）', () => {
        expect(evaluatePremiumGate(0.5, gate, 10000).status).toBe('halfPass');
    });

    it('边界 — halfMax=1.5 不命中 halfPass，落 blocked', () => {
        expect(evaluatePremiumGate(1.5, gate, 10000).status).toBe('blocked');
    });
});

describe('SP500 Engine — computeRecommendation 集成', () => {
    beforeEach(() => jest.clearAllMocks());

    it('strategy=null → 返回 error 不抛', async () => {
        const r = await computeRecommendation(null);
        expect(r.error).toBeDefined();
        expect(r.stale).toBe(true);
    });

    it('数据全齐 — 14% 回撤 → 场外 normal / 场内 buy / 溢价全额放行', async () => {
        const klines = buildKlines(100, (i) => {
            if (i <= 10) return 5000 + i * 50;
            return 5500 - (i - 10) * (770 / 89);
        });
        fetchHistoryKlines.mockResolvedValue(klines);
        fetchEastmoneyFundData.mockResolvedValue({ latestNav: 1.234, latestNavDate: '2026-05-29' });
        fetchETFIopvBySecid.mockResolvedValue({ price: 1.510, iopv: 1.504, premiumPct: 0.3, name: 'ETF' });

        const r = await computeRecommendation(DEFAULT_STRATEGY);
        expect(r.stale).toBe(false);
        expect(r.drawdownFromPeak5Y).toBeGreaterThan(13);
        expect(r.offsite.hitTier.id).toBe('normal');
        expect(r.offsite.actualAmount).toBe(1000);
        expect(r.onsite.hitSignal.id).toBe('buy');
        expect(r.onsite.premium.status).toBe('fullPass');
        expect(r.onsite.suggestedAmount).toBe(10000);
    });

    it('指数 K 线失败 → 顶层 stale + 场外 normal 兜底 + 场内 idle', async () => {
        fetchHistoryKlines.mockResolvedValue([]);
        fetchEastmoneyFundData.mockResolvedValue({ latestNav: 1.234 });
        fetchETFIopvBySecid.mockResolvedValue({ price: 1.5, iopv: 1.49, premiumPct: 0.6 });

        const r = await computeRecommendation(DEFAULT_STRATEGY);
        expect(r.stale).toBe(true);
        expect(r.drawdownFromPeak5Y).toBeNull();
        expect(r.offsite.hitTier.id).toBe('normal');
        expect(r.onsite.hitSignal.id).toBe('idle');
        expect(r.onsite.suggestedAmount).toBe(0);
    });

    it('ETF 行情失败 → 场外正常 / 场内 stale + iopvUnavailable + 全额放行', async () => {
        const klines = buildKlines(100, (i) => 5500 - i * 8);
        fetchHistoryKlines.mockResolvedValue(klines);
        fetchEastmoneyFundData.mockResolvedValue({ latestNav: 1.234 });
        fetchETFIopvBySecid.mockResolvedValue(null);

        const r = await computeRecommendation(DEFAULT_STRATEGY);
        expect(r.stale).toBe(false);
        expect(r.offsite.stale).toBe(false);
        expect(r.onsite.stale).toBe(true);
        expect(r.onsite.premium.status).toBe('iopvUnavailable');
        expect(r.onsite.suggestedAmount).toBeGreaterThan(0); // 仍按基础金额放行
    });

    it('摩根净值失败 → 场外 stale / 场内正常', async () => {
        const klines = buildKlines(100, (i) => 5000 + i * 0.5);
        fetchHistoryKlines.mockResolvedValue(klines);
        fetchEastmoneyFundData.mockResolvedValue(null);
        fetchETFIopvBySecid.mockResolvedValue({ price: 1.5, iopv: 1.495, premiumPct: 0.3 });

        const r = await computeRecommendation(DEFAULT_STRATEGY);
        expect(r.stale).toBe(false);
        expect(r.offsite.stale).toBe(true);
        expect(r.onsite.stale).toBe(false);
    });

    it('深熊 32% 回撤 + 高溢价 2.5% → 场外加倍 / 场内 strong + 拦截', async () => {
        const klines = buildKlines(100, (i) => {
            if (i <= 10) return 5000 + i * 50;
            return 5500 - (i - 10) * (1760 / 89); // 跌到 ~3740 ≈ 32%
        });
        fetchHistoryKlines.mockResolvedValue(klines);
        fetchEastmoneyFundData.mockResolvedValue({ latestNav: 1.0 });
        fetchETFIopvBySecid.mockResolvedValue({ price: 1.025, iopv: 1.000, premiumPct: 2.5 });

        const r = await computeRecommendation(DEFAULT_STRATEGY);
        expect(r.offsite.hitTier.id).toBe('double');
        expect(r.offsite.actualAmount).toBe(2000);
        expect(r.onsite.hitSignal.id).toBe('strong');
        expect(r.onsite.baseAmount).toBe(15000);
        expect(r.onsite.premium.status).toBe('blocked');
        expect(r.onsite.suggestedAmount).toBe(0);
    });
});
