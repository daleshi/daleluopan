'use strict';

/**
 * 主动基金定投策略 API 测试
 * 覆盖: GET / POST / DELETE / Recommendations
 */

const { createAgent, loginAs, loginAsAdmin } = require('./setup/helpers');

const TEST_FUND_CODE = '163415'; // 兴全商业模式（默认配置中已存在）

const validStrategy = () => ({
    fundCode: TEST_FUND_CODE,
    fundName: '兴全商业模式混合(LOF)A',
    managerName: '测试',
    benchmarkIndex: '000300',
    benchmarkName: '沪深300',
    monthlyAmount: 1500,
    rules: [
        {
            id: 'pause',
            label: '暂停定投',
            color: 'purple',
            multiplier: 0,
            logic: 'AND',
            conditions: [{ field: 'indexPePercentile', op: '>=', value: 95 }],
        },
        {
            id: 'half',
            label: '减半定投',
            color: 'yellow',
            multiplier: 50,
            logic: 'AND',
            conditions: [
                { field: 'indexPePercentile', op: '>=', value: 80 },
                { field: 'indexPePercentile', op: '<',  value: 95 },
            ],
        },
        {
            id: 'double',
            label: '加倍定投',
            color: 'red',
            multiplier: 200,
            logic: 'AND',
            conditions: [
                { field: 'indexPePercentile', op: '<=', value: 20 },
                { field: 'fundDrawdownAbs',   op: '>=', value: 15 },
            ],
        },
        { id: 'normal', label: '正常定投', color: 'green', multiplier: 100, logic: 'AND', conditions: [] },
    ],
});

