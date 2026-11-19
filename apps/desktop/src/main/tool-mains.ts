import type { RegisterMain } from '@lumin/plugin-api'
import { registerMain as docx2pdfRegisterMain } from '@lumin/tool-docx2pdf/node'
import { registerMain as exampleRegisterMain } from '@lumin/tool-example/node'
import { registerMain as examSplitRegisterMain } from '@lumin/tool-exam-split/node'
import { registerMain as fileRenamerRegisterMain } from '@lumin/tool-file-renamer/node'
import { registerMain as imageToolboxRegisterMain } from '@lumin/tool-image-toolbox/node'
import { registerMain as pdfImagesRegisterMain } from '@lumin/tool-pdf-images/node'
import { registerMain as videoDownloadRegisterMain } from '@lumin/tool-video-download/node'

export const toolMains: Readonly<Record<string, RegisterMain>> = {
  docx2pdf: docx2pdfRegisterMain,
  example: exampleRegisterMain,
  'exam-split': examSplitRegisterMain,
  'file-renamer': fileRenamerRegisterMain,
  'image-toolbox': imageToolboxRegisterMain,
  'pdf-images': pdfImagesRegisterMain,
  'video-download': videoDownloadRegisterMain
}
