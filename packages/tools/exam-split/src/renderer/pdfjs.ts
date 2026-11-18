/**
 * renderer 侧 pdfjs 单点初始化（PDF 预览与 OCR Tab 预览共用）。
 * `GlobalWorkerOptions.workerSrc` 必须在使用前赋值：两处预览共用同一 worker 资产。
 *
 * 运行时取 **minified 构建**（见 `electron.vite.config.ts` 的 renderer 别名）：electron-vite
 * 默认不压缩产物，根入口会把 891KB 未压缩主库整个打进工具 chunk，压缩入口约省 180KB raw。
 */
import * as pdfjs from 'pdfjs-dist'
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl

export { pdfjs }
