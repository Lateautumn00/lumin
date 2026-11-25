import type { ToolManifest } from '@lumin/plugin-api'
import { manifest as calculatorManifest } from '@lumin/tool-calculator/manifest'
import { manifest as calendarManifest } from '@lumin/tool-calendar/manifest'
import { manifest as clipboardHistoryManifest } from '@lumin/tool-clipboard-history/manifest'
import { manifest as colorToolboxManifest } from '@lumin/tool-color-toolbox/manifest'
import { manifest as devToolboxManifest } from '@lumin/tool-dev-toolbox/manifest'
import { manifest as diskAnalyzerManifest } from '@lumin/tool-disk-analyzer/manifest'
import { manifest as docx2pdfManifest } from '@lumin/tool-docx2pdf/manifest'
import { manifest as exampleManifest } from '@lumin/tool-example/manifest'
import { manifest as examSplitManifest } from '@lumin/tool-exam-split/manifest'
import { manifest as filePreviewManifest } from '@lumin/tool-file-preview/manifest'
import { manifest as fileRenamerManifest } from '@lumin/tool-file-renamer/manifest'
import { manifest as fileScannerManifest } from '@lumin/tool-file-scanner/manifest'
import { manifest as fsCleanerManifest } from '@lumin/tool-fs-cleaner/manifest'
import { manifest as imageDewatermarkManifest } from '@lumin/tool-image-dewatermark/manifest'
import { manifest as imageToolboxManifest } from '@lumin/tool-image-toolbox/manifest'
import { manifest as imageStitchManifest } from '@lumin/tool-image-stitch/manifest'
import { manifest as imageWatermarkManifest } from '@lumin/tool-image-watermark/manifest'
import { manifest as lifeCalculatorManifest } from '@lumin/tool-life-calculator/manifest'
import { manifest as markdownToolManifest } from '@lumin/tool-markdown-tool/manifest'
import { manifest as mediaConvertManifest } from '@lumin/tool-media-convert/manifest'
import { manifest as mindmapManifest } from '@lumin/tool-mindmap/manifest'
import { manifest as miscToolboxManifest } from '@lumin/tool-misc-toolbox/manifest'
import { manifest as ocrTextManifest } from '@lumin/tool-ocr-text/manifest'
import { manifest as passwordGeneratorManifest } from '@lumin/tool-password-generator/manifest'
import { manifest as pdfImagesManifest } from '@lumin/tool-pdf-images/manifest'
import { manifest as pdfToolkitManifest } from '@lumin/tool-pdf-toolkit/manifest'
import { manifest as printManifest } from '@lumin/tool-print/manifest'
import { manifest as qrCodeManifest } from '@lumin/tool-qr-code/manifest'
import { manifest as systemInfoManifest } from '@lumin/tool-system-info/manifest'
import { manifest as textDiffManifest } from '@lumin/tool-text-diff/manifest'
import { manifest as textEditorManifest } from '@lumin/tool-text-editor/manifest'
import { manifest as textToolboxManifest } from '@lumin/tool-text-toolbox/manifest'
import { manifest as timeToolboxManifest } from '@lumin/tool-time-toolbox/manifest'
import { manifest as unitConverterManifest } from '@lumin/tool-unit-converter/manifest'
import { manifest as videoDownloadManifest } from '@lumin/tool-video-download/manifest'
import { manifest as videoPlayerManifest } from '@lumin/tool-video-player/manifest'
import { manifest as zipToolManifest } from '@lumin/tool-zip-tool/manifest'

/** 壳内唯一工具清单（Q14）：新增工具 = 新包 + 此处 1 行 + tool-mains 1 行（如有主进程）+ renderer 薄壳 1 行 */
export const toolManifests: readonly ToolManifest[] = [
  calculatorManifest,
  calendarManifest,
  clipboardHistoryManifest,
  unitConverterManifest,
  lifeCalculatorManifest,
  docx2pdfManifest,
  examSplitManifest,
  imageToolboxManifest,
  imageStitchManifest,
  imageWatermarkManifest,
  imageDewatermarkManifest,
  pdfImagesManifest,
  pdfToolkitManifest,
  printManifest,
  fileRenamerManifest,
  textToolboxManifest,
  textEditorManifest,
  mindmapManifest,
  markdownToolManifest,
  textDiffManifest,
  videoDownloadManifest,
  videoPlayerManifest,
  fileScannerManifest,
  mediaConvertManifest,
  qrCodeManifest,
  ocrTextManifest,
  diskAnalyzerManifest,
  fsCleanerManifest,
  zipToolManifest,
  colorToolboxManifest,
  timeToolboxManifest,
  passwordGeneratorManifest,
  devToolboxManifest,
  miscToolboxManifest,
  systemInfoManifest,
  exampleManifest,
  filePreviewManifest
]

/** 启动默认工具 id（Q60：打开程序默认显示日历；工具名仅允许出现在本清单文件） */
export const DEFAULT_TOOL_ID = 'calendar'
