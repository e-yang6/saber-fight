import { defineConfig } from 'vite';
import { resolve } from 'path';

export default defineConfig({
  root: 'src/client',
  resolve: {
    alias: {
      '@shared': resolve(__dirname, 'src/shared'),
    },
  },
  build: {
    outDir: resolve(__dirname, 'dist/client'),
    emptyOutDir: true,
    rollupOptions: {
      input: {
        player: resolve(__dirname, 'src/client/player/index.html'),
        controller: resolve(__dirname, 'src/client/controller/index.html'),
      },
    },
  },
  server: {
    allowedHosts: true,
  },
});
