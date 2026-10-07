import { fileURLToPath, URL } from 'node:url';
import basicSsl from '@vitejs/plugin-basic-ssl';
import vue from '@vitejs/plugin-vue';
import vuetify from 'vite-plugin-vuetify';
import { defineConfig } from 'vitest/config';

// DEV_HTTPS=1 serves the dev server over self-signed HTTPS on the LAN, so phones can use the
// camera for selfie punches (browsers only expose getUserMedia on HTTPS or localhost).
const devHttps = process.env.DEV_HTTPS === '1';

export default defineConfig({
  plugins: [vue(), vuetify({ autoImport: true }), ...(devHttps ? [basicSsl()] : [])],
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  server: {
    port: Number(process.env.WEB_PORT ?? 5173),
    strictPort: true,
    host: devHttps ? true : undefined,
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
