'use strict';

/**
 * 黄金策略引擎 — 单元测试
 * 不依赖 HTTP 服务，可独立运行。
 */

const {
    computeGoldIndicators,
    summarizeHoldings,
    evaluateTakeProfitTiers,
} = require('../services/goldStrategyEngine');

describe('Gold Engine — computeGoldIndicators', () => {
    const oneDay = 24 * 3600 * 1000;
    const now = Date.now();

    it('空序列返回全 null', () => {
        const r = computeGoldIndicators([]);
        expect(r.fundPricePercentile5Y).toBeNull();
        expect(r.fundDrawdown1Y).toBeNull();
    });

    it('序列点数 < 60 → 全 null（降级）', () => {
        const trend = Array.from({ length: 30 }, (_, i) => ({
            date: now - (30 - i) * oneDay, nav: 1 + i * 0.01,
        }));
        const r = computeGoldIndicators(trend);
        expect(r.fundPricePercentile5Y).toBeNull();
        expect(r.fundDrawdown1Y).toBeNull();
    });

    it('正常 1300 天序列：单调上行 → 价格分位接近 100%', () => {
        const trend = Array.from({ length: 1300 }, (_, i) => ({
            date: now - (1300 - i) * oneDay, nav: 1.0 + i * 0.001,
        }));
        const r = computeGoldIndicators(trend, 1250, 250);
        expect(r.fundPricePercentile5Y).toBeGreaterThan(95);
        expect(r.fundDrawdown1Y).toBeLessThan(1); // 单调上行无回撤
    });

    it('正常序列：先涨后跌 → 回撤显著', () => {
        const trend = [];
        // 前 800 天从 1.0 涨到 3.0
        for (let i = 0; i < 800; i++) {
            trend.push({ date: now - (1300 - i) * oneDay, nav: 1.0 + i * 0.0025 });
        }
        // 后 500 天从 3.0 跌到 2.0
        for (let i = 0; i < 500; i++) {
            trend.push({ date: now - (500 - i) * oneDay, nav: 3.0 - i * 0.002 });
        }
        const r = computeGoldIndicators(trend, 1250, 250);
        // 最新值 ~2.0 在历史中等位置
        expect(r.fundPricePercentile5Y).toBeGreaterThan(20);
        expect(r.fundPricePercentile5Y).toBeLessThan(95);
        // 近1年最高约 2.5（500 天前的位置），最新约 2.0 → 回撤约 20%
        expect(r.fundDrawdown1Y).toBeGreaterThan(15);
    });

    it('数据量不足 priceWindow 时自动降级到全量', () => {
        const trend = Array.from({ length: 100 }, (_, i) => ({
            date: now - (100 - i) * oneDay, nav: 1.0 + i * 0.01,
        }));
        const r = computeGoldIndicators(trend, 1250, 250); // 要求 1250 但只有 100
        expect(r.fundPricePercentile5Y).not.toBeNull(); // 不报错，用全量
        expect(r.fundPricePercentile5Y).toBeGreaterThan(90); // 单调上行
    });

    it('容忍非法字段', () => {
        const trend = [
            { date: now - 100 * oneDay, nav: 1.0 },
            { date: null,              nav: 1.5 },     // 非法 date
            { date: now - 50  * oneDay, nav: null },   // 非法 nav
            { date: now,                nav: 1.2 },
        ];
        // 只有 2 个合法点 < 60，应该降级
        const r = computeGoldIndicators(trend);
        expect(r.fundPricePercentile5Y).toBeNull();
    });
});

