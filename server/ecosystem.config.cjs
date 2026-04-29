module.exports = {
  apps: [
    {
      name: 'cleo-broadcast',
      script: 'dist/index.js',
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '512M',
      env: {
        NODE_ENV: 'production',
        PORT: '3102',
      },
      error_file: 'logs/error.log',
      out_file: 'logs/out.log',
      merge_logs: true,
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      kill_timeout: 15000,
    },
    {
      name: 'cleo-discord-bot',
      script: 'dist/discord-bot/start-bot.js',
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '256M',
      max_restarts: 10,
      env: {
        NODE_ENV: 'production',
      },
      error_file: 'logs/discord-bot-error.log',
      out_file: 'logs/discord-bot-out.log',
      merge_logs: true,
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      kill_timeout: 10000,
    },
  ],
};
