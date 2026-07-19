import { defineConfig } from 'vite';
import { version } from './package.json';

export default defineConfig({
  define: {
    __BUILD_TIME__: JSON.stringify(new Date().toISOString().slice(0, 16).replace('T', ' ') + 'Z'),
    __APP_VERSION__: JSON.stringify(version),
  },
  build: { target: 'es2022' },
  server: {
    proxy: {
      '/api': 'http://localhost:8787',
      '/ws': { target: 'ws://localhost:8787', ws: true },
    },
    fs: { allow: ['..'] },
  },
});
