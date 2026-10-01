/// <reference types="vitest/config" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { fileURLToPath, URL } from 'node:url'

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
  ],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      '@shared': fileURLToPath(new URL('./shared', import.meta.url)),
    },
  },
  test: {
    globals: true,
    environment: 'node',
    exclude:
      process.env.SMOKE_TEST === '1' || process.env.npm_lifecycle_event === 'test:smoke'
        ? ['**/node_modules/**', '**/dist/**']
        : [
            '**/node_modules/**',
            '**/dist/**',
            '**/tests/guards/db-smoke.guard.test.ts',
          ],
  },
})
