'use strict';

/**
 * 主动基金定投策略规则引擎 — 单元测试
 * 不依赖 HTTP 服务，可独立运行。
 */

// Mock fundFetcher 以避免 computeRecommendations 真实联网
jest.mock('../services/fundFetcher', () => ({
    fetchEastmoneyFundData: jest.fn(),
    fetchTiantianFundData: jest.fn(),
}));
jest.mock('../services/dataFetcher', () => ({
    fetchDanjuanEvaluation: jest.fn(),
}));

const {
    computeFundIndicators,
    evaluateCondition,
    evaluateRule,
    matchStrategy,
    pickBenchmarkEvaluation,
    computeRecommendations,
    ALLOWED_FIELDS,
} = require('../services/activeFundStrategyEngine');
const { fetchEastmoneyFundData } = require('../services/fundFetcher');
const { fetchDanjuanEvaluation } = require('../services/dataFetcher');

describe('ActiveFund Engine — computeFundIndicators', () => {
    it('空序列返回全 null', () => {
        const r = computeFundIndicators([]);
        expect(r.drawdownAbs).toBeNull();
        expect(r.gain3m).toBeNull();
        expect(r.gain6m).toBeNull();
        expect(r.gain1y).toBeNull();
        expect(r.distanceToYearHighPct).toBeNull();
        expect(r.peakNav1Y).toBeNull();
    });

    it('正常序列计算回撤、3月、6月涨幅', () => {
        // 构造 365 天数据：第一天 1.0，第 100 天 2.0（峰值），最新 1.5
        const oneDay = 24 * 3600 * 1000;
        const now = Date.now();
        const points = [];
        for (let i = 365; i >= 0; i--) {
            const ts = now - i * oneDay;
            // 先升后跌：到达 day -265 (i=100)前后是峰值
            let nav;
            if (i > 265) nav = 1.0 + (365 - i) * 0.01;          // 升到 ~2.0
            else nav = 2.0 - (265 - i) * (0.5 / 265);            // 慢跌到 ~1.5
            points.push({ date: ts, nav: parseFloat(nav.toFixed(4)) });
        }
        const r = computeFundIndicators(points);
        expect(r.drawdownAbs).not.toBeNull();
        expect(r.drawdownAbs).toBeGreaterThan(0);
        expect(r.gain3m).not.toBeNull();
        expect(r.gain6m).not.toBeNull();
        expect(r.latestNav).toBeCloseTo(1.5, 1);
    });

    it('容忍非法字段：缺 nav 或 date 的点被忽略', () => {
        const oneDay = 24 * 3600 * 1000;
        const now = Date.now();
        const points = [
            { date: now - 10 * oneDay, nav: 1.0 },
            { date: now - 5 * oneDay,  nav: null },
            { date: null,              nav: 1.5 },
            { date: now,               nav: 1.2 },
        ];
        const r = computeFundIndicators(points);
        expect(r.latestNav).toBe(1.2);
        expect(r.peakNav).toBeGreaterThanOrEqual(1.2);
    });
});

describe('ActiveFund Engine — evaluateCondition', () => {
    const ind = { indexPePercentile: 92.08, fundDrawdownAbs: 5.47, fundGain3M: 8.33 };

    it.each([
        [{ field: 'indexPePercentile', op: '>=', value: 90 }, true],
        [{ field: 'indexPePercentile', op: '>=', value: 95 }, false],
        [{ field: 'indexPePercentile', op: '<=', value: 90 }, false],
        [{ field: 'indexPePercentile', op: '<',  value: 95 }, true],
        [{ field: 'fundGain3M',        op: '>=', value: 5  }, true],
        [{ field: 'fundGain3M',        op: '==', value: 8.33 }, true],
    ])('%j → %s', (cond, expected) => {
        expect(evaluateCondition(cond, ind)).toBe(expected);
    });

    it('未知 field 返回 false', () => {
        expect(evaluateCondition({ field: 'unknownField', op: '>=', value: 0 }, ind)).toBe(false);
    });

    it('未知 op 返回 false', () => {
        expect(evaluateCondition({ field: 'fundGain3M', op: '!=', value: 0 }, ind)).toBe(false);
    });

    it('指标缺失返回 null（视为不命中）', () => {
        expect(evaluateCondition({ field: 'fundGain6M', op: '>=', value: 5 }, ind)).toBeNull();
    });
});

