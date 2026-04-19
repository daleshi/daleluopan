'use strict';

const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const http = require('http');

const PID_FILE = '/tmp/dale-test-server.pid';
const TEST_PORT = 3201;
const HEALTH_URL = `http://localhost:${TEST_PORT}/api/health`;
const SERVER_ROOT = path.resolve(__dirname, '../..');

function pollHealth(retries = 60, interval = 500) {
    return new Promise((resolve, reject) => {
        let attempts = 0;
        const check = () => {
            http.get(HEALTH_URL, (res) => {
                if (res.statusCode === 200) {
                    resolve();
                } else if (++attempts < retries) {
                    setTimeout(check, interval);
                } else {
                    reject(new Error(`Server did not become healthy after ${retries} attempts`));
                }
            }).on('error', () => {
                if (++attempts < retries) {
                    setTimeout(check, interval);
                } else {
                    reject(new Error(`Server not reachable after ${retries} attempts`));
                }
            });
        };
        setTimeout(check, interval);
    });
}

module.exports = async function globalSetup() {
    const child = spawn('node', ['server.js'], {
        cwd: SERVER_ROOT,
        env: { ...process.env, PORT: String(TEST_PORT), NODE_ENV: 'test' },
        detached: true,
        stdio: 'ignore',
    });

    child.unref();
    fs.writeFileSync(PID_FILE, String(child.pid));

    console.log(`\n[test] 启动测试服务器 PID=${child.pid} PORT=${TEST_PORT}`);
    await pollHealth();
    console.log('[test] 服务器就绪\n');
};
