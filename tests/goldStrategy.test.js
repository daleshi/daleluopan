'use strict';

/**
 * 黄金定投策略 API 测试
 * 覆盖: gold-plans / gold-holdings / gold-recommendations
 */

const { createAgent, loginAs, loginAsAdmin } = require('./setup/helpers');

const TEST_FUND_CODE = 'TEST888'; // 测试用基金，不与默认 000216 冲突

const validStrategy = () => ({
    fundCode: TEST_FUND_CODE,
    fundName: '测试黄金基金',
    monthlyAmount: 500,
    priceWindow: 1250,
    drawdownWindow: 250,
    rules: [
        { id: 'pause', label: '暂停定投', color: 'purple', multiplier: 0, logic: 'AND',
            conditions: [{ field: 'fundPricePercentile5Y', op: '>=', value: 90 }] },
        { id: 'double', label: '加倍定投', color: 'red', multiplier: 200, logic: 'OR',
            conditions: [
                { field: 'fundPricePercentile5Y', op: '<=', value: 20 },
                { field: 'fundDrawdown1Y',        op: '>=', value: 25 },
            ] },
        { id: 'half', label: '减半定投', color: 'yellow', multiplier: 50, logic: 'AND',
            conditions: [
                { field: 'fundPricePercentile5Y', op: '>=', value: 70 },
                { field: 'fundPricePercentile5Y', op: '<',  value: 90 },
            ] },
        { id: 'normal', label: '正常定投', color: 'green', multiplier: 100, logic: 'AND', conditions: [] },
    ],
    takeProfitTiers: [
        { id: 'tp30',  label: '30%', thresholdReturn: 30,  sellPct: 10, triggeredAt: null },
        { id: 'tp60',  label: '60%', thresholdReturn: 60,  sellPct: 20, triggeredAt: null },
        { id: 'tp100', label: '100%',thresholdReturn: 100, sellPct: 30, triggeredAt: null },
    ],
});

