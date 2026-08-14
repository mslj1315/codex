import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const apiTarget = process.env.OPERATOR_API_PROXY_TARGET ?? 'http://127.0.0.1:3000';
const apiOrigin = new URL(apiTarget).origin;
export const operatorApiProxy = {
  target: apiTarget,
  changeOrigin: true,
  configure(proxy: { on(event: 'proxyReq', listener: (request: { setHeader(name: string, value: string): void }) => void): void }) {
    proxy.on('proxyReq', (request) => request.setHeader('origin', apiOrigin));
  }
};

export default defineConfig({
  base: '/operator/',
  plugins: [react()],
  server: {
    proxy: {
      '/v1': operatorApiProxy
    }
  },
  test: {
    environment: 'jsdom',
    setupFiles: './src/test-setup.ts'
  }
});
