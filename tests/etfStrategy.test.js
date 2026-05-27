'use strict';

/**
 * ETF 定投策略 API 测试
 * 覆盖: etf-plans / etf-holdings / etf-recommendations
 */

const { createAgent, loginAs, loginAsAdmin } = require('./setup/helpers');

const TEST_FUND_CODE = 'ETF999'; // 测试用，不与默认 4 只冲突

const validStrategy = () => ({
    fundCode: TEST_FUND_CODE,
    fundName: '测试 ETF',
    shortName: '测试',
    secid: '1.999999',
    allocationPct: 25,
    priceTiers: [
        { id: 'pause',   label: '暂停', color: 'red',    priceMin: 2.0,  priceMax: null, monthlyAmount: 0 },
        { id: 'watch',   label: '观望', color: 'yellow', priceMin: 1.5,  priceMax: 2.0,  monthlyAmount: 500 },
        { id: 'normal',  label: '定投', color: 'green',  priceMin: 1.0,  priceMax: 1.5,  monthlyAmount: 1000 },
        { id: 'double',  label: '加倍', color: 'orange', priceMin: 0.5,  priceMax: 1.0,  monthlyAmount: 2000 },
        { id: 'extreme', label: '极限', color: 'purple', priceMin: null, priceMax: 0.5,  monthlyAmount: 5000 },
    ],
    takeProfitTiers: [
        { id: 'tp1', label: '一档', sellPct: 33.3, triggeredAt: null,
            triggerConditions: [{ field: 'fundReturnPct', op: '>=', value: 30 }] },
        { id: 'tp2', label: '二档', sellPct: 33.3, triggeredAt: null,
            triggerConditions: [{ field: 'fundReturnPct', op: '>=', value: 60 }] },
        { id: 'tp3', label: '清仓', sellPct: 100, triggeredAt: null,
            triggerConditions: [{ field: 'fundReturnPct', op: '>=', value: 100 }] },
    ],
    crashTiers: [
        { id: 'lv1', label: '一级', threshold: -12, multiplier: 3 },
        { id: 'lv2', label: '二级', threshold: -20, multiplier: 6 },
        { id: 'lv3', label: '三级', threshold: -30, multiplier: null },
    ],
});