describe('Gold DCA Strategy — /api/strategy/gold-*', () => {
    let adminAgent;
    const createdHoldingIds = [];

    beforeAll(async () => {
        adminAgent = await loginAsAdmin();
    });

    afterAll(async () => {
        // 清理：删除测试期间创建的所有 holding
        for (const id of createdHoldingIds) {
            await adminAgent.post('/api/strategy/gold-holdings/delete').send({ id }).catch(() => {});
        }
        // 清理：删除测试策略
        await adminAgent.post('/api/strategy/gold-plans/delete').send({ fundCode: TEST_FUND_CODE }).catch(() => {});
    });

    // ─────────────────────────────────────────────────────────
    // GET /api/strategy/gold-plans
    // ─────────────────────────────────────────────────────────
    describe('GET /api/strategy/gold-plans', () => {
        it('未登录可读取策略列表', async () => {
            const res = await createAgent().get('/api/strategy/gold-plans');
            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);
            expect(Array.isArray(res.body.data.strategies)).toBe(true);
        });

        it('默认配置包含 000216 华安黄金联接A', async () => {
            const res = await createAgent().get('/api/strategy/gold-plans');
            const codes = res.body.data.strategies.map(s => s.fundCode);
            if (res.body.data.strategies.length > 0) {
                expect(codes).toContain('000216');
            }
        });
    });

    // ─────────────────────────────────────────────────────────
    // POST /api/strategy/gold-plans
    // ─────────────────────────────────────────────────────────
    describe('POST /api/strategy/gold-plans', () => {
        it('未登录返回 401', async () => {
            const res = await createAgent().post('/api/strategy/gold-plans').send(validStrategy());
            expect(res.status).toBe(401);
        });

        it('普通用户返回 403', async () => {
            const uname = `gd_${String(Date.now()).slice(-6)}`;
            await adminAgent.post('/api/admin/users').send({
                username: uname, password: 'Test12345', role: 'user',
            });
            const agent = await loginAs(uname, 'Test12345');
            const res = await agent.post('/api/strategy/gold-plans').send(validStrategy());
            expect(res.status).toBe(403);
            await adminAgent.post('/api/admin/users/delete').send({ username: uname }).catch(() => {});
        });

        it('管理员成功创建', async () => {
            const res = await adminAgent.post('/api/strategy/gold-plans').send(validStrategy());
            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);
            const found = res.body.data.strategies.find(s => s.fundCode === TEST_FUND_CODE);
            expect(found).toBeTruthy();
            expect(found.monthlyAmount).toBe(500);
        });

        it('upsert：相同 fundCode 执行更新', async () => {
            const payload = { ...validStrategy(), monthlyAmount: 800 };
            const res = await adminAgent.post('/api/strategy/gold-plans').send(payload);
            expect(res.body.success).toBe(true);
            const found = res.body.data.strategies.find(s => s.fundCode === TEST_FUND_CODE);
            expect(found.monthlyAmount).toBe(800);
            const count = res.body.data.strategies.filter(s => s.fundCode === TEST_FUND_CODE).length;
            expect(count).toBe(1);
        });

        it('缺少 fundCode → 400', async () => {
            const payload = validStrategy();
            delete payload.fundCode;
            const res = await adminAgent.post('/api/strategy/gold-plans').send(payload);
            expect(res.status).toBe(400);
        });

        it('monthlyAmount ≤ 0 → 400', async () => {
            const payload = { ...validStrategy(), monthlyAmount: 0 };
            const res = await adminAgent.post('/api/strategy/gold-plans').send(payload);
            expect(res.status).toBe(400);
            expect(res.body.error).toMatch(/正数/);
        });

        it('rules 缺少 normal 兜底 → 400', async () => {
            const payload = validStrategy();
            payload.rules = payload.rules.filter(r => r.id !== 'normal');
            const res = await adminAgent.post('/api/strategy/gold-plans').send(payload);
            expect(res.status).toBe(400);
            expect(res.body.error).toMatch(/normal/);
        });

        it('使用主动基金的 field 也会被拒绝（黄金仅允许 2 个 field）', async () => {
            const payload = validStrategy();
            payload.rules[0].conditions = [{ field: 'indexPePercentile', op: '>=', value: 80 }];
            const res = await adminAgent.post('/api/strategy/gold-plans').send(payload);
            expect(res.status).toBe(400);
            expect(res.body.error).toMatch(/fundPricePercentile5Y|fundDrawdown1Y/);
        });

        it('takeProfitTiers 未升序 → 400', async () => {
            const payload = validStrategy();
            payload.takeProfitTiers = [
                { id: 'tp60', label: '60%', thresholdReturn: 60, sellPct: 20, triggeredAt: null },
                { id: 'tp30', label: '30%', thresholdReturn: 30, sellPct: 10, triggeredAt: null },
            ];
            const res = await adminAgent.post('/api/strategy/gold-plans').send(payload);
            expect(res.status).toBe(400);
            expect(res.body.error).toMatch(/升序/);
        });

        it('sellPct 超过 100 → 400', async () => {
            const payload = validStrategy();
            payload.takeProfitTiers[0].sellPct = 120;
            const res = await adminAgent.post('/api/strategy/gold-plans').send(payload);
            expect(res.status).toBe(400);
            expect(res.body.error).toMatch(/sellPct/);
        });

        it('upsert 时保留现有 tier 的 triggeredAt', async () => {
            // 先创建一条带 triggeredAt 的 sell 记录（手工模拟用户已止盈）
            const sellRes = await adminAgent.post('/api/strategy/gold-holdings').send({
                fundCode: TEST_FUND_CODE, type: 'sell', tierId: 'tp30',
                date: '2026-01-01', amount: 100, shares: 30, nav: 3.0,
            });
            // 校验 tier 已被标记触发
            if (sellRes.body.success) createdHoldingIds.push(sellRes.body.data.record.id);
            const before = await createAgent().get('/api/strategy/gold-plans');
            const beforeTier = before.body.data.strategies
                .find(s => s.fundCode === TEST_FUND_CODE)
                ?.takeProfitTiers.find(t => t.id === 'tp30');
            expect(beforeTier?.triggeredAt).toBeTruthy();

            // 再次 POST 完整策略（triggeredAt 都是 null）
            const res = await adminAgent.post('/api/strategy/gold-plans').send(validStrategy());
            expect(res.body.success).toBe(true);
            const afterTier = res.body.data.strategies
                .find(s => s.fundCode === TEST_FUND_CODE)
                ?.takeProfitTiers.find(t => t.id === 'tp30');
            expect(afterTier?.triggeredAt).toBeTruthy(); // 仍然保留
        });
    });

    // ─────────────────────────────────────────────────────────
    // POST /api/strategy/gold-plans/delete
    // ─────────────────────────────────────────────────────────
    describe('POST /api/strategy/gold-plans/delete', () => {
        it('未登录返回 401', async () => {
            const res = await createAgent()
                .post('/api/strategy/gold-plans/delete')
                .send({ fundCode: TEST_FUND_CODE });
            expect(res.status).toBe(401);
        });

        it('删除不存在的策略 → 404', async () => {
            const res = await adminAgent
                .post('/api/strategy/gold-plans/delete')
                .send({ fundCode: 'NOT_EXIST_99' });
            expect(res.status).toBe(404);
        });
    });

    // ─────────────────────────────────────────────────────────
    // /api/strategy/gold-holdings
    // ─────────────────────────────────────────────────────────
    describe('Gold Holdings', () => {
        it('未登录可读取持仓记录', async () => {
            const res = await createAgent().get('/api/strategy/gold-holdings');
            expect(res.status).toBe(200);
            expect(Array.isArray(res.body.data.records)).toBe(true);
        });

        it('未登录不能新增', async () => {
            const res = await createAgent().post('/api/strategy/gold-holdings').send({
                fundCode: TEST_FUND_CODE, type: 'buy', date: '2026-05-15',
                amount: 1000, shares: 280, nav: 3.5,
            });
            expect(res.status).toBe(401);
        });

        it('管理员新增 buy 记录', async () => {
            const res = await adminAgent.post('/api/strategy/gold-holdings').send({
                fundCode: TEST_FUND_CODE, type: 'buy', date: '2026-05-15',
                amount: 1000, shares: 280, nav: 3.5,
            });
            expect(res.status).toBe(200);
            expect(res.body.data.record.id).toBeTruthy();
            createdHoldingIds.push(res.body.data.record.id);
        });

        it('非法 type → 400', async () => {
            const res = await adminAgent.post('/api/strategy/gold-holdings').send({
                fundCode: TEST_FUND_CODE, type: 'invalid', date: '2026-05-15',
                amount: 1000, shares: 280, nav: 3.5,
            });
            expect(res.status).toBe(400);
        });

        it('非法 date 格式 → 400', async () => {
            const res = await adminAgent.post('/api/strategy/gold-holdings').send({
                fundCode: TEST_FUND_CODE, type: 'buy', date: '2026/05/15',
                amount: 1000, shares: 280, nav: 3.5,
            });
            expect(res.status).toBe(400);
        });

        it('amount/shares/nav 非正数 → 400', async () => {
            const res = await adminAgent.post('/api/strategy/gold-holdings').send({
                fundCode: TEST_FUND_CODE, type: 'buy', date: '2026-05-15',
                amount: 0, shares: 280, nav: 3.5,
            });
            expect(res.status).toBe(400);
        });

        it('删除不存在的记录 → 404', async () => {
            const res = await adminAgent
                .post('/api/strategy/gold-holdings/delete')
                .send({ id: 'NOT_EXIST_ID' });
            expect(res.status).toBe(404);
        });
    });

    // ─────────────────────────────────────────────────────────
    // GET /api/strategy/gold-recommendations
    // ─────────────────────────────────────────────────────────
    describe('GET /api/strategy/gold-recommendations', () => {
        it('未登录可读取', async () => {
            const res = await createAgent().get('/api/strategy/gold-recommendations');
            expect(res.status).toBe(200);
            expect(res.body.data.calculatedAt).toBeTruthy();
            expect(Array.isArray(res.body.data.recommendations)).toBe(true);
        }, 60000);

        it('每条推荐含必要字段', async () => {
            const res = await createAgent().get('/api/strategy/gold-recommendations');
            const recs = res.body.data.recommendations;
            if (recs.length === 0) return;
            const r = recs[0];
            expect(r.fundCode).toBeDefined();
            expect(r.indicators).toBeDefined();
            expect(Array.isArray(r.ruleScans)).toBe(true);
            expect(r.holdings).toBeDefined();
            expect(Array.isArray(r.takeProfitStatus)).toBe(true);
        }, 30000);
    });

    // ─────────────────────────────────────────────────────────
    // 持仓 sell + tierId 联动验证（推荐后期场景）
    // ─────────────────────────────────────────────────────────
    describe('Sell + tierId 联动', () => {
        it('新增 sell 类型 + tierId → 自动标记 tier triggeredAt', async () => {
            // 重新清理 + 创建策略
            await adminAgent.post('/api/strategy/gold-plans').send(validStrategy());
            // 创建 sell 记录
            const sell = await adminAgent.post('/api/strategy/gold-holdings').send({
                fundCode: TEST_FUND_CODE, type: 'sell', tierId: 'tp60',
                date: '2026-03-01', amount: 200, shares: 60, nav: 3.3,
            });
            expect(sell.body.success).toBe(true);
            createdHoldingIds.push(sell.body.data.record.id);

            const plans = await createAgent().get('/api/strategy/gold-plans');
            const tier = plans.body.data.strategies
                .find(s => s.fundCode === TEST_FUND_CODE)
                ?.takeProfitTiers.find(t => t.id === 'tp60');
            expect(tier?.triggeredAt).toBeTruthy();
        });

        it('重复触发已 triggered 的 tier → 400', async () => {
            // tp60 在上一个 test 已被触发
            const res = await adminAgent.post('/api/strategy/gold-holdings').send({
                fundCode: TEST_FUND_CODE, type: 'sell', tierId: 'tp60',
                date: '2026-04-01', amount: 100, shares: 30, nav: 3.3,
            });
            expect(res.status).toBe(400);
            expect(res.body.error).toMatch(/已触发/);
        });

        it('删除 sell+tierId 记录 → 自动重置 tier triggeredAt', async () => {
            // 找到上面创建的 tp60 sell 记录
            const records = (await createAgent().get('/api/strategy/gold-holdings')).body.data.records;
            const sellRec = records.find(r =>
                r.fundCode === TEST_FUND_CODE && r.type === 'sell' && r.tierId === 'tp60'
            );
            if (!sellRec) return; // 测试期间没创建成功，跳过

            const del = await adminAgent.post('/api/strategy/gold-holdings/delete')
                .send({ id: sellRec.id });
            expect(del.body.success).toBe(true);
            // 从清理列表移除（已删除）
            const idx = createdHoldingIds.indexOf(sellRec.id);
            if (idx >= 0) createdHoldingIds.splice(idx, 1);

            // 校验 tier 已重置
            const plans = await createAgent().get('/api/strategy/gold-plans');
            const tier = plans.body.data.strategies
                .find(s => s.fundCode === TEST_FUND_CODE)
                ?.takeProfitTiers.find(t => t.id === 'tp60');
            expect(tier?.triggeredAt).toBeNull();
        });

        it('sell + 不存在的 tierId → 400', async () => {
            const res = await adminAgent.post('/api/strategy/gold-holdings').send({
                fundCode: TEST_FUND_CODE, type: 'sell', tierId: 'tp_invalid',
                date: '2026-03-01', amount: 100, shares: 30, nav: 3.3,
            });
            expect(res.status).toBe(400);
            expect(res.body.error).toMatch(/不存在/);
        });
    });
});
