import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    projects: ['packages/*', 'packages/tools/*', 'apps/*'],
    coverage: {
      provider: 'v8',
      reporter: ['text-summary', 'lcov', 'html'],
      reportsDirectory: 'coverage',
      include: ['packages/*/src/**', 'packages/tools/*/src/**', 'apps/*/src/**'],
      exclude: ['**/*.test.ts', '**/*.spec.ts', '**/index.ts'],
      thresholds: {
        lines: 60,
        functions: 60,
        statements: 60,
        branches: 60
      }
    }
  }
})
