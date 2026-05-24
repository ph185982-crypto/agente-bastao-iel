module.exports = {
  apps: [{
    name: 'nexos-paginas',
    script: 'server.js',
    cwd: '/opt/nexos-paginas/backend',
    instances: 1,
    autorestart: true,
    watch: false,
    max_memory_restart: '2G',
    env: {
      NODE_ENV: 'production',
      PORT: 3001,
    },
  }],
};
