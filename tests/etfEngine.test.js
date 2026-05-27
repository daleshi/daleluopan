'use strict';

/**
 * ETF 策略引擎 — 单元测试
 */

const {
    computeEtfIndicators,
    matchEtfPriceTier,
    isPriceInTier,
    evaluateCrashSignal,
    evaluateGenericTakeProfitTiers,
} = require('../services/etfStrategyEngine');

describe('ETF Engine — matchEtfPriceTier', () => {
    const tiers = [
        { id: 'pause',   label: '暂停', color: 'red',    priceMin: 1.60, priceMax: null, monthlyAmount: 0 },
        { id: 'watch',   label: '观望', color: 'yellow', priceMin: 1.22, priceMax: 1.60, monthlyAmount: 700 },
        { id: 'normal',  label: '定投', color: 'green',  priceMin: 0.92, priceMax: 1.22, monthlyAmount: 2100 },
        { id: 'double',  label: '加倍', color: 'orange', priceMin: 0.72, priceMax: 0.92, monthlyAmount: 4200 },
        { id: 'extreme', label: '极限', color: 'purple', priceMin: null, priceMax: 0.72, monthlyAmount: 12600 },
    ];

    it.each([
        [1.913, 'pause'],
        [1.60,  'pause'],   // 区间右开：1.60 命中 pause
        [1.5999,'watch'],
        [1.30,  'watch'],
        [1.22,  'watch'],   // 1.22 命中 watch (priceMin=1.22)
        [1.2199,'normal'],
        [0.92,  'normal'],
        [0.91,  'double'],
        [0.72,  'double'],  // 0.72 命中 double (priceMin=0.72)
        [0.71,  'extreme'],
        [0.30,  'extreme'],
    ])('price=%s → %s', (price, expectedId) => {
        const r = matchEtfPriceTier(price, tiers);
        expect(r.hitTier?.id).toBe(expectedId);
    });

    it('价格为 null → hitTier 为 null', () => {
        const r = matchEtfPriceTier(null, tiers);
        expect(r.hitTier).toBeNull();
        expect(r.tierScans).toHaveLength(5);
        expect(r.tierScans.every(t => !t.hit)).toBe(true);
    });

    it('返回完整 tierScans，仅命中档 hit=true', () => {
        const r = matchEtfPriceTier(1.00, tiers);
        expect(r.tierScans).toHaveLength(5);
        const hits = r.tierScans.filter(t => t.hit);
        expect(hits).toHaveLength(1);
        expect(hits[0].id).toBe('normal');
    });

    it('空档位数组 → hitTier null', () => {
        const r = matchEtfPriceTier(1.0, []);
        expect(r.hitTier).toBeNull();
    });
});

describe('ETF Engine — isPriceInTier', () => {
    it('priceMin/priceMax 都有界，区间右开', () => {
        const t = { priceMin: 1.0, priceMax: 2.0 };
        expect(isPriceInTier(1.0, t)).toBe(true);
        expect(isPriceInTier(1.5, t)).toBe(true);
        expect(isPriceInTier(2.0, t)).toBe(false); // 右开
        expect(isPriceInTier(0.9, t)).toBe(false);
    });

    it('priceMin null（下限无界）', () => {
        const t = { priceMin: null, priceMax: 1.0 };
        expect(isPriceInTier(0.1, t)).toBe(true);
        expect(isPriceInTier(1.0, t)).toBe(false);
    });

    it('priceMax null（上限无界）', () => {
        const t = { priceMin: 1.0, priceMax: null };
        expect(isPriceInTier(1.0, t)).toBe(true);
        expect(isPriceInTier(100, t)).toBe(true);
        expect(isPriceInTier(0.9, t)).toBe(false);
    });
});

describe('ETF Engine — computeEtfIndicators', () => {
    it('K 线数据 < 22 天 → monthChangePct null', () => {
        const kline = Array.from({ length: 20 }, (_, i) => ({ date: `D${i}`, close: 1.0 + i * 0.01 }));
        const r = computeEtfIndicators(1.5, kline);
        expect(r.monthChangePct).toBeNull();
    });

    it('正常 25 天 K 线 → 计算正确', () => {
        // close: D0=1.0, D1=1.01, ..., D24=1.24
        const kline = Array.from({ length: 25 }, (_, i) => ({ date: `D${i}`, close: 1.0 + i * 0.01 }));
        const r = computeEtfIndicators(1.24, kline);
        // 22日前是 kline[length-22] = kline[3] → close=1.03
        // monthChangePct = (1.24 - 1.03) / 1.03 * 100 ≈ 20.39
        expect(r.refPrice22dAgo).toBeCloseTo(1.03, 2);
        expect(r.monthChangePct).toBeCloseTo(20.39, 1);
    });

    it('currentPrice null → 全 null', () => {
        const kline = Array.from({ length: 30 }, () => ({ date: 'd', close: 1.0 }));
        const r = computeEtfIndicators(null, kline);
        expect(r.monthChangePct).toBeNull();
    });
});

