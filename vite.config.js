import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import path from 'path'

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  build: {
    rollupOptions: {
      input: {
        main:      path.resolve(__dirname, 'index.html'),
        admin:     path.resolve(__dirname, 'admin.html'),
        // Lean bundle for the prerendered marketing pages (scripts/prerender.mjs)
        marketing: path.resolve(__dirname, 'marketing.html'),
      },
    },
  },
  server: {
    allowedHosts: true,
    proxy: {
      '/api': {
        target: 'http://localhost:3007',
        changeOrigin: true,
      },
    },
  },
})