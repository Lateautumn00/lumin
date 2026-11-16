import type { ToolManifest } from '@lumin/plugin-api'
import { manifest as calculatorManifest } from '@lumin/tool-calculator/manifest'
import { manifest as docx2pdfManifest } from '@lumin/tool-docx2pdf/manifest'
import { manifest as exampleManifest } from '@lumin/tool-example/manifest'
import { manifest as examSplitManifest } from '@lumin/tool-exam-split/manifest'
import { manifest as unitConverterManifest } from '@lumin/tool-unit-converter/manifest'

/** 壳内唯一工具清单（Q14）：新增工具 = 新包 + 此处 1 行 + tool-mains 1 行（如有主进程）+ renderer 薄壳 1 行 */
export const toolManifests: readonly ToolManifest[] = [
  calculatorManifest,
  unitConverterManifest,
  docx2pdfManifest,
  examSplitManifest,
  exampleManifest
]
