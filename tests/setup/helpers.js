'use strict';

const supertest = require('supertest');

const BASE_URL = `http://localhost:${process.env.TEST_PORT || 3201}`;

/**
 * 创建一个自动持久化 cookie 的 supertest agent
 */
function createAgent() {
    return supertest.agent(BASE_URL);
}

/**
 * 以指定用户登录，返回已登录的 agent
 */
async function loginAs(username, password) {
    const agent = createAgent();
    const res = await agent
        .post('/api/auth/login')
        .send({ username, password });

    if (!res.body.success) {
        throw new Error(`登录失败: ${username} — ${res.body.error}`);
    }
    return agent;
}

/**
 * 以默认管理员登录
 */
async function loginAsAdmin() {
    return loginAs('admin', 'admin123');
}

/**
 * 删除指定用户（用于测试清理）
 */
async function deleteUser(adminAgent, username) {
    await adminAgent
        .post('/api/admin/users/delete')
        .send({ username })
        .catch(() => {});
}

module.exports = { createAgent, loginAs, loginAsAdmin, deleteUser };
