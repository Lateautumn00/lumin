import type { RegisterMain } from '@lumin/plugin-api'
import { registerMain as diskAnalyzerRegisterMain } from '@lumin/tool-disk-analyzer/node'
import { registerMain as docx2pdfRegisterMain } from '@lumin/tool-docx2pdf/node'
import { registerMain as duplicateFinderRegisterMain } from '@lumin/tool-duplicate-finder/node'
import { registerMain as exampleRegisterMain } from '@lumin/tool-example/node'
import { registerMain as examSplitRegisterMain } from '@lumin/tool-exam-split/node'
import { registerMain as fileHasherRegisterMain } from '@lumin/tool-file-hasher/node'
import { registerMain as fileRenamerRegisterMain } from '@lumin/tool-file-renamer/node'
import { registerMain as imageToolboxRegisterMain } from '@lumin/tool-image-toolbox/node'
import { registerMain as imageStitchRegisterMain } from '@lumin/tool-image-stitch/node'
import { registerMain as imageWatermarkRegisterMain } from '@lumin/tool-image-watermark/node'
import { registerMain as mediaConvertRegisterMain } from '@lumin/tool-media-convert/node'
import { registerMain as ocrTextRegisterMain } from '@lumin/tool-ocr-text/node'
import { registerMain as pdfImagesRegisterMain } from '@lumin/tool-pdf-images/node'
import { registerMain as pdfToolkitRegisterMain } from '@lumin/tool-pdf-toolkit/node'
import { registerMain as qrCodeRegisterMain } from '@lumin/tool-qr-code/node'
import { registerMain as videoDownloadRegisterMain } from '@lumin/tool-video-download/node'

export const toolMains: Readonly<Record<string, RegisterMain>> = {
  'disk-analyzer': diskAnalyzerRegisterMain,
  docx2pdf: docx2pdfRegisterMain,
  'duplicate-finder': duplicateFinderRegisterMain,
  example: exampleRegisterMain,
  'exam-split': examSplitRegisterMain,
  'file-hasher': fileHasherRegisterMain,
  'file-renamer': fileRenamerRegisterMain,
  'image-toolbox': imageToolboxRegisterMain,
  'image-stitch': imageStitchRegisterMain,
  'image-watermark': imageWatermarkRegisterMain,
  'media-convert': mediaConvertRegisterMain,
  'ocr-text': ocrTextRegisterMain,
  'pdf-images': pdfImagesRegisterMain,
  'pdf-toolkit': pdfToolkitRegisterMain,
  'qr-code': qrCodeRegisterMain,
  'video-download': videoDownloadRegisterMain
}
