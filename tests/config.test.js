'use strict';

const { createAgent, loginAsAdmin } = require('./setup/helpers');

describe('Config — /api/site-config & /api/datasources', () => {
    let adminAgent;
    let originalSiteConfig;
    let originalDatasources;

    beforeAll(async () => {
        adminAgent = await loginAsAdmin();
        const sc = await adminAgent.get('/api/site-config');
        originalSiteConfig = sc.body.data;
        const ds = await adminAgent.get('/api/datasources');
        originalDatasources = ds.body.data;
    });

    afterAll(async () => {
        // 恢复站点配置
        if (originalSiteConfig) {
            await adminAgent.post('/api/site-config').send(originalSiteConfig).catch(() => {});
        }
        // 恢复数据源配置
        if (originalDatasources) {
            await adminAgent.post('/api/datasources').send(originalDatasources).catch(() => {});
        }
    });

    // ── GET /api/site-config ──────────────────────────────────
    describe('GET /api/site-config', () => {
        it('无需登录可获取站点配置', async () => {
            const res = await createAgent().get('/api/site-config');
            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);
            expect(typeof res.body.data.loginEnabled).toBe('boolean');
        });
    });

    // ── POST /api/site-config ─────────────────────────────────
    describe('POST /api/site-config', () => {
        it('未登录时返回 401', async () => {
            const res = await createAgent().post('/api/site-config').send({ loginEnabled: true });
            expect(res.status).toBe(401);
        });

        it('管理员可更新站点配置', async () => {
            const current = originalSiteConfig?.loginEnabled ?? true;
            const res = await adminAgent.post('/api/site-config').send({ loginEnabled: current });
            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);
            expect(typeof res.body.data.loginEnabled).toBe('boolean');
        });
    });

    // ── GET /api/datasources ──────────────────────────────────
    describe('GET /api/datasources', () => {
        it('无需登录可获取数据源配置', async () => {
            const res = await createAgent().get('/api/datasources');
            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);
            expect(res.body.data).toHaveProperty('enabled');
        });
    });

    // ── POST /api/datasources ─────────────────────────────────
    describe('POST /api/datasources', () => {
        it('未登录时返回 401', async () => {
            const res = await createAgent().post('/api/datasources').send({ enabled: {} });
            expect(res.status).toBe(401);
        });

        it('已登录用户可更新数据源配置', async () => {
            const current = originalDatasources?.enabled || {};
            const res = await adminAgent.post('/api/datasources').send({ enabled: current });
            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);
        });

        it('核心数据源（danjuan-wind / eastmoney）始终保持启用', async () => {
            // 尝试禁用核心源
            const res = await adminAgent.post('/api/datasources').send({
                enabled: { 'danjuan-wind': false, eastmoney: false },
            });
            expect(res.body.success).toBe(true);
            // 核心源应仍为 true
            expect(res.body.data.enabled['danjuan-wind']).toBe(true);
            expect(res.body.data.enabled.eastmoney).toBe(true);
        });
    });
});