describe('ETF DCA Strategy — /api/strategy/etf-*', () => {
    let adminAgent;
    const createdHoldingIds = [];

    beforeAll(async () => {
        adminAgent = await loginAsAdmin();
    });

    afterAll(async () => {
        // 清理 holding
        for (const id of createdHoldingIds) {
            await adminAgent.post('/api/strategy/etf-holdings/delete').send({ id }).catch(() => {});
        }
        // 清理测试策略
        await adminAgent.post('/api/strategy/etf-plans/delete').send({ fundCode: TEST_FUND_CODE }).catch(() => {});
    });

    // ──── etf-plans ────
    describe('GET /api/strategy/etf-plans', () => {
        it('未登录可读取', async () => {
            const res = await createAgent().get('/api/strategy/etf-plans');
            expect(res.status).toBe(200);
            expect(Array.isArray(res.body.data.strategies)).toBe(true);
        });

        it('默认配置包含 4 只 ETF', async () => {
            const res = await createAgent().get('/api/strategy/etf-plans');
            const codes = res.body.data.strategies.map(s => s.fundCode);
            ['588080', '159949', '512400', '513180'].forEach(code => {
                expect(codes).toContain(code);
            });
        });
    });

    describe('POST /api/strategy/etf-plans', () => {
        it('未登录返回 401', async () => {
            const res = await createAgent().post('/api/strategy/etf-plans').send(validStrategy());
            expect(res.status).toBe(401);
        });

        it('普通用户返回 403', async () => {
            const uname = `et_${String(Date.now()).slice(-6)}`;
            await adminAgent.post('/api/admin/users').send({ username: uname, password: 'Test12345', role: 'user' });
            const agent = await loginAs(uname, 'Test12345');
            const res = await agent.post('/api/strategy/etf-plans').send(validStrategy());
            expect(res.status).toBe(403);
            await adminAgent.post('/api/admin/users/delete').send({ username: uname }).catch(() => {});
        });

        it('管理员成功创建', async () => {
            const res = await adminAgent.post('/api/strategy/etf-plans').send(validStrategy());
            expect(res.status).toBe(200);
            const found = res.body.data.strategies.find(s => s.fundCode === TEST_FUND_CODE);
            expect(found).toBeTruthy();
            expect(found.priceTiers).toHaveLength(5);
        });

        it('upsert：相同 fundCode 执行更新', async () => {
            const payload = { ...validStrategy(), allocationPct: 30 };
            const res = await adminAgent.post('/api/strategy/etf-plans').send(payload);
            const found = res.body.data.strategies.find(s => s.fundCode === TEST_FUND_CODE);
            expect(found.allocationPct).toBe(30);
            const count = res.body.data.strategies.filter(s => s.fundCode === TEST_FUND_CODE).length;
            expect(count).toBe(1);
        });

        it('缺少 fundCode → 400', async () => {
            const payload = validStrategy();
            delete payload.fundCode;
            const res = await adminAgent.post('/api/strategy/etf-plans').send(payload);
            expect(res.status).toBe(400);
        });

        it('priceTiers 为空 → 400', async () => {
            const payload = { ...validStrategy(), priceTiers: [] };
            const res = await adminAgent.post('/api/strategy/etf-plans').send(payload);
            expect(res.status).toBe(400);
        });

        it('priceTiers 区间交叉 → 400', async () => {
            const payload = validStrategy();
            // 让两档区间重叠
            payload.priceTiers = [
                { id: 'a', label: 'A', color: 'red',   priceMin: 1.0, priceMax: 2.0, monthlyAmount: 100 },
                { id: 'b', label: 'B', color: 'green', priceMin: 1.5, priceMax: 3.0, monthlyAmount: 200 },
            ];
            const res = await adminAgent.post('/api/strategy/etf-plans').send(payload);
            expect(res.status).toBe(400);
            expect(res.body.error).toMatch(/交叉/);
        });

        it('sellPct 越界 → 400', async () => {
            const payload = validStrategy();
            payload.takeProfitTiers[0].sellPct = 0;
            const res = await adminAgent.post('/api/strategy/etf-plans').send(payload);
            expect(res.status).toBe(400);
            expect(res.body.error).toMatch(/sellPct/);
        });

        it('crashTiers threshold > 0 → 400', async () => {
            const payload = validStrategy();
            payload.crashTiers[0].threshold = 5;
            const res = await adminAgent.post('/api/strategy/etf-plans').send(payload);
            expect(res.status).toBe(400);
            expect(res.body.error).toMatch(/threshold/);
        });

        it('upsert 保留 triggeredAt', async () => {
            // 先创建 sell 触发 tp1
            const sellRes = await adminAgent.post('/api/strategy/etf-holdings').send({
                fundCode: TEST_FUND_CODE, type: 'sell', tierId: 'tp1',
                date: '2026-01-01', amount: 100, shares: 30, nav: 1.5,
            });
            if (sellRes.body.success) createdHoldingIds.push(sellRes.body.data.record.id);
            // 再 POST（triggeredAt 都为 null）
            const res = await adminAgent.post('/api/strategy/etf-plans').send(validStrategy());
            expect(res.body.success).toBe(true);
            const tier = res.body.data.strategies
                .find(s => s.fundCode === TEST_FUND_CODE)
                ?.takeProfitTiers.find(t => t.id === 'tp1');
            expect(tier?.triggeredAt).toBeTruthy(); // 仍保留
        });
    });

    describe('POST /api/strategy/etf-plans/delete', () => {
        it('未登录返回 401', async () => {
            const res = await createAgent()
                .post('/api/strategy/etf-plans/delete')
                .send({ fundCode: TEST_FUND_CODE });
            expect(res.status).toBe(401);
        });

        it('删除不存在 → 404', async () => {
            const res = await adminAgent
                .post('/api/strategy/etf-plans/delete')
                .send({ fundCode: 'NOT_EXIST_99' });
            expect(res.status).toBe(404);
        });
    });

    // ──── etf-holdings ────
    describe('Gold API 不受影响 (回归测试)', () => {
        it('GET /api/strategy/gold-holdings 仍正常工作', async () => {
            const res = await createAgent().get('/api/strategy/gold-holdings');
            expect(res.status).toBe(200);
            expect(Array.isArray(res.body.data.records)).toBe(true);
        });

        it('GET /api/strategy/gold-plans 仍正常工作', async () => {
            const res = await createAgent().get('/api/strategy/gold-plans');
            expect(res.status).toBe(200);
            expect(Array.isArray(res.body.data.strategies)).toBe(true);
        });
    });

    describe('ETF Holdings', () => {
        it('未登录可读取', async () => {
            const res = await createAgent().get('/api/strategy/etf-holdings');
            expect(res.status).toBe(200);
            expect(Array.isArray(res.body.data.records)).toBe(true);
        });

        it('未登录写入返回 401', async () => {
            const res = await createAgent().post('/api/strategy/etf-holdings').send({
                fundCode: TEST_FUND_CODE, type: 'buy', date: '2026-05-15',
                amount: 1000, shares: 500, nav: 2.0,
            });
            expect(res.status).toBe(401);
        });

        it('管理员新增 buy', async () => {
            const res = await adminAgent.post('/api/strategy/etf-holdings').send({
                fundCode: TEST_FUND_CODE, type: 'buy', date: '2026-05-15',
                amount: 1000, shares: 500, nav: 2.0,
            });
            expect(res.status).toBe(200);
            expect(res.body.data.record.id).toBeTruthy();
            createdHoldingIds.push(res.body.data.record.id);
        });

        it('非法 type → 400', async () => {
            const res = await adminAgent.post('/api/strategy/etf-holdings').send({
                fundCode: TEST_FUND_CODE, type: 'xxx', date: '2026-05-15',
                amount: 1000, shares: 500, nav: 2.0,
            });
            expect(res.status).toBe(400);
        });

        it('非法 date → 400', async () => {
            const res = await adminAgent.post('/api/strategy/etf-holdings').send({
                fundCode: TEST_FUND_CODE, type: 'buy', date: '2026/05/15',
                amount: 1000, shares: 500, nav: 2.0,
            });
            expect(res.status).toBe(400);
        });

        it('数值 ≤ 0 → 400', async () => {
            const res = await adminAgent.post('/api/strategy/etf-holdings').send({
                fundCode: TEST_FUND_CODE, type: 'buy', date: '2026-05-15',
                amount: 0, shares: 500, nav: 2.0,
            });
            expect(res.status).toBe(400);
        });

        it('删除不存在 → 404', async () => {
            const res = await adminAgent.post('/api/strategy/etf-holdings/delete').send({ id: 'NOT_EXIST' });
            expect(res.status).toBe(404);
        });
    });

    describe('Sell + tierId 联动', () => {
        it('新增 sell + tierId 自动标记 triggeredAt', async () => {
            await adminAgent.post('/api/strategy/etf-plans').send(validStrategy()); // 重置 tier
            const sell = await adminAgent.post('/api/strategy/etf-holdings').send({
                fundCode: TEST_FUND_CODE, type: 'sell', tierId: 'tp2',
                date: '2026-03-01', amount: 200, shares: 60, nav: 3.3,
            });
            expect(sell.body.success).toBe(true);
            createdHoldingIds.push(sell.body.data.record.id);
            const plans = await createAgent().get('/api/strategy/etf-plans');
            const tier = plans.body.data.strategies
                .find(s => s.fundCode === TEST_FUND_CODE)
                ?.takeProfitTiers.find(t => t.id === 'tp2');
            expect(tier?.triggeredAt).toBeTruthy();
        });

        it('重复触发已 triggered tier → 400', async () => {
            const res = await adminAgent.post('/api/strategy/etf-holdings').send({
                fundCode: TEST_FUND_CODE, type: 'sell', tierId: 'tp2',
                date: '2026-04-01', amount: 100, shares: 30, nav: 3.3,
            });
            expect(res.status).toBe(400);
            expect(res.body.error).toMatch(/已触发/);
        });

        it('删除关联 tier 的 sell → 重置 triggeredAt', async () => {
            const records = (await createAgent().get('/api/strategy/etf-holdings')).body.data.records;
            const sellRec = records.find(r =>
                r.fundCode === TEST_FUND_CODE && r.type === 'sell' && r.tierId === 'tp2'
            );
            if (!sellRec) return;
            await adminAgent.post('/api/strategy/etf-holdings/delete').send({ id: sellRec.id });
            const idx = createdHoldingIds.indexOf(sellRec.id);
            if (idx >= 0) createdHoldingIds.splice(idx, 1);
            const plans = await createAgent().get('/api/strategy/etf-plans');
            const tier = plans.body.data.strategies
                .find(s => s.fundCode === TEST_FUND_CODE)
                ?.takeProfitTiers.find(t => t.id === 'tp2');
            expect(tier?.triggeredAt).toBeNull();
        });

        it('sell + 不存在的 tierId → 400', async () => {
            const res = await adminAgent.post('/api/strategy/etf-holdings').send({
                fundCode: TEST_FUND_CODE, type: 'sell', tierId: 'tp_unknown',
                date: '2026-03-01', amount: 100, shares: 30, nav: 3.3,
            });
            expect(res.status).toBe(400);
            expect(res.body.error).toMatch(/不存在/);
        });
    });

    // ──── etf-recommendations ────
    describe('GET /api/strategy/etf-recommendations', () => {
        it('未登录可读取', async () => {
            const res = await createAgent().get('/api/strategy/etf-recommendations');
            expect(res.status).toBe(200);
            expect(res.body.data.calculatedAt).toBeTruthy();
            expect(Array.isArray(res.body.data.recommendations)).toBe(true);
        }, 60000);

        it('返回每条推荐含必要字段', async () => {
            const res = await createAgent().get('/api/strategy/etf-recommendations');
            const recs = res.body.data.recommendations;
            if (recs.length === 0) return;
            const r = recs[0];
            expect(r.fundCode).toBeDefined();
            expect(Array.isArray(r.tierScans)).toBe(true);
            expect(r.holdings).toBeDefined();
            expect(Array.isArray(r.takeProfitStatus)).toBe(true);
            expect('monthChangePct' in r).toBe(true);
            expect('crashSignal' in r).toBe(true);
        }, 30000);
    });
});
