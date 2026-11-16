/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    // 游戏静态资源（/g/<slug>/...）与 API 转发给 Node 服务。
    // /api 需 ws:true:联机中转 WS(/api/relay)的 upgrade 也要转发,否则握手永久挂起。
    proxy: {
      '/api': { target: 'http://localhost:8787', ws: true },
      '/g': 'http://localhost:8787',
    },
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/tests/setup.ts'],
    include: ['src/**/*.test.{ts,tsx}', 'server/**/*.test.mjs'],
  },
});