describe('ActiveFund Engine — evaluateRule', () => {
    const ind = { indexPePercentile: 85, fundGain3M: 18 };

    it('AND：全部条件命中', () => {
        const rule = {
            logic: 'AND',
            conditions: [
                { field: 'indexPePercentile', op: '>=', value: 80 },
                { field: 'indexPePercentile', op: '<',  value: 90 },
                { field: 'fundGain3M',        op: '>=', value: 15 },
            ],
        };
        expect(evaluateRule(rule, ind)).toBe(true);
    });

    it('AND：任一条件不命中即整体不命中', () => {
        const rule = {
            logic: 'AND',
            conditions: [
                { field: 'indexPePercentile', op: '>=', value: 90 }, // 不命中
                { field: 'fundGain3M',        op: '>=', value: 15 },
            ],
        };
        expect(evaluateRule(rule, ind)).toBe(false);
    });

    it('OR：任一条件命中即整体命中', () => {
        const rule = {
            logic: 'OR',
            conditions: [
                { field: 'indexPePercentile', op: '>=', value: 90 }, // 不命中
                { field: 'fundGain3M',        op: '>=', value: 15 }, // 命中
            ],
        };
        expect(evaluateRule(rule, ind)).toBe(true);
    });

    it('OR：所有条件都不命中', () => {
        const rule = {
            logic: 'OR',
            conditions: [
                { field: 'indexPePercentile', op: '>=', value: 90 },
                { field: 'fundGain3M',        op: '>=', value: 50 },
            ],
        };
        expect(evaluateRule(rule, ind)).toBe(false);
    });

    it('空 conditions 数组永远命中（兜底）', () => {
        expect(evaluateRule({ logic: 'AND', conditions: [] }, ind)).toBe(true);
        expect(evaluateRule({ logic: 'OR',  conditions: [] }, {}  )).toBe(true);
    });

    it('AND + 部分指标缺失：null 视为不命中', () => {
        const rule = {
            logic: 'AND',
            conditions: [
                { field: 'indexPePercentile', op: '>=', value: 80 },
                { field: 'fundGain6M',        op: '>=', value: 30 }, // 缺失
            ],
        };
        expect(evaluateRule(rule, ind)).toBe(false);
    });
});

describe('ActiveFund Engine — matchStrategy（命中即停）', () => {
    const strategy = {
        rules: [
            { id: 'pause', label: '暂停定投', color: 'purple', multiplier: 0, logic: 'OR',
                conditions: [{ field: 'indexPePercentile', op: '>=', value: 90 }] },
            { id: 'half', label: '减半定投', color: 'yellow', multiplier: 50, logic: 'AND',
                conditions: [
                    { field: 'indexPePercentile', op: '>=', value: 80 },
                    { field: 'indexPePercentile', op: '<',  value: 90 },
                ] },
            { id: 'double', label: '加倍定投', color: 'red', multiplier: 200, logic: 'AND',
                conditions: [
                    { field: 'indexPePercentile', op: '<=', value: 20 },
                    { field: 'fundDrawdownAbs',   op: '>=', value: 15 },
                ] },
            { id: 'normal', label: '正常定投', color: 'green', multiplier: 100, logic: 'AND', conditions: [] },
        ],
    };

    it('PE=92 命中暂停，剩余规则标记"已被前置规则命中"', () => {
        const r = matchStrategy(strategy, { indexPePercentile: 92 });
        expect(r.hitRule.id).toBe('pause');
        expect(r.ruleScans).toHaveLength(4);
        expect(r.ruleScans[0].hit).toBe(true);
        expect(r.ruleScans.slice(1).every(s => !s.hit)).toBe(true);
        expect(r.ruleScans[1].summary).toBe('已被前置规则命中');
    });

    it('PE=85 命中减半（暂停未触发）', () => {
        const r = matchStrategy(strategy, { indexPePercentile: 85 });
        expect(r.hitRule.id).toBe('half');
    });

    it('PE=15, 回撤 18% 命中加倍', () => {
        const r = matchStrategy(strategy, { indexPePercentile: 15, fundDrawdownAbs: 18 });
        expect(r.hitRule.id).toBe('double');
    });

    it('PE=15, 回撤 5%（不满足回撤阈值）→ 兜底正常档', () => {
        const r = matchStrategy(strategy, { indexPePercentile: 15, fundDrawdownAbs: 5 });
        expect(r.hitRule.id).toBe('normal');
    });

    it('PE=50（中性区）→ 兜底正常档', () => {
        const r = matchStrategy(strategy, { indexPePercentile: 50 });
        expect(r.hitRule.id).toBe('normal');
    });
});

