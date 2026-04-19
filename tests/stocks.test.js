'use strict';

const { createAgent, loginAsAdmin } = require('./setup/helpers');
const { testStock } = require('./fixtures/testData');

describe('Stocks — /api/stocks/*', () => {
    let adminAgent;

    beforeAll(async () => {
        adminAgent = await loginAsAdmin();
    });

    afterAll(async () => {
        await adminAgent.post('/api/stocks/remove').send({ code: testStock.code }).catch(() => {});
    });

    // ── GET /api/stocks/watchlist ─────────────────────────────
    describe('GET /api/stocks/watchlist', () => {
        it('返回股票关注列表', async () => {
            const res = await createAgent().get('/api/stocks/watchlist');
            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);
            expect(Array.isArray(res.body.data.stocks)).toBe(true);
        });
    });

    // ── GET /api/stocks ───────────────────────────────────────
    describe('GET /api/stocks', () => {
        it('返回股票行情数据', async () => {
            const res = await createAgent().get('/api/stocks');
            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);
            expect(res.body).toHaveProperty('trading');
        }, 60000);
    });

    // ── GET /api/stocks/search ────────────────────────────────
    describe('GET /api/stocks/search', () => {
        it('未登录时返回 401', async () => {
            const res = await createAgent().get('/api/stocks/search?q=平安');
            expect(res.status).toBe(401);
        });

        it('登录后可搜索股票', async () => {
            const res = await adminAgent.get('/api/stocks/search?q=平安');
            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);
            expect(Array.isArray(res.body.data.results)).toBe(true);
        }, 30000);
    });

    // ── POST /api/stocks/add ──────────────────────────────────
    describe('POST /api/stocks/add', () => {
        it('未登录时返回 401', async () => {
            const res = await createAgent().post('/api/stocks/add').send(testStock);
            expect(res.status).toBe(401);
        });

        it('成功添加股票', async () => {
            const res = await adminAgent.post('/api/stocks/add').send(testStock);
            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);
            expect(res.body.data.stock.code).toBe(testStock.code);
        });

        it('重复添加时返回错误', async () => {
            const res = await adminAgent.post('/api/stocks/add').send(testStock);
            expect(res.body.success).toBe(false);
        });

        it('代码非6位时返回错误', async () => {
            const res = await adminAgent.post('/api/stocks/add').send({
                ...testStock,
                code: '12345',
            });
            expect(res.body.success).toBe(false);
        });
    });

    // ── POST /api/stocks/remove ───────────────────────────────
    describe('POST /api/stocks/remove', () => {
        it('未登录时返回 401', async () => {
            const res = await createAgent().post('/api/stocks/remove').send({ code: testStock.code });
            expect(res.status).toBe(401);
        });

        it('成功删除股票', async () => {
            const res = await adminAgent.post('/api/stocks/remove').send({ code: testStock.code });
            expect(res.body.success).toBe(true);
        });

        it('删除不存在的股票时返回错误', async () => {
            const res = await adminAgent.post('/api/stocks/remove').send({ code: '000000' });
            expect(res.body.success).toBe(false);
        });
    });

    // ── POST /api/stocks/watchlist（批量更新）─────────────────────
    describe('POST /api/stocks/watchlist', () => {
        it('未登录时返回 401', async () => {
            const res = await createAgent().post('/api/stocks/watchlist').send({ stocks: [] });
            expect(res.status).toBe(401);
        });

        it('传空数组时服务器拒绝（至少需要一只）', async () => {
            const clearRes = await adminAgent.post('/api/stocks/watchlist').send({ stocks: [] });
            expect(clearRes.body.success).toBe(false);
            expect(clearRes.body.error).toBeTruthy();
        });
    });
});