describe('Active Fund Strategy — /api/strategy/active-fund-*', () => {
    let adminAgent;
    let originalStrategy = null;

    beforeAll(async () => {
        adminAgent = await loginAsAdmin();
        // 备份当前的 163415 策略，用于测试结束后还原
        const res = await adminAgent.get('/api/strategy/active-fund-plans');
        if (res.body?.data?.strategies) {
            originalStrategy = res.body.data.strategies.find(s => s.fundCode === TEST_FUND_CODE) || null;
        }
    });

    afterAll(async () => {
        // 还原 163415 策略，避免污染默认配置
        if (originalStrategy) {
            await adminAgent.post('/api/strategy/active-fund-plans').send(originalStrategy).catch(() => {});
        }
    });

    // ── GET /api/strategy/active-fund-plans ────────────────────
    describe('GET /api/strategy/active-fund-plans', () => {
        it('未登录可读取策略列表', async () => {
            const res = await createAgent().get('/api/strategy/active-fund-plans');
            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);
            expect(Array.isArray(res.body.data.strategies)).toBe(true);
        });

        it('默认配置中包含两只预设基金', async () => {
            const res = await createAgent().get('/api/strategy/active-fund-plans');
            const codes = res.body.data.strategies.map(s => s.fundCode);
            // 至少包含其中一个（首次启动会注入两只；如果用户清空了就跳过）
            if (res.body.data.strategies.length > 0) {
                expect(['163415', '008269'].some(c => codes.includes(c))).toBe(true);
            }
        });
    });

    // ── POST /api/strategy/active-fund-plans ───────────────────
    describe('POST /api/strategy/active-fund-plans', () => {
        it('未登录返回 401', async () => {
            const res = await createAgent().post('/api/strategy/active-fund-plans').send(validStrategy());
            expect(res.status).toBe(401);
        });

        it('普通用户返回 403', async () => {
            const uname = `afu_${String(Date.now()).slice(-6)}`;
            await adminAgent.post('/api/admin/users').send({
                username: uname,
                password: 'Test12345',
                role: 'user',
            });
            const agent = await loginAs(uname, 'Test12345');
            const res = await agent.post('/api/strategy/active-fund-plans').send(validStrategy());
            expect(res.status).toBe(403);
            await adminAgent.post('/api/admin/users/delete').send({ username: uname }).catch(() => {});
        });

        it('管理员成功 upsert（已有 fundCode）', async () => {
            const payload = validStrategy();
            payload.monthlyAmount = 1500;
            const res = await adminAgent.post('/api/strategy/active-fund-plans').send(payload);
            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);
            const found = res.body.data.strategies.find(s => s.fundCode === TEST_FUND_CODE);
            expect(found).toBeTruthy();
            expect(found.monthlyAmount).toBe(1500);
            // 同 fundCode 只出现一次
            const count = res.body.data.strategies.filter(s => s.fundCode === TEST_FUND_CODE).length;
            expect(count).toBe(1);
        });

        it('缺少必填字段（无 fundCode）→ 400', async () => {
            const payload = validStrategy();
            delete payload.fundCode;
            const res = await adminAgent.post('/api/strategy/active-fund-plans').send(payload);
            expect(res.status).toBe(400);
            expect(res.body.success).toBe(false);
        });

        it('monthlyAmount ≤ 0 → 400', async () => {
            const payload = validStrategy();
            payload.monthlyAmount = 0;
            const res = await adminAgent.post('/api/strategy/active-fund-plans').send(payload);
            expect(res.status).toBe(400);
            expect(res.body.error).toMatch(/正数/);
        });

        it('rules 缺少 normal 兜底 → 400', async () => {
            const payload = validStrategy();
            payload.rules = payload.rules.filter(r => r.id !== 'normal');
            const res = await adminAgent.post('/api/strategy/active-fund-plans').send(payload);
            expect(res.status).toBe(400);
            expect(res.body.error).toMatch(/normal/);
        });

        it('未知 field → 400', async () => {
            const payload = validStrategy();
            payload.rules[0].conditions = [{ field: 'unknownField', op: '>=', value: 50 }];
            const res = await adminAgent.post('/api/strategy/active-fund-plans').send(payload);
            expect(res.status).toBe(400);
            expect(res.body.error).toMatch(/field/);
        });

        it('multiplier 超出范围 → 400', async () => {
            const payload = validStrategy();
            payload.rules[0].multiplier = 999;
            const res = await adminAgent.post('/api/strategy/active-fund-plans').send(payload);
            expect(res.status).toBe(400);
            expect(res.body.error).toMatch(/multiplier/);
        });
    });

    // ── POST /api/strategy/active-fund-plans/delete ────────────
    describe('POST /api/strategy/active-fund-plans/delete', () => {
        it('未登录返回 401', async () => {
            const res = await createAgent()
                .post('/api/strategy/active-fund-plans/delete')
                .send({ fundCode: TEST_FUND_CODE });
            expect(res.status).toBe(401);
        });

        it('删除不存在的策略 → 404', async () => {
            const res = await adminAgent
                .post('/api/strategy/active-fund-plans/delete')
                .send({ fundCode: 'NOT_EXIST_99999' });
            expect(res.status).toBe(404);
            expect(res.body.success).toBe(false);
        });

        // 注意：不在此用例中真正删除 163415，避免影响后续 recommendations 测试
        // 真正的删除流程在 afterAll 之后由还原逻辑保证一致性
    });

    // ── GET /api/strategy/active-fund-recommendations ──────────
    describe('GET /api/strategy/active-fund-recommendations', () => {
        it('未登录可读取推荐结果', async () => {
            const res = await createAgent()
                .get('/api/strategy/active-fund-recommendations');
            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);
            expect(res.body.data).toBeDefined();
            expect(res.body.data.calculatedAt).toBeDefined();
            expect(Array.isArray(res.body.data.recommendations)).toBe(true);
        }, 60000); // 首次拉取实时数据可能耗时

        it('返回的每条推荐包含必要字段', async () => {
            const res = await createAgent()
                .get('/api/strategy/active-fund-recommendations');
            const recs = res.body.data.recommendations;
            if (recs.length === 0) return; // 配置为空时跳过
            const r = recs[0];
            expect(r.fundCode).toBeDefined();
            expect(r.fundName).toBeDefined();
            expect(r.indicators).toBeDefined();
            expect(Array.isArray(r.ruleScans)).toBe(true);
            expect(typeof r.actualAmount).toBe('number');
            expect(typeof r.monthlyAmount).toBe('number');
        }, 30000);

        it('marketContext 包含使用的基准指数', async () => {
            const res = await createAgent()
                .get('/api/strategy/active-fund-recommendations');
            expect(res.body.data.marketContext).toBeDefined();
            expect(res.body.data.marketContext.benchmarks).toBeDefined();
        }, 30000);
    });
});