describe('ActiveFund Engine — pickBenchmarkEvaluation', () => {
    const evaMap = {
        'SH000300': { name: '沪深300', pePercentile: 92.08 },
        'SZ399905': { name: '中证500', pePercentile: 30.5 },
    };

    it('使用 SH 前缀查找成功', () => {
        const r = pickBenchmarkEvaluation(evaMap, '000300');
        expect(r?.pePercentile).toBe(92.08);
    });

    it('使用 SZ 前缀查找成功', () => {
        const r = pickBenchmarkEvaluation(evaMap, '399905');
        expect(r?.pePercentile).toBe(30.5);
    });

    it('找不到返回 null', () => {
        expect(pickBenchmarkEvaluation(evaMap, '999999')).toBeNull();
    });

    it('空输入返回 null', () => {
        expect(pickBenchmarkEvaluation(null, '000300')).toBeNull();
        expect(pickBenchmarkEvaluation({}, null)).toBeNull();
    });
});

// ============================================================
// v2 新增测试 — 衍生指标 / 经理变更 / boost 档 / 默认规则验收
// ============================================================

/** 构造 N 天的净值序列 helper（按指定函数生成 nav 值） */
function buildNavSeries(days, navFn) {
    const oneDay = 24 * 3600 * 1000;
    const now = Date.now();
    const arr = [];
    for (let i = days - 1; i >= 0; i--) {
        arr.push({
            date: now - i * oneDay,
            nav: parseFloat(navFn(i, days).toFixed(4)),
        });
    }
    return arr;
}

describe('ActiveFund Engine v2 — fundGain1Y / fundDistanceToYearHighPct', () => {
    it('365+ 天序列正确计算 gain1y', () => {
        // 366 天：第 365 天前 nav=1.0，最新 nav=1.55 → gain1y ≈ 55%
        const points = buildNavSeries(366, (i) => {
            if (i === 365) return 1.0;
            return 1.0 + (365 - i) * (0.55 / 365);
        });
        const r = computeFundIndicators(points);
        expect(r.gain1y).not.toBeNull();
        expect(r.gain1y).toBeGreaterThan(50);
        expect(r.gain1y).toBeLessThan(60);
    });

    it('近1年最高净值 = 当前 → distanceToYearHighPct === 0', () => {
        // 365 天单调上升到当前最高
        const points = buildNavSeries(365, (i, days) => 1.0 + (days - 1 - i) * 0.001);
        const r = computeFundIndicators(points);
        expect(r.peakNav1Y).not.toBeNull();
        expect(r.distanceToYearHighPct).toBe(0);
    });

    it('当前距近1年高点 ≈ 1.5%', () => {
        // 365 天：先升到 2.0（i=200，约 165 天前），后跌到 1.97
        const points = buildNavSeries(365, (i) => {
            if (i > 200) return 1.0 + (365 - i) * (1.0 / 165);
            return 2.0 - (200 - i) * (0.03 / 200);
        });
        const r = computeFundIndicators(points);
        expect(r.peakNav1Y).toBeCloseTo(2.0, 1);
        expect(r.distanceToYearHighPct).toBeGreaterThan(1.0);
        expect(r.distanceToYearHighPct).toBeLessThan(2.0);
    });

    it('序列不足 60 天 → peakNav1Y / distanceToYearHighPct 全 null（gain1y 也 null）', () => {
        const points = buildNavSeries(50, () => 1.0);
        const r = computeFundIndicators(points);
        expect(r.peakNav1Y).toBeNull();
        expect(r.distanceToYearHighPct).toBeNull();
        expect(r.gain1y).toBeNull();
    });

    it('ALLOWED_FIELDS 包含 v2 新字段', () => {
        expect(ALLOWED_FIELDS).toContain('fundGain1Y');
        expect(ALLOWED_FIELDS).toContain('fundDistanceToYearHighPct');
    });
});

