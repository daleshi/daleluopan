'use strict';

const { createAgent, loginAs, loginAsAdmin } = require('./setup/helpers');
const { testDcaPlan } = require('./fixtures/testData');

describe('Strategy — /api/strategy/*', () => {
    let adminAgent;

    beforeAll(async () => {
        adminAgent = await loginAsAdmin();
    });

    afterAll(async () => {
        await adminAgent
            .post('/api/strategy/dca-plans/delete')
            .send({ indexCode: testDcaPlan.indexCode })
            .catch(() => {});
    });

    // ── GET /api/strategy/dca-plans ───────────────────────────
    describe('GET /api/strategy/dca-plans', () => {
        it('无需登录可获取定投策略列表', async () => {
            const res = await createAgent().get('/api/strategy/dca-plans');
            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);
            expect(Array.isArray(res.body.data.plans)).toBe(true);
        });
    });

    // ── POST /api/strategy/dca-plans ──────────────────────────
    describe('POST /api/strategy/dca-plans', () => {
        it('未登录时返回 401', async () => {
            const res = await createAgent().post('/api/strategy/dca-plans').send(testDcaPlan);
            expect(res.status).toBe(401);
        });

        it('普通用户无权创建（requireAdmin）', async () => {
            const uname = `su_${String(Date.now()).slice(-6)}`;
            await adminAgent.post('/api/admin/users').send({
                username: uname,
                password: 'Test12345',
                role: 'user',
            });
            const agent = await loginAs(uname, 'Test12345');
            const res = await agent.post('/api/strategy/dca-plans').send(testDcaPlan);
            expect(res.status).toBe(403);
            await adminAgent.post('/api/admin/users/delete').send({ username: uname }).catch(() => {});
        });

        it('管理员成功创建定投策略', async () => {
            const res = await adminAgent.post('/api/strategy/dca-plans').send(testDcaPlan);
            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);
            const plan = res.body.data.plans.find(p => p.indexCode === testDcaPlan.indexCode);
            expect(plan).toBeTruthy();
        });

        it('相同 indexCode 时执行 upsert（更新而非新增）', async () => {
            const updated = { ...testDcaPlan, monthlyAmount: 2000 };
            const res = await adminAgent.post('/api/strategy/dca-plans').send(updated);
            expect(res.body.success).toBe(true);
            const plan = res.body.data.plans.find(p => p.indexCode === testDcaPlan.indexCode);
            expect(plan.monthlyAmount).toBe(2000);
            // 列表中该 code 只出现一次
            const count = res.body.data.plans.filter(p => p.indexCode === testDcaPlan.indexCode).length;
            expect(count).toBe(1);
        });

        it('缺少必填字段时返回错误', async () => {
            const res = await adminAgent.post('/api/strategy/dca-plans').send({ indexCode: 'X' });
            expect(res.body.success).toBe(false);
        });
    });

    // ── POST /api/strategy/dca-plans/delete ───────────────────
    describe('POST /api/strategy/dca-plans/delete', () => {
        it('未登录时返回 401', async () => {
            const res = await createAgent()
                .post('/api/strategy/dca-plans/delete')
                .send({ indexCode: testDcaPlan.indexCode });
            expect(res.status).toBe(401);
        });

        it('成功删除定投策略', async () => {
            const res = await adminAgent
                .post('/api/strategy/dca-plans/delete')
                .send({ indexCode: testDcaPlan.indexCode });
            expect(res.body.success).toBe(true);
            const plan = res.body.data.plans.find(p => p.indexCode === testDcaPlan.indexCode);
            expect(plan).toBeFalsy();
        });

        it('删除不存在的策略时返回错误', async () => {
            const res = await adminAgent
                .post('/api/strategy/dca-plans/delete')
                .send({ indexCode: 'NONEXISTENT' });
            expect(res.body.success).toBe(false);
        });
    });
});
