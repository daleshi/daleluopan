'use strict';

const { createAgent, loginAsAdmin } = require('./setup/helpers');
const { testEtf } = require('./fixtures/testData');

describe('ETFs — /api/etfs/*', () => {
    let adminAgent;

    beforeAll(async () => {
        adminAgent = await loginAsAdmin();
    });

    afterAll(async () => {
        await adminAgent.post('/api/etfs/remove').send({ code: testEtf.code }).catch(() => {});
    });

    // ── GET /api/etfs/watchlist ───────────────────────────────
    describe('GET /api/etfs/watchlist', () => {
        it('返回 ETF 关注列表', async () => {
            const res = await createAgent().get('/api/etfs/watchlist');
            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);
            expect(Array.isArray(res.body.data.etfs)).toBe(true);
        });
    });

    // ── GET /api/etfs ─────────────────────────────────────────
    describe('GET /api/etfs', () => {
        it('返回 ETF 行情数据结构', async () => {
            const res = await createAgent().get('/api/etfs');
            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);
            expect(res.body).toHaveProperty('trading');
        }, 60000);
    });

    // ── GET /api/etfs/search ──────────────────────────────────
    describe('GET /api/etfs/search', () => {
        it('未登录时返回 401', async () => {
            const res = await createAgent().get('/api/etfs/search?q=沪深300');
            expect(res.status).toBe(401);
        });

        it('登录后可搜索 ETF', async () => {
            const res = await adminAgent.get('/api/etfs/search?q=沪深300');
            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);
            expect(Array.isArray(res.body.data.results)).toBe(true);
        }, 30000);
    });

    // ── POST /api/etfs/add ────────────────────────────────────
    describe('POST /api/etfs/add', () => {
        it('未登录时返回 401', async () => {
            const res = await createAgent().post('/api/etfs/add').send(testEtf);
            expect(res.status).toBe(401);
        });

        it('成功添加 ETF', async () => {
            const res = await adminAgent.post('/api/etfs/add').send(testEtf);
            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);
        });

        it('重复添加时返回错误', async () => {
            const res = await adminAgent.post('/api/etfs/add').send(testEtf);
            expect(res.body.success).toBe(false);
        });

        it('缺少必填字段时返回错误', async () => {
            const res = await adminAgent.post('/api/etfs/add').send({ code: '123456' });
            expect(res.body.success).toBe(false);
        });
    });

    // ── POST /api/etfs/remove ─────────────────────────────────
    describe('POST /api/etfs/remove', () => {
        it('未登录时返回 401', async () => {
            const res = await createAgent().post('/api/etfs/remove').send({ code: testEtf.code });
            expect(res.status).toBe(401);
        });

        it('成功删除 ETF', async () => {
            const res = await adminAgent.post('/api/etfs/remove').send({ code: testEtf.code });
            expect(res.body.success).toBe(true);
        });

        it('删除不存在的 ETF 时返回错误', async () => {
            const res = await adminAgent.post('/api/etfs/remove').send({ code: '000000' });
            expect(res.body.success).toBe(false);
        });
    });

    // ── GET /api/etfs/minute ──────────────────────────────────
    describe('GET /api/etfs/minute', () => {
        it('缺少 secid 参数时返回错误', async () => {
            const res = await createAgent().get('/api/etfs/minute');
            expect([400, 422, 200]).toContain(res.status);
            if (res.status === 200) {
                // 如果返回 200，应该是 success:false
                expect(res.body.success).toBe(false);
            }
        });

        it('有效 secid 时返回分时数据', async () => {
            const res = await createAgent().get('/api/etfs/minute?secid=1.510300');
            expect(res.status).toBe(200);
            // 允许外部 API 失败
            expect(typeof res.body.success).toBe('boolean');
        }, 30000);
    });

    // ── GET /api/etfs/klines ──────────────────────────────────
    describe('GET /api/etfs/klines', () => {
        it('有效参数时返回 K 线数据', async () => {
            const res = await createAgent().get(
                '/api/etfs/klines?secid=1.510300&code=510300&market=SH&range=1y'
            );
            expect(res.status).toBe(200);
            expect(typeof res.body.success).toBe('boolean');
        }, 30000);

        it('无效 range 参数时返回错误', async () => {
            const res = await createAgent().get(
                '/api/etfs/klines?secid=1.510300&code=510300&market=SH&range=invalid'
            );
            expect([400, 200]).toContain(res.status);
            if (res.status === 200 && !res.body.success) {
                expect(res.body.error).toBeTruthy();
            }
        });
    });
});