describe('ETF Engine — evaluateCrashSignal', () => {
    const crashTiers = [
        { id: 'lv1', label: '一级·加倍', threshold: -12, multiplier: 3 },
        { id: 'lv2', label: '二级·极限', threshold: -20, multiplier: 6 },
        { id: 'lv3', label: '三级·史诗', threshold: -30, multiplier: null },
    ];

    it.each([
        [-5,  null],   // 未触发
        [-12, 'lv1'],  // 命中 lv1
        [-15, 'lv1'],
        [-19, 'lv1'],
        [-20, 'lv2'],  // 严苛优先
        [-25, 'lv2'],
        [-30, 'lv3'],
        [-50, 'lv3'],
        [5,   null],   // 上涨不触发
    ])('monthChangePct=%s → %s', (pct, expectedId) => {
        const r = evaluateCrashSignal(pct, crashTiers);
        if (expectedId === null) {
            expect(r.signal).toBeNull();
        } else {
            expect(r.signal?.id).toBe(expectedId);
        }
    });

    it('monthChangePct null → null + 提示文案', () => {
        const r = evaluateCrashSignal(null, crashTiers);
        expect(r.signal).toBeNull();
        expect(r.text).toMatch(/数据不足/);
    });

    it('空 crashTiers 数组', () => {
        const r = evaluateCrashSignal(-20, []);
        expect(r.signal).toBeNull();
        expect(r.text).toMatch(/未配置/);
    });
});

describe('ETF Engine — evaluateGenericTakeProfitTiers', () => {
    const tiers = [
        { id: 'tp1', label: '一档', sellPct: 33.3, triggeredAt: null,
            triggerConditions: [{ field: 'fundReturnPct', op: '>=', value: 50 }] },
        { id: 'tp2', label: '二档', sellPct: 33.3, triggeredAt: null,
            triggerConditions: [{ field: 'fundReturnPct', op: '>=', value: 100 }] },
        { id: 'tp3', label: '清仓', sellPct: 100, triggeredAt: null,
            triggerConditions: [{ field: 'fundReturnPct', op: '>=', value: 150 }] },
    ];

    it('收益 0% → 全 pending', () => {
        const r = evaluateGenericTakeProfitTiers(tiers, { fundReturnPct: 0 }, 1000, 2.0);
        expect(r.every(t => t.state === 'pending')).toBe(true);
    });

    it('收益 75% → tp1 actionable，其它 pending', () => {
        const r = evaluateGenericTakeProfitTiers(tiers, { fundReturnPct: 75 }, 1000, 2.0);
        expect(r[0].state).toBe('actionable');
        expect(r[0].suggestion).toEqual({ shares: 333, amountApprox: 666 });
        expect(r[1].state).toBe('pending');
        expect(r[2].state).toBe('pending');
    });

    it('triggeredAt 非空 → triggered（即使达到阈值）', () => {
        const t = tiers.map((x, i) => i === 0 ? { ...x, triggeredAt: '2025-12-01' } : x);
        const r = evaluateGenericTakeProfitTiers(t, { fundReturnPct: 75 }, 1000, 2.0);
        expect(r[0].state).toBe('triggered');
        expect(r[0].triggeredAt).toBe('2025-12-01');
        expect(r[0].suggestion).toBeUndefined();
    });

    it('fundReturnPct null → 未触发档全 pending', () => {
        const r = evaluateGenericTakeProfitTiers(tiers, { fundReturnPct: null }, 1000, 2.0);
        expect(r.every(t => t.state === 'pending')).toBe(true);
    });

    it('latestPrice null → amountApprox null', () => {
        const r = evaluateGenericTakeProfitTiers(tiers, { fundReturnPct: 75 }, 1000, null);
        expect(r[0].state).toBe('actionable');
        expect(r[0].suggestion.amountApprox).toBeNull();
    });

    it('空 triggerConditions → 永远 pending（防御）', () => {
        const t = [{ id: 'empty', label: 'X', sellPct: 50, triggeredAt: null, triggerConditions: [] }];
        const r = evaluateGenericTakeProfitTiers(t, { fundReturnPct: 999 }, 1000, 1);
        expect(r[0].state).toBe('pending');
    });
});
