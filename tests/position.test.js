'use strict';

const { createAgent, loginAsAdmin } = require('./setup/helpers');
const { testBenchmark } = require('./fixtures/testData');

describe('Position — /api/position/*', () => {
    let adminAgent;
    let createdRecordId;

    beforeAll(async () => {
        adminAgent = await loginAsAdmin();
    });

    afterAll(async () => {
        await adminAgent
            .post('/api/position/benchmarks/delete')
            .send({ indexCode: testBenchmark.indexCode })
            .catch(() => {});
        if (createdRecordId) {
            await adminAgent
                .post('/api/position/records/delete')
                .send({ id: createdRecordId })
                .catch(() => {});
        }
    });

    // ── GET /api/position/index-pool ──────────────────────────
    describe('GET /api/position/index-pool', () => {
        it('返回指数池列表', async () => {
            const res = await createAgent().get('/api/position/index-pool');
            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);
            expect(Array.isArray(res.body.data.pool)).toBe(true);
        });
    });

    // ── GET /api/position/benchmarks ──────────────────────────
    describe('GET /api/position/benchmarks', () => {
        it('无需登录可获取加仓基准', async () => {
            const res = await createAgent().get('/api/position/benchmarks');
            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);
            expect(Array.isArray(res.body.data.benchmarks)).toBe(true);
        });
    });

    // ── POST /api/position/benchmarks ─────────────────────────
    describe('POST /api/position/benchmarks', () => {
        it('未登录时返回 401', async () => {
            const res = await createAgent().post('/api/position/benchmarks').send(testBenchmark);
            expect(res.status).toBe(401);
        });

        it('管理员成功创建加仓基准', async () => {
            const res = await adminAgent.post('/api/position/benchmarks').send(testBenchmark);
            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);
            const b = res.body.data.benchmarks.find(b => b.indexCode === testBenchmark.indexCode);
            expect(b).toBeTruthy();
        });

        it('相同 indexCode 执行 upsert', async () => {
            const updated = { ...testBenchmark, baseValue: 5000 };
            const res = await adminAgent.post('/api/position/benchmarks').send(updated);
            expect(res.body.success).toBe(true);
            const b = res.body.data.benchmarks.find(b => b.indexCode === testBenchmark.indexCode);
            expect(b.baseValue).toBe(5000);
        });
    });

    // ── POST /api/position/benchmarks/delete ──────────────────
    describe('POST /api/position/benchmarks/delete', () => {
        it('成功删除加仓基准', async () => {
            const res = await adminAgent
                .post('/api/position/benchmarks/delete')
                .send({ indexCode: testBenchmark.indexCode });
            expect(res.body.success).toBe(true);
        });

        it('删除不存在的基准时返回错误', async () => {
            const res = await adminAgent
                .post('/api/position/benchmarks/delete')
                .send({ indexCode: 'NONEXISTENT' });
            expect(res.body.success).toBe(false);
        });
    });

    // ── GET /api/position/records ─────────────────────────────
    describe('GET /api/position/records', () => {
        it('无需登录可获取加仓记录', async () => {
            const res = await createAgent().get('/api/position/records');
            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);
            expect(Array.isArray(res.body.data.records)).toBe(true);
        });
    });

    // ── POST /api/position/records ────────────────────────────
    describe('POST /api/position/records', () => {
        it('未登录时返回 401', async () => {
            const res = await createAgent().post('/api/position/records').send({
                indexCode: '000300',
                indexName: '沪深300',
                time: '2024-01-01',
                value: 3500,
            });
            expect(res.status).toBe(401);
        });

        it('管理员成功添加加仓记录', async () => {
            const res = await adminAgent.post('/api/position/records').send({
                indexCode: 'TEST_RECORD',
                indexName: '测试记录指数',
                time: '2024-01-01',
                value: 3500,
                pe: 12.5,
                note: '测试记录',
            });
            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);
            expect(res.body.data.record).toHaveProperty('id');
            createdRecordId = res.body.data.record.id;
        });

        it('缺少必填字段时返回错误', async () => {
            const res = await adminAgent.post('/api/position/records').send({ indexCode: 'X' });
            expect(res.body.success).toBe(false);
        });
    });

    // ── POST /api/position/records/delete ─────────────────────
    describe('POST /api/position/records/delete', () => {
        it('未登录时返回 401', async () => {
            const res = await createAgent().post('/api/position/records/delete').send({ id: 'test' });
            expect(res.status).toBe(401);
        });

        it('成功删除加仓记录', async () => {
            if (!createdRecordId) return;
            const res = await adminAgent
                .post('/api/position/records/delete')
                .send({ id: createdRecordId });
            expect(res.body.success).toBe(true);
            createdRecordId = null;
        });

        it('删除不存在的记录时返回错误', async () => {
            const res = await adminAgent
                .post('/api/position/records/delete')
                .send({ id: 'nonexistent_id_xyz' });
            expect(res.body.success).toBe(false);
        });
    });
});
