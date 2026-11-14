import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import vue from '@vitejs/plugin-vue'
import tailwindcss from '@tailwindcss/vite'
import { PROD_CSP } from './src/main/csp'

const r = (p: string): string => resolve(fileURLToPath(new URL(p, import.meta.url)))

const workspaceAlias = [
  { find: /^@lumin\/shared$/, replacement: r('../../packages/shared/src/index.ts') },
  { find: /^@lumin\/plugin-api$/, replacement: r('../../packages/plugin-api/src/index.ts') },
  { find: /^@lumin\/node-kit$/, replacement: r('../../packages/node-kit/src/index.ts') },
  { find: /^@lumin\/ui\/(.+)$/, replacement: r('../../packages/ui/src/$1') },
  {
    find: /^@lumin\/tool-docx2pdf\/manifest$/,
    replacement: r('../../packages/tools/docx2pdf/src/manifest.ts')
  },
  {
    find: /^@lumin\/tool-docx2pdf\/node$/,
    replacement: r('../../packages/tools/docx2pdf/src/node.ts')
  },
  {
    find: /^@lumin\/tool-docx2pdf\/renderer\/(.+)$/,
    replacement: r('../../packages/tools/docx2pdf/src/renderer/$1')
  },
  {
    find: /^@lumin\/tool-example\/manifest$/,
    replacement: r('../../packages/tools/example/src/manifest.ts')
  },
  {
    find: /^@lumin\/tool-example\/node$/,
    replacement: r('../../packages/tools/example/src/node.ts')
  },
  {
    find: /^@lumin\/tool-example\/renderer\/(.+)$/,
    replacement: r('../../packages/tools/example/src/renderer/$1')
  },
  {
    find: /^@lumin\/tool-calculator\/manifest$/,
    replacement: r('../../packages/tools/calculator/src/manifest.ts')
  },
  {
    find: /^@lumin\/tool-calculator\/renderer\/(.+)$/,
    replacement: r('../../packages/tools/calculator/src/renderer/$1')
  },
  {
    find: /^@lumin\/tool-unit-converter\/manifest$/,
    replacement: r('../../packages/tools/unit-converter/src/manifest.ts')
  },
  {
    find: /^@lumin\/tool-unit-converter\/renderer\/(.+)$/,
    replacement: r('../../packages/tools/unit-converter/src/renderer/$1')
  }
]

const prodCspMeta = {
  name: 'lumin-prod-csp-meta',
  transformIndexHtml(html: string, ctx: { server?: unknown }): string {
    if (ctx.server !== undefined) return html
    return html.replace(
      '<head>',
      `<head><meta http-equiv="Content-Security-Policy" content="${PROD_CSP}">`
    )
  }
}

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    resolve: { alias: workspaceAlias }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    resolve: { alias: workspaceAlias }
  },
  renderer: {
    resolve: { alias: workspaceAlias },
    plugins: [vue(), tailwindcss(), prodCspMeta]
  }
})
