import type { RegisterMain } from '@lumin/plugin-api'
import { registerMain as colorToolboxRegisterMain } from '@lumin/tool-color-toolbox/node'
import { registerMain as devToolboxRegisterMain } from '@lumin/tool-dev-toolbox/node'
import { registerMain as docx2pdfRegisterMain } from '@lumin/tool-docx2pdf/node'
import { registerMain as exampleRegisterMain } from '@lumin/tool-example/node'
import { registerMain as examSplitRegisterMain } from '@lumin/tool-exam-split/node'
import { registerMain as filePreviewRegisterMain } from '@lumin/tool-file-preview/node'
import { registerMain as fileScannerRegisterMain } from '@lumin/tool-file-scanner/node'
import { registerMain as imageToolboxRegisterMain } from '@lumin/tool-image-toolbox/node'
import { registerMain as markdownToolRegisterMain } from '@lumin/tool-markdown-tool/node'
import { registerMain as mediaConvertRegisterMain } from '@lumin/tool-media-convert/node'
import { registerMain as mindmapRegisterMain } from '@lumin/tool-mindmap/node'
import { registerMain as miscToolboxRegisterMain } from '@lumin/tool-misc-toolbox/node'
import { registerMain as ocrTextRegisterMain } from '@lumin/tool-ocr-text/node'
import { registerMain as pdfToolkitRegisterMain } from '@lumin/tool-pdf-toolkit/node'
import { registerMain as printRegisterMain } from '@lumin/tool-print/node'
import { registerMain as qrCodeRegisterMain } from '@lumin/tool-qr-code/node'
import { registerMain as textToolboxRegisterMain } from '@lumin/tool-text-toolbox/node'
import { registerMain as zipToolRegisterMain } from '@lumin/tool-zip-tool/node'

export const toolMains: Readonly<Record<string, RegisterMain>> = {
  'color-toolbox': colorToolboxRegisterMain,
  'dev-toolbox': devToolboxRegisterMain,
  docx2pdf: docx2pdfRegisterMain,
  example: exampleRegisterMain,
  'exam-split': examSplitRegisterMain,
  'file-preview': filePreviewRegisterMain,
  'file-scanner': fileScannerRegisterMain,
  'image-toolbox': imageToolboxRegisterMain,
  'markdown-tool': markdownToolRegisterMain,
  'media-convert': mediaConvertRegisterMain,
  mindmap: mindmapRegisterMain,
  'misc-toolbox': miscToolboxRegisterMain,
  'ocr-text': ocrTextRegisterMain,
  'pdf-toolkit': pdfToolkitRegisterMain,
  print: printRegisterMain,
  'qr-code': qrCodeRegisterMain,
  'text-toolbox': textToolboxRegisterMain,
  'zip-tool': zipToolRegisterMain
}
