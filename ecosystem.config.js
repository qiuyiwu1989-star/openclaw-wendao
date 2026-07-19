// PM2 常驻配置 —— 部署在 122.51.221.171，与 shennao 同机
// 用法：pm2 start ecosystem.config.js && pm2 save
module.exports = {
  apps: [
    {
      name: "wendao",
      script: "npm",
      args: "run start",
      cwd: __dirname,
      env: {
        NODE_ENV: "production",
        PORT: "3200",
      },
      // 密钥来自同目录 .env.local（Next 自动加载），不写在这里
      max_restarts: 10,
      restart_delay: 3000,
      out_file: "./.pm2/out.log",
      error_file: "./.pm2/err.log",
    },
  ],
};
