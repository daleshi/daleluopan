'use strict';

/**
 * 标普 500 投资策略 API 集成测试
 * 覆盖: GET / POST / Recommendations
 */

const { createAgent, loginAs, loginAsAdmin } = require('./setup/helpers');

const validStrategy = () => ({
    name: '标普500投资策略',
    indexCode: 'SPX',
    indexSecid: '100.SPX',
    offsite: {
        fundCode: '017641',
        fundName: '摩根标普500指数(QDII)人民币A',
        monthlyAmount: 1000,
        tiers: [
            { id: 'pause',  label: '暂停', color: 'purple', multiplier: 0,   drawdownLt: 3 },
            { id: 'half',   label: '减半', color: 'yellow', multiplier: 50,  drawdownLt: 10 },
            { id: 'normal', label: '正常', color: 'green',  multiplier: 100, drawdownLt: 20 },
            { id: 'double', label: '加倍', color: 'red',    multiplier: 200, drawdownLt: null },
        ],
    },
    onsite: {
        etfCode: '513500',
        etfName: '博时标普500',
        etfSecid: '1.513500',
        signals: [
            { id: 'idle',   label: '未到时机', color: 'gray',   amount: 0,     drawdownLt: 3 },
            { id: 'watch',  label: '可关注',   color: 'yellow', amount: 5000,  drawdownLt: 10 },
            { id: 'buy',    label: '可加仓',   color: 'orange', amount: 10000, drawdownLt: 20 },
            { id: 'strong', label: '强烈加仓', color: 'red',    amount: 15000, drawdownLt: null },
        ],
        premiumGate: { fullPassMaxPct: 0.5, halfPassMaxPct: 1.5 },
    },
});

describe('SP500 Strategy — /api/strategy/sp500-*', () => {
    let adminAgent;
    let originalStrategy = null;

    beforeAll(async () => {
        adminAgent = await loginAsAdmin();
        const res = await adminAgent.get('/api/strategy/sp500-plans');
        if (res.body?.data?.strategy) {
            originalStrategy = res.body.data.strategy;
        }
    });

    afterAll(async () => {
        if (originalStrategy) {
            await adminAgent.post('/api/strategy/sp500-plans').send(originalStrategy).catch(() => {});
        }
    });

    // ── GET /api/strategy/sp500-plans ─────────────────
    describe('GET /api/strategy/sp500-plans', () => {
        it('未登录可读取策略', async () => {
            const res = await createAgent().get('/api/strategy/sp500-plans');
            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);
            expect(res.body.data).toBeDefined();
        });

        it('默认策略含 offsite/onsite 子配置', async () => {
            const res = await createAgent().get('/api/strategy/sp500-plans');
            const s = res.body.data.strategy;
            if (s) {
                expect(s.offsite).toBeDefined();
                expect(s.offsite.fundCode).toBeDefined();
                expect(s.onsite).toBeDefined();
                expect(s.onsite.etfSecid).toBeDefined();
                expect(s.onsite.premiumGate).toBeDefined();
            }
        });
    });

    // ── POST /api/strategy/sp500-plans ────────────────
    describe('POST /api/strategy/sp500-plans', () => {
        it('未登录返回 401', async () => {
            const res = await createAgent().post('/api/strategy/sp500-plans').send(validStrategy());
            expect(res.status).toBe(401);
        });

        it('普通用户返回 403', async () => {
            const uname = `spu_${String(Date.now()).slice(-6)}`;
            await adminAgent.post('/api/admin/users').send({
                username: uname, password: 'Test12345', role: 'user',
            });
            const agent = await loginAs(uname, 'Test12345');
            const res = await agent.post('/api/strategy/sp500-plans').send(validStrategy());
            expect(res.status).toBe(403);
            await adminAgent.post('/api/admin/users/delete').send({ username: uname }).catch(() => {});
        });

        it('管理员成功更新策略', async () => {
            const payload = validStrategy();
            payload.offsite.monthlyAmount = 1500;
            const res = await adminAgent.post('/api/strategy/sp500-plans').send(payload);
            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);
            expect(res.body.data.strategy.offsite.monthlyAmount).toBe(1500);
        });

        it('缺 offsite.fundCode → 400', async () => {
            const payload = validStrategy();
            delete payload.offsite.fundCode;
            const res = await adminAgent.post('/api/strategy/sp500-plans').send(payload);
            expect(res.status).toBe(400);
            expect(res.body.error).toMatch(/fundCode/);
        });

        it('缺 onsite.etfSecid → 400', async () => {
            const payload = validStrategy();
            delete payload.onsite.etfSecid;
            const res = await adminAgent.post('/api/strategy/sp500-plans').send(payload);
            expect(res.status).toBe(400);
        });

        it('fullPassMaxPct >= halfPassMaxPct → 400', async () => {
            const payload = validStrategy();
            payload.onsite.premiumGate = { fullPassMaxPct: 2.0, halfPassMaxPct: 1.0 };
            const res = await adminAgent.post('/api/strategy/sp500-plans').send(payload);
            expect(res.status).toBe(400);
            expect(res.body.error).toMatch(/fullPassMaxPct/);
        });

        it('offsite.monthlyAmount <= 0 → 400', async () => {
            const payload = validStrategy();
            payload.offsite.monthlyAmount = 0;
            const res = await adminAgent.post('/api/strategy/sp500-plans').send(payload);
            expect(res.status).toBe(400);
            expect(res.body.error).toMatch(/正数/);
        });

        it('offsite.tiers 全部带上界（无兜底）→ 400', async () => {
            const payload = validStrategy();
            // 把所有 tier 都改成 id 不是 double/normal 且 drawdownLt 非 null
            payload.offsite.tiers = [
                { id: 'tier-a', label: 'A', color: 'green',  multiplier: 100, drawdownLt: 5 },
                { id: 'tier-b', label: 'B', color: 'yellow', multiplier: 50,  drawdownLt: 10 },
            ];
            const res = await adminAgent.post('/api/strategy/sp500-plans').send(payload);
            expect(res.status).toBe(400);
            expect(res.body.error).toMatch(/兜底/);
        });
    });

    // ── GET /api/strategy/sp500-recommendations ───────
    describe('GET /api/strategy/sp500-recommendations', () => {
        it('未登录可读取推荐', async () => {
            const res = await createAgent().get('/api/strategy/sp500-recommendations');
            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);
            expect(res.body.data).toBeDefined();
        }, 60000);

        it('响应包含完整字段', async () => {
            const res = await createAgent().get('/api/strategy/sp500-recommendations');
            const d = res.body.data;
            expect(d.calculatedAt).toBeDefined();
            // 共享指标顶层字段（值可能 null，但 key 必须存在）
            expect(d).toHaveProperty('drawdownFromPeak5Y');
            expect(d).toHaveProperty('peakClose5Y');
            expect(d).toHaveProperty('peakDate5Y');
            expect(d).toHaveProperty('latestClose');
            // offsite
            expect(d.offsite).toBeDefined();
            expect(d.offsite).toHaveProperty('hitTier');
            expect(d.offsite).toHaveProperty('actualAmount');
            expect(d.offsite).toHaveProperty('tierScans');
            // onsite
            expect(d.onsite).toBeDefined();
            expect(d.onsite).toHaveProperty('hitSignal');
            expect(d.onsite).toHaveProperty('premium');
            expect(d.onsite).toHaveProperty('baseAmount');
            expect(d.onsite).toHaveProperty('suggestedAmount');
            expect(d.onsite).toHaveProperty('signalScans');
        }, 60000);
    });
});
