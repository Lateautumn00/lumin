import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    projects: ['packages/*', 'packages/tools/*', 'apps/*'],
    coverage: {
      provider: 'v8',
      reporter: ['text-summary', 'lcov', 'html'],
      reportsDirectory: 'coverage',
      include: ['packages/*/src/**', 'packages/tools/*/src/**', 'apps/*/src/**'],
      exclude: ['**/*.test.ts', '**/*.spec.ts', '**/index.ts', '**/*.vue', '**/*.html'],
      thresholds: {
        lines: 60,
        functions: 60,
        statements: 60,
        branches: 60,
        'packages/shared/src/**/*.ts': { lines: 80, functions: 80, statements: 80, branches: 80 },
        'packages/plugin-api/src/**/*.ts': {
          lines: 80,
          functions: 80,
          statements: 80,
          branches: 80
        },
        'packages/tools/example/src/manifest.ts': {
          lines: 80,
          functions: 80,
          statements: 80,
          branches: 80
        },
        'packages/tools/example/src/schema.ts': {
          lines: 80,
          functions: 80,
          statements: 80,
          branches: 80
        },
        'packages/tools/example/src/node.ts': {
          lines: 80,
          functions: 80,
          statements: 80,
          branches: 80
        },
        'packages/tools/calculator/src/manifest.ts': {
          lines: 80,
          functions: 80,
          statements: 80,
          branches: 80
        },
        'packages/tools/calculator/src/calc/evaluate.ts': {
          lines: 80,
          functions: 80,
          statements: 80,
          branches: 80
        },
        'packages/tools/calculator/src/calc/history.ts': {
          lines: 80,
          functions: 80,
          statements: 80,
          branches: 80
        },
        'apps/desktop/src/main/task-queue.ts': {
          lines: 80,
          functions: 80,
          statements: 80,
          branches: 80
        },
        'apps/desktop/src/main/ipc-bus.ts': {
          lines: 80,
          functions: 80,
          statements: 80,
          branches: 80
        },
        'apps/desktop/src/main/plugin-host.ts': {
          lines: 80,
          functions: 80,
          statements: 80,
          branches: 80
        },
        'apps/desktop/src/main/services/settings.ts': {
          lines: 80,
          functions: 80,
          statements: 80,
          branches: 80
        },
        'apps/desktop/src/main/shell-channels.ts': {
          lines: 80,
          functions: 80,
          statements: 80,
          branches: 80
        },
        'apps/desktop/src/main/services/updater.ts': {
          lines: 80,
          functions: 80,
          statements: 80,
          branches: 80
        }
      }
    }
  }
})
