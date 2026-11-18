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
    find: /^@lumin\/tool-exam-split\/manifest$/,
    replacement: r('../../packages/tools/exam-split/src/manifest.ts')
  },
  {
    find: /^@lumin\/tool-exam-split\/node$/,
    replacement: r('../../packages/tools/exam-split/src/node.ts')
  },
  {
    find: /^@lumin\/tool-exam-split\/renderer\/(.+)$/,
    replacement: r('../../packages/tools/exam-split/src/renderer/$1')
  },
  {
    find: /^@lumin\/tool-image-toolbox\/manifest$/,
    replacement: r('../../packages/tools/image-toolbox/src/manifest.ts')
  },
  {
    find: /^@lumin\/tool-image-toolbox\/node$/,
    replacement: r('../../packages/tools/image-toolbox/src/node.ts')
  },
  {
    find: /^@lumin\/tool-image-toolbox\/renderer\/(.+)$/,
    replacement: r('../../packages/tools/image-toolbox/src/renderer/$1')
  },
  {
    find: /^@lumin\/tool-file-renamer\/manifest$/,
    replacement: r('../../packages/tools/file-renamer/src/manifest.ts')
  },
  {
    find: /^@lumin\/tool-file-renamer\/node$/,
    replacement: r('../../packages/tools/file-renamer/src/node.ts')
  },
  {
    find: /^@lumin\/tool-file-renamer\/renderer\/(.+)$/,
    replacement: r('../../packages/tools/file-renamer/src/renderer/$1')
  },
  {
    find: /^@lumin\/tool-text-toolbox\/manifest$/,
    replacement: r('../../packages/tools/text-toolbox/src/manifest.ts')
  },
  {
    find: /^@lumin\/tool-text-toolbox\/renderer\/(.+)$/,
    replacement: r('../../packages/tools/text-toolbox/src/renderer/$1')
  },
  {
    find: /^@lumin\/tool-video-download\/manifest$/,
    replacement: r('../../packages/tools/video-download/src/manifest.ts')
  },
  {
    find: /^@lumin\/tool-video-download\/node$/,
    replacement: r('../../packages/tools/video-download/src/node.ts')
  },
  {
    find: /^@lumin\/tool-video-download\/renderer\/(.+)$/,
    replacement: r('../../packages/tools/video-download/src/renderer/$1')
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
    resolve: {
      alias: [
        ...workspaceAlias,
        // pdfjs 根入口是未压缩构建（electron-vite 默认 minify=false）；renderer 只消费
        // 浏览器 API，改用官方压缩入口以控制工具 chunk 体积（R5 gzip 基线）。
        { find: /^pdfjs-dist$/, replacement: r('./node_modules/pdfjs-dist/build/pdf.min.mjs') }
      ]
    },
    plugins: [vue(), tailwindcss(), prodCspMeta]
  }
})