describe('ActiveFund Engine v2 — evaluateCondition 对新字段', () => {
    const ind = {
        fundGain1Y: 55.0,
        fundDistanceToYearHighPct: 1.2,
    };

    it('fundGain1Y > 50 命中', () => {
        expect(evaluateCondition({ field: 'fundGain1Y', op: '>', value: 50 }, ind)).toBe(true);
    });

    it('fundGain1Y > 60 不命中', () => {
        expect(evaluateCondition({ field: 'fundGain1Y', op: '>', value: 60 }, ind)).toBe(false);
    });

    it('fundDistanceToYearHighPct <= 2 命中', () => {
        expect(evaluateCondition({ field: 'fundDistanceToYearHighPct', op: '<=', value: 2 }, ind)).toBe(true);
    });

    it('字段缺失返回 null（视为不命中）', () => {
        expect(evaluateCondition({ field: 'fundGain1Y', op: '>', value: 50 }, {})).toBeNull();
    });
});

describe('ActiveFund Engine v2 — boost 档命中', () => {
    const strategy = {
        monthlyAmount: 1000,
        rules: [
            { id: 'pause', label: '暂停', color: 'purple', multiplier: 0, logic: 'OR',
                conditions: [{ field: 'indexPePercentile', op: '>=', value: 90 }] },
            { id: 'double', label: '加倍', color: 'red', multiplier: 200, logic: 'AND',
                conditions: [
                    { field: 'indexPePercentile', op: '<=', value: 20 },
                    { field: 'fundDrawdownAbs',   op: '>=', value: 20 },
                ] },
            { id: 'boost', label: '加强', color: 'blue', multiplier: 150, logic: 'AND',
                conditions: [
                    { field: 'indexPePercentile', op: '<=', value: 20 },
                    { field: 'fundDrawdownAbs',   op: '>=', value: 5 },
                    { field: 'fundDrawdownAbs',   op: '<',  value: 20 },
                ] },
            { id: 'normal', label: '正常', color: 'green', multiplier: 100, logic: 'AND', conditions: [] },
        ],
    };

    it('PE=15, 回撤=8 → 命中 boost', () => {
        const r = matchStrategy(strategy, { indexPePercentile: 15, fundDrawdownAbs: 8 });
        expect(r.hitRule.id).toBe('boost');
        expect(r.hitRule.color).toBe('blue');
        expect(r.hitRule.multiplier).toBe(150);
    });

    it('PE=15, 回撤=22 → 命中 double（boost 被跳过）', () => {
        const r = matchStrategy(strategy, { indexPePercentile: 15, fundDrawdownAbs: 22 });
        expect(r.hitRule.id).toBe('double');
    });

    it('boost 命中时计算金额 = monthlyAmount × 1.5', () => {
        // 这里仅验证 multiplier；actualAmount 在 computeRecommendations 中算
        const r = matchStrategy(strategy, { indexPePercentile: 15, fundDrawdownAbs: 8 });
        const monthlyAmount = strategy.monthlyAmount;
        const actualAmount = Math.round(monthlyAmount * r.hitRule.multiplier / 100);
        expect(actualAmount).toBe(1500);
    });
});

