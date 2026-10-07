import { fileURLToPath, URL } from 'node:url';
import vue from '@vitejs/plugin-vue';
import vuetify from 'vite-plugin-vuetify';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [vue(), vuetify({ autoImport: true })],
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  server: {
    port: Number(process.env.WEB_PORT ?? 5173),
    strictPort: true,
    proxy: {
      '/api': process.env.API_PROXY_TARGET ?? 'http://localhost:3000',
      '/health': process.env.API_PROXY_TARGET ?? 'http://localhost:3000',
    },
  },
  test: {
    environment: 'happy-dom',
    server: { deps: { inline: ['vuetify'] } },
  },
});
