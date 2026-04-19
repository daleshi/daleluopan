'use strict';

const { createAgent } = require('./setup/helpers');

describe('Analytics — /api/health, /api/stats, /api/daily-eval, /api/thermometer', () => {

    // ── GET /api/health ───────────────────────────────────────
    describe('GET /api/health', () => {
        it('返回健康检查结构', async () => {
            const res = await createAgent().get('/api/health');
            expect(res.status).toBe(200);
            expect(res.body.status).toBe('ok');
            expect(typeof res.body.uptime).toBe('string');
            expect(typeof res.body.trading).toBe('boolean');
            expect(res.body).toHaveProperty('cache');
        });
    });

    // ── GET /api/stats ────────────────────────────────────────
    describe('GET /api/stats', () => {
        it('返回站点统计数据', async () => {
            const res = await createAgent().get('/api/stats');
            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);
            expect(res.body.data).toHaveProperty('overview');
            const { overview } = res.body.data;
            expect(typeof overview.totalPV).toBe('number');
            expect(typeof overview.totalUV).toBe('number');
        });
    });

    // ── GET /api/daily-eval ───────────────────────────────────
    describe('GET /api/daily-eval', () => {
        it('返回每日估值数据（容忍外部 API 失败）', async () => {
            const res = await createAgent().get('/api/daily-eval');
            expect(res.status).toBe(200);
            // 允许外部 API 失败导致 success:false，但结构必须正确
            expect(typeof res.body.success).toBe('boolean');
            if (res.body.success) {
                expect(res.body.data).toHaveProperty('items');
                expect(Array.isArray(res.body.data.items)).toBe(true);
            }
        }, 60000);
    });

    // ── GET /api/thermometer/detail ───────────────────────────
    describe('GET /api/thermometer/detail', () => {
        it('缺少 code 参数时返回错误', async () => {
            const res = await createAgent().get('/api/thermometer/detail');
            expect([400, 200]).toContain(res.status);
            if (res.status === 200) {
                expect(res.body.success).toBe(false);
            }
        });

        it('有效 code 时返回温度详情数据（容忍外部 API 失败）', async () => {
            const res = await createAgent().get('/api/thermometer/detail?code=000300.SH');
            expect(res.status).toBe(200);
            expect(typeof res.body.success).toBe('boolean');
            if (res.body.success) {
                expect(res.body.data).toBeTruthy();
            }
        }, 30000);
    });
});
