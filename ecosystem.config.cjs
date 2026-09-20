module.exports = {
  apps: [{
    name: 'mongo-backup',
    script: './dist/main.js',        // ← مخرجات tsup
    cwd: __dirname,
    interpreter: 'node',
    autorestart: false,              // ← إلزامي
    cron_restart: '0 2,14 * * *',
    time: true,
    instances: 1,
    exec_mode: 'fork',
    max_memory_restart: '300M',
    error_file: './logs/error.log',
    out_file: './logs/out.log',
    merge_logs: true,
    env: {
      NODE_ENV: 'production',
      NODE_OPTIONS: '--enable-source-maps'
    }
  }]
};
