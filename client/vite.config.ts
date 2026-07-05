import { defineConfig } from 'vite';

export default defineConfig({
  build: { target: 'es2022' },
  server: {
    proxy: {
      '/api': 'http://localhost:8787',
      '/ws': { target: 'ws://localhost:8787', ws: true },
    },
    fs: { allow: ['..'] },
  },
});
