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
    // db-smoke test requires a live Supabase instance.
    // Run it separately via `npm run test:smoke` (CI: db-smoke job).
    exclude: [
      '**/node_modules/**',
      '**/dist/**',
      '**/tests/guards/db-smoke.guard.test.ts',
    ],
  },
})
