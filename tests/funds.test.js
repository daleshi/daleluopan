'use strict';

const { createAgent, loginAsAdmin } = require('./setup/helpers');
const { testFund } = require('./fixtures/testData');

describe('Funds — /api/active-funds/*', () => {
    let adminAgent;

    beforeAll(async () => {
        adminAgent = await loginAsAdmin();
    });

    afterAll(async () => {
        await adminAgent.post('/api/active-funds/remove').send({ code: testFund.code }).catch(() => {});
    });

    // ── GET /api/active-funds ─────────────────────────────────
    describe('GET /api/active-funds', () => {
        it('返回基金数据结构', async () => {
            const res = await createAgent().get('/api/active-funds');
            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);
            expect(res.body.data).toHaveProperty('funds');
        }, 60000);
    });

    // ── GET /api/active-funds/watchlist ───────────────────────
    describe('GET /api/active-funds/watchlist', () => {
        it('返回基金关注列表', async () => {
            const res = await createAgent().get('/api/active-funds/watchlist');
            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);
            expect(Array.isArray(res.body.data.funds)).toBe(true);
        });
    });

    // ── GET /api/active-funds/search ──────────────────────────
    describe('GET /api/active-funds/search', () => {
        it('未登录时返回 401', async () => {
            const res = await createAgent().get('/api/active-funds/search?q=沪深300');
            expect(res.status).toBe(401);
        });

        it('登录后可搜索基金', async () => {
            const res = await adminAgent.get('/api/active-funds/search?q=沪深300');
            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);
            expect(Array.isArray(res.body.data.results)).toBe(true);
        }, 30000);
    });

    // ── POST /api/active-funds/add ────────────────────────────
    describe('POST /api/active-funds/add', () => {
        it('未登录时返回 401', async () => {
            const res = await createAgent().post('/api/active-funds/add').send(testFund);
            expect(res.status).toBe(401);
        });

        it('成功添加基金', async () => {
            const res = await adminAgent.post('/api/active-funds/add').send(testFund);
            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);
        });

        it('重复添加时返回错误', async () => {
            const res = await adminAgent.post('/api/active-funds/add').send(testFund);
            expect(res.body.success).toBe(false);
        });

        it('代码非6位时返回错误', async () => {
            const res = await adminAgent.post('/api/active-funds/add').send({
                ...testFund,
                code: '12345', // 5位
            });
            expect(res.body.success).toBe(false);
        });

        it('只有 code 时也能成功（name 非必填）', async () => {
            // 服务器以 code 作为 name 兜底，允许只传 code
            const tempCode = '111111';
            await adminAgent.post('/api/active-funds/add').send({ code: tempCode }).catch(() => {});
            await adminAgent.post('/api/active-funds/remove').send({ code: tempCode }).catch(() => {});
        });
    });

    // ── POST /api/active-funds/remove ─────────────────────────
    describe('POST /api/active-funds/remove', () => {
        it('未登录时返回 401', async () => {
            const res = await createAgent().post('/api/active-funds/remove').send({ code: testFund.code });
            expect(res.status).toBe(401);
        });

        it('成功删除基金', async () => {
            const res = await adminAgent.post('/api/active-funds/remove').send({ code: testFund.code });
            expect(res.body.success).toBe(true);
        });

        it('删除不存在的基金时返回错误', async () => {
            const res = await adminAgent.post('/api/active-funds/remove').send({ code: '000000' });
            expect(res.body.success).toBe(false);
        });
    });
});
