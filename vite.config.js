import { defineConfig } from 'vite';
import { resolve } from 'path';

export default defineConfig({
  root: 'public',
  build: {
    outDir: '../dist',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'public/index.html'),
        app: resolve(__dirname, 'public/app.html'),
        guide: resolve(__dirname, 'public/guide.html'),
        guideInput: resolve(__dirname, 'public/guide-input.html'),
        visitor: resolve(__dirname, 'public/visitor.html')
      }
    }
  },
  publicDir: false,  // Don't use a separate public dir since root is already public
  server: {
    port: 5173,
    hmr: false,  // Disable HMR to avoid WebSocket errors
    proxy: {
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true,
        secure: false
      }
    }
  }
});
