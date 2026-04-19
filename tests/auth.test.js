'use strict';

const { createAgent, loginAs, loginAsAdmin, deleteUser } = require('./setup/helpers');
const { testUser } = require('./fixtures/testData');

describe('Auth — /api/auth/*', () => {
    let adminAgent;

    beforeAll(async () => {
        adminAgent = await loginAsAdmin();
        // 清理上次测试可能遗留的用户（保证幂等）
        await deleteUser(adminAgent, testUser.username);
    });

    afterAll(async () => {
        await deleteUser(adminAgent, testUser.username);
    });

    // ── /api/auth/me ──────────────────────────────────────────
    describe('GET /api/auth/me', () => {
        it('未登录时返回 null', async () => {
            const agent = createAgent();
            const res = await agent.get('/api/auth/me');
            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);
            expect(res.body.data).toBeNull();
        });

        it('登录后返回用户信息', async () => {
            const res = await adminAgent.get('/api/auth/me');
            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);
            expect(res.body.data.username).toBe('admin');
            expect(res.body.data.role).toBe('admin');
            expect(res.body.data).not.toHaveProperty('passwordHash');
            expect(res.body.data).not.toHaveProperty('salt');
        });
    });

    // ── /api/auth/register ────────────────────────────────────
    describe('POST /api/auth/register', () => {
        it('成功注册新用户并自动登录', async () => {
            const agent = createAgent();
            const res = await agent.post('/api/auth/register').send(testUser);
            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);
            expect(res.body.data.username).toBe(testUser.username);
            // 注册后 me 接口应返回该用户
            const me = await agent.get('/api/auth/me');
            expect(me.body.data.username).toBe(testUser.username);
        });

        it('用户名重复时返回错误', async () => {
            const res = await createAgent().post('/api/auth/register').send(testUser);
            expect(res.body.success).toBe(false);
            expect(res.body.error).toBeTruthy();
        });

        it('用户名过短（< 2 字符）时返回错误', async () => {
            const res = await createAgent().post('/api/auth/register').send({
                username: 'a',
                password: 'Test@12345',
            });
            expect(res.body.success).toBe(false);
        });

        it('密码过短（< 6 字符）时返回错误', async () => {
            const res = await createAgent().post('/api/auth/register').send({
                username: 'validname',
                password: '123',
            });
            expect(res.body.success).toBe(false);
        });

        it('缺少必填字段时返回错误', async () => {
            const res = await createAgent().post('/api/auth/register').send({ username: 'onlyname' });
            expect(res.body.success).toBe(false);
        });
    });

    // ── /api/auth/login ───────────────────────────────────────
    describe('POST /api/auth/login', () => {
        it('正确凭证登录成功', async () => {
            const res = await createAgent().post('/api/auth/login').send({
                username: testUser.username,
                password: testUser.password,
            });
            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);
            expect(res.body.data.username).toBe(testUser.username);
        });

        it('密码错误时登录失败', async () => {
            const res = await createAgent().post('/api/auth/login').send({
                username: testUser.username,
                password: 'wrongpassword',
            });
            expect(res.body.success).toBe(false);
        });

        it('用户不存在时登录失败', async () => {
            const res = await createAgent().post('/api/auth/login').send({
                username: 'nonexistent_user_xyz',
                password: 'Test@12345',
            });
            expect(res.body.success).toBe(false);
        });

        it('缺少用户名时返回错误', async () => {
            const res = await createAgent().post('/api/auth/login').send({ password: 'Test@12345' });
            expect(res.body.success).toBe(false);
        });
    });

    // ── /api/auth/logout ──────────────────────────────────────
    describe('POST /api/auth/logout', () => {
        it('登出后 session 失效', async () => {
            const agent = await loginAs(testUser.username, testUser.password);

            const logout = await agent.post('/api/auth/logout');
            expect(logout.body.success).toBe(true);

            // 登出后 me 应返回 null
            const me = await agent.get('/api/auth/me');
            expect(me.body.data).toBeNull();
        });
    });
});
