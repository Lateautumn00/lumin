import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    projects: [
      'packages/shared',
      'packages/plugin-api',
      'packages/node-kit',
      'packages/ui',
      'packages/tools/*',
      'apps/*'
    ],
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
        'packages/node-kit/src/**/*.ts': {
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
        'packages/tools/unit-converter/src/manifest.ts': {
          lines: 80,
          functions: 80,
          statements: 80,
          branches: 80
        },
        'packages/tools/unit-converter/src/units/*.ts': {
          lines: 80,
          functions: 80,
          statements: 80,
          branches: 80
        },
        'packages/tools/docx2pdf/src/**/*.ts': {
          lines: 80,
          functions: 80,
          statements: 80,
          branches: 80
        },
        'packages/ocr-kit/src/**/*.ts': {
          lines: 80,
          functions: 80,
          statements: 80,
          branches: 80
        },
        'packages/tools/exam-split/src/**/*.ts': {
          lines: 80,
          functions: 80,
          statements: 80,
          branches: 80
        },
        'packages/tools/video-download/src/**/*.ts': {
          lines: 80,
          functions: 80,
          statements: 80,
          branches: 80
        },
        'packages/tools/image-toolbox/src/**/*.ts': {
          lines: 80,
          functions: 80,
          statements: 80,
          branches: 80
        },
        'packages/tools/image-crop/src/**/*.ts': {
          lines: 80,
          functions: 80,
          statements: 80,
          branches: 80
        },
        'packages/tools/image-rotate/src/**/*.ts': {
          lines: 80,
          functions: 80,
          statements: 80,
          branches: 80
        },
        'packages/tools/file-renamer/src/**/*.ts': {
          lines: 80,
          functions: 80,
          statements: 80,
          branches: 80
        },
        'packages/tools/text-toolbox/src/**/*.ts': {
          lines: 80,
          functions: 80,
          statements: 80,
          branches: 80
        },
        'packages/tools/file-hasher/src/**/*.ts': {
          lines: 80,
          functions: 80,
          statements: 80,
          branches: 80
        },
        'packages/tools/duplicate-finder/src/**/*.ts': {
          lines: 80,
          functions: 80,
          statements: 80,
          branches: 80
        },
        'packages/tools/disk-analyzer/src/**/*.ts': {
          lines: 80,
          functions: 80,
          statements: 80,
          branches: 80
        },
        'packages/tools/folder-compare/src/**/*.ts': {
          lines: 80,
          functions: 80,
          statements: 80,
          branches: 80
        },
        'packages/tools/fs-cleaner/src/**/*.ts': {
          lines: 80,
          functions: 80,
          statements: 80,
          branches: 80
        },
        'packages/tools/zip-tool/src/**/*.ts': {
          lines: 80,
          functions: 80,
          statements: 80,
          branches: 80
        },
        'packages/tools/media-convert/src/**/*.ts': {
          lines: 80,
          functions: 80,
          statements: 80,
          branches: 80
        },
        'packages/tools/pdf-toolkit/src/**/*.ts': {
          lines: 80,
          functions: 80,
          statements: 80,
          branches: 80
        },
        'packages/tools/qr-code/src/**/*.ts': {
          lines: 80,
          functions: 80,
          statements: 80,
          branches: 80
        },
        'packages/tools/ocr-text/src/**/*.ts': {
          lines: 80,
          functions: 80,
          statements: 80,
          branches: 80
        },
        'packages/tools/batch-ocr/src/**/*.ts': {
          lines: 80,
          functions: 80,
          statements: 80,
          branches: 80
        },
        'packages/tools/color-toolbox/src/**/*.ts': {
          lines: 80,
          functions: 80,
          statements: 80,
          branches: 80
        },
        'packages/tools/time-toolbox/src/**/*.ts': {
          lines: 80,
          functions: 80,
          statements: 80,
          branches: 80
        },
        'packages/tools/password-generator/src/**/*.ts': {
          lines: 80,
          functions: 80,
          statements: 80,
          branches: 80
        },
        'packages/tools/text-diff/src/**/*.ts': {
          lines: 80,
          functions: 80,
          statements: 80,
          branches: 80
        },
        'packages/tools/image-watermark/src/**/*.ts': {
          lines: 80,
          functions: 80,
          statements: 80,
          branches: 80
        },
        'packages/tools/image-stitch/src/**/*.ts': {
          lines: 80,
          functions: 80,
          statements: 80,
          branches: 80
        },
        'packages/tools/life-calculator/src/**/*.ts': {
          lines: 80,
          functions: 80,
          statements: 80,
          branches: 80
        },
        'packages/tools/markdown-tool/src/**/*.ts': {
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