// ─── computeRecommendations 集成（mock 数据源） ─────────────
describe('ActiveFund Engine v2 — computeRecommendations 经理变更短路', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        // 默认 mock：沪深300 PE 分位 = 50（中性区）
        fetchDanjuanEvaluation.mockResolvedValue({
            'SH000300': { name: '沪深300', pe: 12, pePercentile: 50, date: '2026-05-27' },
        });
    });

    const buildStrategy = (managerName) => ({
        fundCode: '163415',
        fundName: '兴全商业模式 A',
        managerName,
        benchmarkIndex: '000300',
        benchmarkName: '沪深300',
        monthlyAmount: 1000,
        rules: [
            { id: 'normal', label: '正常', color: 'green', multiplier: 100, logic: 'AND', conditions: [] },
        ],
    });

    const navTrend365 = buildNavSeries(365, () => 1.0);

    it('实时经理与配置一致 → managerChanged=false，正常匹配', async () => {
        fetchEastmoneyFundData.mockResolvedValue({
            netWorthTrend: { all: navTrend365 },
            managers: [{ name: '乔迁' }],
        });
        const result = await computeRecommendations([buildStrategy('乔迁')]);
        const rec = result.recommendations[0];
        expect(rec.currentManager).toBe('乔迁');
        expect(rec.managerChanged).toBe(false);
        expect(rec.hitRule.id).toBe('normal');
    });

    it('实时经理 ≠ 配置 → 短路：hitRule.id=managerChanged，actualAmount=0', async () => {
        fetchEastmoneyFundData.mockResolvedValue({
            netWorthTrend: { all: navTrend365 },
            managers: [{ name: '李四' }],
        });
        const result = await computeRecommendations([buildStrategy('乔迁')]);
        const rec = result.recommendations[0];
        expect(rec.currentManager).toBe('李四');
        expect(rec.managerChanged).toBe(true);
        expect(rec.hitRule.id).toBe('managerChanged');
        expect(rec.hitRule.color).toBe('purple');
        expect(rec.actualAmount).toBe(0);
        expect(rec.triggerReason).toMatch(/基金经理已由 乔迁 变更为 李四/);
        // 原始 ruleScans 全部标记短路
        expect(rec.ruleScans.every(s => !s.hit && s.summary === '已被经理变更短路')).toBe(true);
    });

    it('实时经理为空 → managerChanged=false（不误暂停）', async () => {
        fetchEastmoneyFundData.mockResolvedValue({
            netWorthTrend: { all: navTrend365 },
            managers: [],
        });
        const result = await computeRecommendations([buildStrategy('乔迁')]);
        const rec = result.recommendations[0];
        expect(rec.currentManager).toBeNull();
        expect(rec.managerChanged).toBe(false);
        expect(rec.hitRule.id).toBe('normal');
    });

    it('配置 managerName 为空 → managerChanged=false（不比对）', async () => {
        fetchEastmoneyFundData.mockResolvedValue({
            netWorthTrend: { all: navTrend365 },
            managers: [{ name: '乔迁' }],
        });
        const result = await computeRecommendations([buildStrategy('')]);
        const rec = result.recommendations[0];
        expect(rec.managerChanged).toBe(false);
        expect(rec.hitRule.id).toBe('normal');
    });
});

