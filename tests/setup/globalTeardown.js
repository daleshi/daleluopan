'use strict';

const fs = require('fs');

const PID_FILE = '/tmp/dale-test-server.pid';

module.exports = async function globalTeardown() {
    if (!fs.existsSync(PID_FILE)) return;

    const pid = parseInt(fs.readFileSync(PID_FILE, 'utf8').trim(), 10);
    fs.unlinkSync(PID_FILE);

    if (!pid || isNaN(pid)) return;

    try {
        process.kill(pid, 'SIGTERM');
        console.log(`\n[test] 关闭测试服务器 PID=${pid}`);
    } catch (_) {
        // 进程可能已退出
    }
};
