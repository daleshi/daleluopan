module.exports = {
    apps: [
        {
            name: 'dale-compass',
            script: './server.js',
            cwd: __dirname,
            instances: 1,
            exec_mode: 'fork',
            autorestart: true,
            watch: false,
            max_memory_restart: '512M',
            env: {
                NODE_ENV: 'production',
                PORT: 3200,
            },
            error_file: './logs/error.log',
            out_file: './logs/out.log',
            merge_logs: true,
            time: true,
        },
        {
            // 后台采集进程：行情数据的唯一写入者（data/db/），与网站进程互相隔离
            name: 'dale-collector',
            script: './collector.js',
            cwd: __dirname,
            instances: 1, // 必须单实例（进程内另有锁文件保护）
            exec_mode: 'fork',
            autorestart: true,
            restart_delay: 5000,
            watch: false,
            max_memory_restart: '600M',
            kill_timeout: 10000, // 给退出前的 market.db 落盘留时间
            env: {
                NODE_ENV: 'production',
            },
            error_file: './logs/collector-error.log',
            out_file: './logs/collector-out.log',
            merge_logs: true,
            time: true,
        },
    ],
};