// ─── v2 默认规则 — 关键验收场景（参照 specs 中 GIVEN/WHEN/THEN） ───
describe('ActiveFund Engine v2 — 大成睿享 A 默认规则验收', () => {
    // 大成 v2 规则（5 条业务 + 兜底 normal）：
    const daChengRules = [
        { id: 'pause', label: '暂停', color: 'purple', multiplier: 0, logic: 'OR',
            conditions: [
                { field: 'indexPePercentile', op: '>=', value: 90 },
                { field: 'fundGain3M',        op: '>=', value: 15 },
            ] },
        { id: 'half', label: '减半', color: 'yellow', multiplier: 50, logic: 'OR',
            conditions: [
                { field: 'indexPePercentile', op: '>=', value: 80 },
                { field: 'fundGain3M',        op: '>=', value: 10 },
            ] },
        { id: 'double', label: '加倍', color: 'red', multiplier: 200, logic: 'AND',
            conditions: [
                { field: 'indexPePercentile', op: '<=', value: 20 },
                { field: 'fundDrawdownAbs',   op: '>=', value: 15 },
            ] },
        { id: 'boost', label: '加强', color: 'blue', multiplier: 150, logic: 'AND',
            conditions: [
                { field: 'indexPePercentile', op: '<=', value: 20 },
                { field: 'fundDrawdownAbs',   op: '>=', value: 5 },
                { field: 'fundDrawdownAbs',   op: '<',  value: 15 },
            ] },
        { id: 'normal', label: '正常', color: 'green', multiplier: 100, logic: 'AND', conditions: [] },
    ];
    const strategy = { rules: daChengRules };

    it('PE=92, 涨幅=5 → pause（OR 单边：PE 命中）', () => {
        const r = matchStrategy(strategy, { indexPePercentile: 92, fundGain3M: 5 });
        expect(r.hitRule.id).toBe('pause');
    });

    it('PE=50, 涨幅=18 → pause（OR 单边：基金涨幅命中）', () => {
        const r = matchStrategy(strategy, { indexPePercentile: 50, fundGain3M: 18 });
        expect(r.hitRule.id).toBe('pause');
    });

    it('PE=85, 涨幅=5 → half（OR 单边：PE 命中减半）', () => {
        const r = matchStrategy(strategy, { indexPePercentile: 85, fundGain3M: 5 });
        expect(r.hitRule.id).toBe('half');
    });

    it('PE=18, 回撤=22 → double（双低 AND）', () => {
        const r = matchStrategy(strategy, { indexPePercentile: 18, fundDrawdownAbs: 22, fundGain3M: 0 });
        expect(r.hitRule.id).toBe('double');
    });

    it('PE=18, 回撤=8 → boost（AND 5-15 区间）', () => {
        const r = matchStrategy(strategy, { indexPePercentile: 18, fundDrawdownAbs: 8, fundGain3M: 0 });
        expect(r.hitRule.id).toBe('boost');
    });

    it('PE=15, 回撤=2 → normal 兜底（AND 缺一不命中加仓档）', () => {
        const r = matchStrategy(strategy, { indexPePercentile: 15, fundDrawdownAbs: 2, fundGain3M: 0 });
        expect(r.hitRule.id).toBe('normal');
    });

    it('PE=50, 涨幅=5, 回撤=2 → normal', () => {
        const r = matchStrategy(strategy, { indexPePercentile: 50, fundGain3M: 5, fundDrawdownAbs: 2 });
        expect(r.hitRule.id).toBe('normal');
    });
});

