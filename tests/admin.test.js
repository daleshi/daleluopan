'use strict';

const { createAgent, loginAs, loginAsAdmin, deleteUser } = require('./setup/helpers');
const { testUser2 } = require('./fixtures/testData');

describe('Admin Users — /api/admin/users/*', () => {
    let adminAgent;

    beforeAll(async () => {
        adminAgent = await loginAsAdmin();
    });

    afterAll(async () => {
        await deleteUser(adminAgent, testUser2.username);
    });

    // ── requireAdmin 守卫 ──────────────────────────────────────
    describe('权限守卫', () => {
        it('未登录时返回 401', async () => {
            const res = await createAgent().get('/api/admin/users');
            expect(res.status).toBe(401);
        });

        it('普通用户无权访问管理接口', async () => {
            // 由管理员创建普通用户，确保注册成功
            const uname = `nu_${String(Date.now()).slice(-6)}`;
            await adminAgent.post('/api/admin/users').send({
                username: uname,
                password: 'Test12345',
                role: 'user',
            });
            const agent = await loginAs(uname, 'Test12345');
            const res = await agent.get('/api/admin/users');
            expect(res.status).toBe(403);
            await deleteUser(adminAgent, uname);
        });
    });

    // ── GET /api/admin/users ───────────────────────────────────
    describe('GET /api/admin/users', () => {
        it('管理员可获取用户列表', async () => {
            const res = await adminAgent.get('/api/admin/users');
            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);
            expect(Array.isArray(res.body.data.users)).toBe(true);
            // 不返回密码字段
            res.body.data.users.forEach(u => {
                expect(u).not.toHaveProperty('passwordHash');
                expect(u).not.toHaveProperty('salt');
            });
        });
    });

    // ── POST /api/admin/users（新增）─────────────────────────────
    describe('POST /api/admin/users', () => {
        it('成功添加新用户', async () => {
            const res = await adminAgent.post('/api/admin/users').send({
                username: testUser2.username,
                password: testUser2.password,
                role: 'user',
            });
            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);
            const users = res.body.data.users;
            expect(users.find(u => u.username === testUser2.username)).toBeTruthy();
        });

        it('用户名重复时返回错误', async () => {
            const res = await adminAgent.post('/api/admin/users').send({
                username: testUser2.username,
                password: 'Test@12345',
                role: 'user',
            });
            expect(res.body.success).toBe(false);
        });

        it('缺少必填字段时返回错误', async () => {
            const res = await adminAgent.post('/api/admin/users').send({ username: 'incomplete' });
            expect(res.body.success).toBe(false);
        });
    });

    // ── POST /api/admin/users/update ───────────────────────────
    describe('POST /api/admin/users/update', () => {
        it('成功更新用户昵称', async () => {
            const res = await adminAgent.post('/api/admin/users/update').send({
                username: testUser2.username,
                nickname: '新昵称',
            });
            expect(res.body.success).toBe(true);
            const updated = res.body.data.users.find(u => u.username === testUser2.username);
            expect(updated.nickname).toBe('新昵称');
        });

        it('不存在的用户更新时返回错误', async () => {
            const res = await adminAgent.post('/api/admin/users/update').send({
                username: 'nobody_xyz',
                nickname: 'test',
            });
            expect(res.body.success).toBe(false);
        });
    });

    // ── POST /api/admin/users/delete ───────────────────────────
    describe('POST /api/admin/users/delete', () => {
        it('不能删除自身', async () => {
            const res = await adminAgent.post('/api/admin/users/delete').send({ username: 'admin' });
            expect(res.body.success).toBe(false);
        });

        it('成功删除普通用户', async () => {
            const res = await adminAgent.post('/api/admin/users/delete').send({
                username: testUser2.username,
            });
            expect(res.body.success).toBe(true);
            const users = res.body.data.users;
            expect(users.find(u => u.username === testUser2.username)).toBeFalsy();
        });

        it('不存在的用户删除时返回错误', async () => {
            const res = await adminAgent.post('/api/admin/users/delete').send({
                username: 'nobody_xyz',
            });
            expect(res.body.success).toBe(false);
        });
    });
});
