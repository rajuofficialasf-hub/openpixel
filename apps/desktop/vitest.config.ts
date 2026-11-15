import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    // Settings tests touch localStorage, so the desktop suite runs
    // in jsdom (unlike the web app's node-only helper tests).
    environment: 'jsdom',
    include: ['src/**/*.test.ts'],
  },
})
