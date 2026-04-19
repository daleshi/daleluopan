'use strict';

const { createAgent, loginAsAdmin } = require('./setup/helpers');
const { testIndex } = require('./fixtures/testData');

describe('Indices — /api/indices/*', () => {
    let adminAgent;
    let originalWatchlist;

    beforeAll(async () => {
        adminAgent = await loginAsAdmin();
        const res = await adminAgent.get('/api/indices/watchlist');
        originalWatchlist = res.body.data?.indices || [];
    });

    afterAll(async () => {
        // 清理测试过程中添加的 testIndex
        await adminAgent.post('/api/indices/remove').send({ code: testIndex.code }).catch(() => {});
    });

    // ── GET /api/indices/watchlist ────────────────────────────
    describe('GET /api/indices/watchlist', () => {
        it('返回关注列表数组', async () => {
            const res = await createAgent().get('/api/indices/watchlist');
            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);
            expect(Array.isArray(res.body.data.indices)).toBe(true);
        });
    });

    // ── GET /api/indices ──────────────────────────────────────
    describe('GET /api/indices', () => {
        it('返回指数数据结构', async () => {
            const res = await createAgent().get('/api/indices');
            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);
            expect(res.body).toHaveProperty('trading');
        }, 60000);

        it('?detail=1 返回更多字段', async () => {
            const res = await createAgent().get('/api/indices?detail=1');
            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);
        }, 60000);
    });

    // ── GET /api/indices/quotes ───────────────────────────────
    describe('GET /api/indices/quotes', () => {
        it('返回行情数据', async () => {
            const res = await createAgent().get('/api/indices/quotes');
            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);
        }, 60000);
    });

    // ── GET /api/indices/search ───────────────────────────────
    describe('GET /api/indices/search', () => {
        it('未登录时返回 401', async () => {
            const res = await createAgent().get('/api/indices/search?q=300');
            expect(res.status).toBe(401);
        });

        it('登录后可搜索指数', async () => {
            const res = await adminAgent.get('/api/indices/search?q=沪深300');
            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);
            expect(Array.isArray(res.body.data.results)).toBe(true);
        }, 30000);

        it('空关键词时返回空结果或错误', async () => {
            const res = await adminAgent.get('/api/indices/search?q=');
            expect([200, 400]).toContain(res.status);
        });
    });

    // ── POST /api/indices/add ─────────────────────────────────
    describe('POST /api/indices/add', () => {
        it('未登录时返回 401', async () => {
            const res = await createAgent().post('/api/indices/add').send(testIndex);
            expect(res.status).toBe(401);
        });

        it('成功添加指数', async () => {
            const res = await adminAgent.post('/api/indices/add').send(testIndex);
            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);
        });

        it('重复添加时返回错误', async () => {
            const res = await adminAgent.post('/api/indices/add').send(testIndex);
            expect(res.body.success).toBe(false);
        });

        it('缺少必填字段时返回错误', async () => {
            const res = await adminAgent.post('/api/indices/add').send({ code: '000001' });
            expect(res.body.success).toBe(false);
        });
    });

    // ── POST /api/indices/remove ──────────────────────────────
    describe('POST /api/indices/remove', () => {
        it('未登录时返回 401', async () => {
            const res = await createAgent().post('/api/indices/remove').send({ code: testIndex.code });
            expect(res.status).toBe(401);
        });

        it('成功删除已添加的指数', async () => {
            const res = await adminAgent.post('/api/indices/remove').send({ code: testIndex.code });
            expect(res.body.success).toBe(true);
        });

        it('删除不存在的指数时返回错误', async () => {
            const res = await adminAgent.post('/api/indices/remove').send({ code: '000000' });
            expect(res.body.success).toBe(false);
        });
    });
});
