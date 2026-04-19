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
    ],
};
