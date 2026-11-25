import type { ToolManifest } from '@lumin/plugin-api'
import { manifest as calculatorManifest } from '@lumin/tool-calculator/manifest'
import { manifest as calendarManifest } from '@lumin/tool-calendar/manifest'
import { manifest as colorToolboxManifest } from '@lumin/tool-color-toolbox/manifest'
import { manifest as devToolboxManifest } from '@lumin/tool-dev-toolbox/manifest'
import { manifest as docx2pdfManifest } from '@lumin/tool-docx2pdf/manifest'
import { manifest as exampleManifest } from '@lumin/tool-example/manifest'
import { manifest as examSplitManifest } from '@lumin/tool-exam-split/manifest'
import { manifest as filePreviewManifest } from '@lumin/tool-file-preview/manifest'
import { manifest as fileScannerManifest } from '@lumin/tool-file-scanner/manifest'
import { manifest as imageToolboxManifest } from '@lumin/tool-image-toolbox/manifest'
import { manifest as markdownToolManifest } from '@lumin/tool-markdown-tool/manifest'
import { manifest as mediaConvertManifest } from '@lumin/tool-media-convert/manifest'
import { manifest as mindmapManifest } from '@lumin/tool-mindmap/manifest'
import { manifest as miscToolboxManifest } from '@lumin/tool-misc-toolbox/manifest'
import { manifest as pdfToolkitManifest } from '@lumin/tool-pdf-toolkit/manifest'
import { manifest as textToolboxManifest } from '@lumin/tool-text-toolbox/manifest'
import { manifest as timeToolboxManifest } from '@lumin/tool-time-toolbox/manifest'

/** 壳内唯一工具清单（Q14）：新增工具 = 新包 + 此处 1 行 + tool-mains 1 行（如有主进程）+ renderer 薄壳 1 行 */
export const toolManifests: readonly ToolManifest[] = [
  calculatorManifest,
  calendarManifest,
  docx2pdfManifest,
  examSplitManifest,
  imageToolboxManifest,
  pdfToolkitManifest,
  textToolboxManifest,
  mindmapManifest,
  markdownToolManifest,
  fileScannerManifest,
  mediaConvertManifest,
  colorToolboxManifest,
  timeToolboxManifest,
  devToolboxManifest,
  miscToolboxManifest,
  exampleManifest,
  filePreviewManifest
]

/** 启动默认工具 id（Q60：打开程序默认显示日历；工具名仅允许出现在本清单文件） */
export const DEFAULT_TOOL_ID = 'calendar'
