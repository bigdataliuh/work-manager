module.exports = {
  apps: [
    {
      name: "work-manager-api",
      script: "./server/index.js",
      cwd: "/var/www/work-manager/current",
      instances: 1,
      exec_mode: "fork",
      autorestart: true,
      watch: false,
      max_memory_restart: "300M",
      env: {
        NODE_ENV: "production",
        PORT: 8787
      }
    }
  ]
};