describe('Gold Engine — summarizeHoldings', () => {
    it('空记录返回零值', () => {
        const r = summarizeHoldings([], '000216', 3.5);
        expect(r.totalCost).toBe(0);
        expect(r.totalShares).toBe(0);
        expect(r.totalReturnPct).toBeNull(); // cost=0 时为 null
    });

    it('只过滤指定基金的记录', () => {
        const records = [
            { fundCode: '000216', type: 'buy', amount: 1000, shares: 300 },
            { fundCode: 'other',  type: 'buy', amount: 5000, shares: 1000 },
        ];
        const r = summarizeHoldings(records, '000216', 3.5);
        expect(r.totalCost).toBe(1000);
        expect(r.totalShares).toBe(300);
    });

    it('buy + sell 净计算', () => {
        const records = [
            { fundCode: '000216', type: 'buy',  amount: 1000, shares: 300 },
            { fundCode: '000216', type: 'buy',  amount: 1000, shares: 280 },
            { fundCode: '000216', type: 'sell', amount: 500,  shares: 100 },
        ];
        const r = summarizeHoldings(records, '000216', 3.5);
        expect(r.totalCost).toBe(1500);
        expect(r.totalShares).toBe(480);
        expect(r.buyCount).toBe(2);
        expect(r.sellCount).toBe(1);
        // marketValue = 480 * 3.5 = 1680
        expect(r.marketValue).toBe(1680);
        // returnPct = (1680 - 1500) / 1500 * 100 = 12
        expect(r.totalReturnPct).toBeCloseTo(12, 1);
    });

    it('totalCost = 0 时 returnPct = null', () => {
        const records = [
            { fundCode: '000216', type: 'buy',  amount: 1000, shares: 300 },
            { fundCode: '000216', type: 'sell', amount: 1000, shares: 100 },
        ];
        const r = summarizeHoldings(records, '000216', 3.5);
        expect(r.totalCost).toBe(0);
        expect(r.totalReturnPct).toBeNull();
    });

    it('latestNav 为 null 时 marketValue 和 returnPct 均为 null', () => {
        const records = [{ fundCode: '000216', type: 'buy', amount: 1000, shares: 300 }];
        const r = summarizeHoldings(records, '000216', null);
        expect(r.marketValue).toBeNull();
        expect(r.totalReturnPct).toBeNull();
    });
});

describe('Gold Engine — evaluateTakeProfitTiers', () => {
    const tiers = [
        { id: 'tp30',  label: '30%', thresholdReturn: 30,  sellPct: 10, triggeredAt: null },
        { id: 'tp60',  label: '60%', thresholdReturn: 60,  sellPct: 20, triggeredAt: null },
        { id: 'tp100', label: '100%',thresholdReturn: 100, sellPct: 30, triggeredAt: null },
    ];

    it('收益 0% → 全 pending', () => {
        const r = evaluateTakeProfitTiers(tiers, 0, 1000, 3.5);
        expect(r.every(t => t.state === 'pending')).toBe(true);
    });

    it('收益 35% → tp30 actionable，其它 pending', () => {
        const r = evaluateTakeProfitTiers(tiers, 35, 1000, 3.5);
        expect(r[0].state).toBe('actionable');
        expect(r[0].suggestion).toEqual({ shares: 100, amountApprox: 350 });
        expect(r[1].state).toBe('pending');
        expect(r[2].state).toBe('pending');
    });

    it('收益 75% → tp30 + tp60 都 actionable', () => {
        const r = evaluateTakeProfitTiers(tiers, 75, 1000, 3.5);
        expect(r[0].state).toBe('actionable');
        expect(r[1].state).toBe('actionable');
        expect(r[2].state).toBe('pending');
    });

    it('tp30 已 triggeredAt 时显示 triggered，即使达到阈值', () => {
        const t = tiers.map((x, i) => i === 0 ? { ...x, triggeredAt: '2025-12-01' } : x);
        const r = evaluateTakeProfitTiers(t, 35, 1000, 3.5);
        expect(r[0].state).toBe('triggered');
        expect(r[0].triggeredAt).toBe('2025-12-01');
        expect(r[0].suggestion).toBeUndefined();
    });

    it('totalReturnPct 为 null 时全 pending', () => {
        const r = evaluateTakeProfitTiers(tiers, null, 1000, 3.5);
        expect(r.every(t => t.state === 'pending')).toBe(true);
    });

    it('latestNav 为 null 时 actionable 的 amountApprox 也为 null', () => {
        const r = evaluateTakeProfitTiers(tiers, 35, 1000, null);
        expect(r[0].state).toBe('actionable');
        expect(r[0].suggestion.amountApprox).toBeNull();
    });
});
