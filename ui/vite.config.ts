import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'path'

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: false,
  },
  resolve: {
    alias: {
      '@bosch-sdlc/protocol': resolve(__dirname, '../protocol/src/index.ts'),
    },
  },
  server: {
    proxy: {
      '/api': {
        target: 'http://localhost:3742',
        ws: true,
      },
    },
  },
  build: {
    outDir: '../server/dist/public',
    emptyOutDir: true,
  },
})
