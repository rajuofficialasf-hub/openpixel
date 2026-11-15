import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    // Pure-helper tests run in node; no DOM needed.
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
})
