// Configuration PM2 : lance l'app et la relance automatiquement.
module.exports = {
  apps: [
    {
      name: 'salawat',
      script: 'server.js',
      instances: 1,
      autorestart: true,
      env: {
        NODE_ENV: 'production',
        PORT: 3001,
        TZ: 'Europe/Paris',
      },
    },
  ],
};
