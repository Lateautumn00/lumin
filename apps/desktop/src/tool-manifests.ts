import type { ToolManifest } from '@lumin/plugin-api'
import { manifest as batchOcrManifest } from '@lumin/tool-batch-ocr/manifest'
import { manifest as calculatorManifest } from '@lumin/tool-calculator/manifest'
import { manifest as colorToolboxManifest } from '@lumin/tool-color-toolbox/manifest'
import { manifest as diskAnalyzerManifest } from '@lumin/tool-disk-analyzer/manifest'
import { manifest as docx2pdfManifest } from '@lumin/tool-docx2pdf/manifest'
import { manifest as duplicateFinderManifest } from '@lumin/tool-duplicate-finder/manifest'
import { manifest as exampleManifest } from '@lumin/tool-example/manifest'
import { manifest as examSplitManifest } from '@lumin/tool-exam-split/manifest'
import { manifest as fileHasherManifest } from '@lumin/tool-file-hasher/manifest'
import { manifest as fileRenamerManifest } from '@lumin/tool-file-renamer/manifest'
import { manifest as folderCompareManifest } from '@lumin/tool-folder-compare/manifest'
import { manifest as imageToolboxManifest } from '@lumin/tool-image-toolbox/manifest'
import { manifest as imageRotateManifest } from '@lumin/tool-image-rotate/manifest'
import { manifest as imageStitchManifest } from '@lumin/tool-image-stitch/manifest'
import { manifest as imageWatermarkManifest } from '@lumin/tool-image-watermark/manifest'
import { manifest as mediaConvertManifest } from '@lumin/tool-media-convert/manifest'
import { manifest as ocrTextManifest } from '@lumin/tool-ocr-text/manifest'
import { manifest as passwordGeneratorManifest } from '@lumin/tool-password-generator/manifest'
import { manifest as pdfImagesManifest } from '@lumin/tool-pdf-images/manifest'
import { manifest as pdfToolkitManifest } from '@lumin/tool-pdf-toolkit/manifest'
import { manifest as qrCodeManifest } from '@lumin/tool-qr-code/manifest'
import { manifest as textDiffManifest } from '@lumin/tool-text-diff/manifest'
import { manifest as textToolboxManifest } from '@lumin/tool-text-toolbox/manifest'
import { manifest as timeToolboxManifest } from '@lumin/tool-time-toolbox/manifest'
import { manifest as unitConverterManifest } from '@lumin/tool-unit-converter/manifest'
import { manifest as videoDownloadManifest } from '@lumin/tool-video-download/manifest'
import { manifest as zipToolManifest } from '@lumin/tool-zip-tool/manifest'

/** 壳内唯一工具清单（Q14）：新增工具 = 新包 + 此处 1 行 + tool-mains 1 行（如有主进程）+ renderer 薄壳 1 行 */
export const toolManifests: readonly ToolManifest[] = [
  calculatorManifest,
  unitConverterManifest,
  docx2pdfManifest,
  examSplitManifest,
  imageToolboxManifest,
  imageRotateManifest,
  imageStitchManifest,
  imageWatermarkManifest,
  pdfImagesManifest,
  pdfToolkitManifest,
  fileRenamerManifest,
  textToolboxManifest,
  textDiffManifest,
  videoDownloadManifest,
  fileHasherManifest,
  mediaConvertManifest,
  qrCodeManifest,
  ocrTextManifest,
  batchOcrManifest,
  duplicateFinderManifest,
  diskAnalyzerManifest,
  folderCompareManifest,
  zipToolManifest,
  colorToolboxManifest,
  timeToolboxManifest,
  passwordGeneratorManifest,
  exampleManifest
]
