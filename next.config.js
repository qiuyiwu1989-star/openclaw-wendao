/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // 问道以子路径 /wendao 部署在深脑域名下时，设置 BASE_PATH=/wendao
  basePath: process.env.BASE_PATH || undefined,
  // 暴露给前端，用于拼出 basePath 感知的 API 路径（避免相对路径在子路径下解析错误）
  env: {
    NEXT_PUBLIC_BASE_PATH: process.env.BASE_PATH || "",
  },
};

module.exports = nextConfig;
