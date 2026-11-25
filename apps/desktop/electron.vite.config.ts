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
  { find: /^@lumin\/ocr-kit$/, replacement: r('../../packages/ocr-kit/src/index.ts') },
  {
    find: /^@lumin\/node-kit\/pdf$/,
    replacement: r('../../packages/node-kit/src/pdf/index.ts')
  },
  {
    find: /^@lumin\/node-kit\/office$/,
    replacement: r('../../packages/node-kit/src/office/index.ts')
  },
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
    find: /^@lumin\/tool-pdf-toolkit\/manifest$/,
    replacement: r('../../packages/tools/pdf-toolkit/src/manifest.ts')
  },
  {
    find: /^@lumin\/tool-pdf-toolkit\/node$/,
    replacement: r('../../packages/tools/pdf-toolkit/src/node.ts')
  },
  {
    find: /^@lumin\/tool-pdf-toolkit\/renderer\/(.+)$/,
    replacement: r('../../packages/tools/pdf-toolkit/src/renderer/$1')
  },
  {
    find: /^@lumin\/tool-color-toolbox\/manifest$/,
    replacement: r('../../packages/tools/color-toolbox/src/manifest.ts')
  },
  {
    find: /^@lumin\/tool-color-toolbox\/node$/,
    replacement: r('../../packages/tools/color-toolbox/src/node.ts')
  },
  {
    find: /^@lumin\/tool-color-toolbox\/renderer\/(.+)$/,
    replacement: r('../../packages/tools/color-toolbox/src/renderer/$1')
  },
  {
    find: /^@lumin\/tool-file-scanner\/manifest$/,
    replacement: r('../../packages/tools/file-scanner/src/manifest.ts')
  },
  {
    find: /^@lumin\/tool-file-scanner\/node$/,
    replacement: r('../../packages/tools/file-scanner/src/node.ts')
  },
  {
    find: /^@lumin\/tool-file-scanner\/renderer\/(.+)$/,
    replacement: r('../../packages/tools/file-scanner/src/renderer/$1')
  },
  {
    find: /^@lumin\/tool-text-toolbox\/manifest$/,
    replacement: r('../../packages/tools/text-toolbox/src/manifest.ts')
  },
  {
    find: /^@lumin\/tool-text-toolbox\/node$/,
    replacement: r('../../packages/tools/text-toolbox/src/node.ts')
  },
  {
    find: /^@lumin\/tool-text-toolbox\/renderer\/(.+)$/,
    replacement: r('../../packages/tools/text-toolbox/src/renderer/$1')
  },
  {
    find: /^@lumin\/tool-markdown-tool\/manifest$/,
    replacement: r('../../packages/tools/markdown-tool/src/manifest.ts')
  },
  {
    find: /^@lumin\/tool-markdown-tool\/node$/,
    replacement: r('../../packages/tools/markdown-tool/src/node.ts')
  },
  {
    find: /^@lumin\/tool-markdown-tool\/renderer\/(.+)$/,
    replacement: r('../../packages/tools/markdown-tool/src/renderer/$1')
  },
  {
    find: /^@lumin\/tool-file-preview\/manifest$/,
    replacement: r('../../packages/tools/file-preview/src/manifest.ts')
  },
  {
    find: /^@lumin\/tool-file-preview\/node$/,
    replacement: r('../../packages/tools/file-preview/src/node.ts')
  },
  {
    find: /^@lumin\/tool-file-preview\/renderer\/(.+)$/,
    replacement: r('../../packages/tools/file-preview/src/renderer/$1')
  },
  {
    find: /^@lumin\/tool-time-toolbox\/manifest$/,
    replacement: r('../../packages/tools/time-toolbox/src/manifest.ts')
  },
  {
    find: /^@lumin\/tool-time-toolbox\/renderer\/(.+)$/,
    replacement: r('../../packages/tools/time-toolbox/src/renderer/$1')
  },
  {
    find: /^@lumin\/tool-calendar\/manifest$/,
    replacement: r('../../packages/tools/calendar/src/manifest.ts')
  },
  {
    find: /^@lumin\/tool-calendar\/renderer\/(.+)$/,
    replacement: r('../../packages/tools/calendar/src/renderer/$1')
  },
  {
    find: /^@lumin\/tool-media-convert\/manifest$/,
    replacement: r('../../packages/tools/media-convert/src/manifest.ts')
  },
  {
    find: /^@lumin\/tool-media-convert\/node$/,
    replacement: r('../../packages/tools/media-convert/src/node.ts')
  },
  {
    find: /^@lumin\/tool-media-convert\/renderer\/(.+)$/,
    replacement: r('../../packages/tools/media-convert/src/renderer/$1')
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
    find: /^@lumin\/tool-mindmap\/manifest$/,
    replacement: r('../../packages/tools/mindmap/src/manifest.ts')
  },
  {
    find: /^@lumin\/tool-mindmap\/node$/,
    replacement: r('../../packages/tools/mindmap/src/node.ts')
  },
  {
    find: /^@lumin\/tool-mindmap\/renderer\/(.+)$/,
    replacement: r('../../packages/tools/mindmap/src/renderer/$1')
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
