'use strict';

/**
 * 主动基金定投策略规则引擎 — 单元测试
 * 不依赖 HTTP 服务，可独立运行。
 */

const {
    computeFundIndicators,
    evaluateCondition,
    evaluateRule,
    matchStrategy,
    pickBenchmarkEvaluation,
} = require('../services/activeFundStrategyEngine');

describe('ActiveFund Engine — computeFundIndicators', () => {
    it('空序列返回全 null', () => {
        const r = computeFundIndicators([]);
        expect(r.drawdownAbs).toBeNull();
        expect(r.gain3m).toBeNull();
        expect(r.gain6m).toBeNull();
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
