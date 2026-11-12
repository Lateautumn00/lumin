import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    coverage: {
      provider: 'v8',
      reporter: ['text-summary', 'lcov', 'html'],
      reportsDirectory: 'coverage',
      thresholds: {
        lines: 60,
        functions: 60,
        statements: 60,
        branches: 60
      }
    }
  }
})