describe('ActiveFund Engine v2 — 兴全商业模式 A 默认规则验收', () => {
    const xingQuanRules = [
        { id: 'pause-extreme', label: '暂停', color: 'purple', multiplier: 0, logic: 'OR',
            conditions: [
                { field: 'indexPePercentile', op: '>=', value: 90 },
                { field: 'fundDistanceToYearHighPct', op: '<=', value: 2 },
            ] },
        { id: 'pause-overheat', label: '暂停', color: 'purple', multiplier: 0, logic: 'OR',
            conditions: [
                { field: 'indexPePercentile', op: '>=', value: 80 },
                { field: 'fundGain1Y', op: '>', value: 50 },
            ] },
        { id: 'half', label: '减半', color: 'yellow', multiplier: 50, logic: 'OR',
            conditions: [
                { field: 'indexPePercentile', op: '>=', value: 60 },
                { field: 'fundGain1Y', op: '>', value: 40 },
            ] },
        { id: 'double', label: '加倍', color: 'red', multiplier: 200, logic: 'AND',
            conditions: [
                { field: 'indexPePercentile', op: '<=', value: 20 },
                { field: 'fundDrawdownAbs', op: '>=', value: 20 },
            ] },
        { id: 'boost', label: '加强', color: 'blue', multiplier: 150, logic: 'AND',
            conditions: [
                { field: 'indexPePercentile', op: '<=', value: 20 },
                { field: 'fundDrawdownAbs', op: '>=', value: 10 },
                { field: 'fundDrawdownAbs', op: '<', value: 20 },
            ] },
        { id: 'boost-mid', label: '加强', color: 'blue', multiplier: 150, logic: 'AND',
            conditions: [
                { field: 'indexPePercentile', op: '>=', value: 20 },
                { field: 'indexPePercentile', op: '<', value: 60 },
                { field: 'fundDrawdownAbs', op: '>=', value: 15 },
            ] },
        { id: 'normal', label: '正常', color: 'green', multiplier: 100, logic: 'AND', conditions: [] },
    ];
    const strategy = { rules: xingQuanRules };

    it('PE=92, 距新高=8 → pause-extreme（OR 单边：PE）', () => {
        const r = matchStrategy(strategy, { indexPePercentile: 92, fundDistanceToYearHighPct: 8, fundGain1Y: 0, fundDrawdownAbs: 0 });
        expect(r.hitRule.id).toBe('pause-extreme');
    });

    it('PE=65, 距新高=1.2 → pause-extreme（OR 单边：距新高）', () => {
        const r = matchStrategy(strategy, { indexPePercentile: 65, fundDistanceToYearHighPct: 1.2, fundGain1Y: 0, fundDrawdownAbs: 0 });
        expect(r.hitRule.id).toBe('pause-extreme');
    });

    it('PE=82, 涨幅=30, 距新高=8 → pause-overheat（OR 单边：PE）', () => {
        const r = matchStrategy(strategy, { indexPePercentile: 82, fundGain1Y: 30, fundDistanceToYearHighPct: 8, fundDrawdownAbs: 0 });
        expect(r.hitRule.id).toBe('pause-overheat');
    });

    it('PE=60, 涨幅=55, 距新高=5 → pause-overheat（OR 单边：涨幅）', () => {
        const r = matchStrategy(strategy, { indexPePercentile: 60, fundGain1Y: 55, fundDistanceToYearHighPct: 5, fundDrawdownAbs: 0 });
        expect(r.hitRule.id).toBe('pause-overheat');
    });

    it('PE=70, 涨幅=25 → half（OR 单边：PE 命中下界）', () => {
        const r = matchStrategy(strategy, { indexPePercentile: 70, fundGain1Y: 25, fundDistanceToYearHighPct: 5, fundDrawdownAbs: 0 });
        expect(r.hitRule.id).toBe('half');
    });

    it('PE=50, 涨幅=45 → half（OR 单边：涨幅）', () => {
        const r = matchStrategy(strategy, { indexPePercentile: 50, fundGain1Y: 45, fundDistanceToYearHighPct: 5, fundDrawdownAbs: 0 });
        expect(r.hitRule.id).toBe('half');
    });

    it('PE=18, 回撤=22 → double', () => {
        const r = matchStrategy(strategy, { indexPePercentile: 18, fundGain1Y: 0, fundDistanceToYearHighPct: 5, fundDrawdownAbs: 22 });
        expect(r.hitRule.id).toBe('double');
    });

    it('PE=15, 回撤=15 → boost（10-20 区间）', () => {
        const r = matchStrategy(strategy, { indexPePercentile: 15, fundGain1Y: 0, fundDistanceToYearHighPct: 5, fundDrawdownAbs: 15 });
        expect(r.hitRule.id).toBe('boost');
    });

    it('PE=35, 回撤=18, 涨幅=-10 → boost-mid（中性区 AND 回撤≥15）', () => {
        const r = matchStrategy(strategy, { indexPePercentile: 35, fundDrawdownAbs: 18, fundGain1Y: -10, fundDistanceToYearHighPct: 10 });
        expect(r.hitRule.id).toBe('boost-mid');
    });

    it('PE=50, 涨幅=10, 回撤=5 → normal 兜底', () => {
        const r = matchStrategy(strategy, { indexPePercentile: 50, fundGain1Y: 10, fundDistanceToYearHighPct: 10, fundDrawdownAbs: 5 });
        expect(r.hitRule.id).toBe('normal');
    });

    it('命中即停 — PE=92 不会越过 pause-extreme 落到后续档', () => {
        const r = matchStrategy(strategy, { indexPePercentile: 92, fundGain1Y: 60, fundDistanceToYearHighPct: 1, fundDrawdownAbs: 25 });
        expect(r.hitRule.id).toBe('pause-extreme');
        // 后续规则全部标记"已被前置规则命中"
        expect(r.ruleScans.slice(1).every(s => s.summary === '已被前置规则命中')).toBe(true);
    });
});
