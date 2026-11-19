/**
 * OCR 模型资产清单与预检（spec §10.5/§10.8；上提自 exam-split）。
 *
 * 资产由壳注入的 `ToolPaths.binaries` 定位（开发态 = 仓库根 binaries/，打包态 =
 * resources/binaries，electron-builder extraResources），工具不自行猜测路径。
 * SHA256/体积与 `scripts/fetch-binaries.mjs` ASSETS 逐字同步（AGENTS §10：固定 URL + SHA256）。
 */
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { errnoCode } from '@lumin/shared'
import { ocrToolError } from './errors'

/** 单个模型资产（落盘文件名 + 钉死的体积与 SHA256） */
export interface OcrAssetSpec {
  readonly file: string
  readonly sha256: string
  readonly bytes: number
}

/** 模型资产表（与 fetch-binaries.mjs ASSETS 同步；改动须两处同改） */
export const OCR_ASSETS = {
  det: {
    file: 'det.onnx',
    sha256: 'd2a7720d45a54257208b1e13e36a8479894cb74155a5efe29462512d42f49da9',
    bytes: 4745517
  },
  rec: {
    file: 'rec.onnx',
    sha256: '48fc40f24f6d2a207a2b1091d3437eb3cc3eb6b676dc3ef9c37384005483683b',
    bytes: 10857958
  },
  cls: {
    file: 'cls.onnx',
    sha256: 'e47acedf663230f8863ff1ab0e64dd2d82b838fceb5957146dab185a89d6215c',
    bytes: 585532
  },
  dict: {
    file: 'ppocr_keys_v1.txt',
    sha256: '28b2362ad4ab2dc38769aa72feb535e3a9ddb3fd2a7585a05920e6393b1dc7f7',
    bytes: 26249
  }
} as const satisfies Record<string, OcrAssetSpec>

/** 模型目录：`{binaries}/ocr`（fetch-binaries.mjs 落盘结构；cls 只校验不推理） */
export function ocrModelDir(binariesRoot: string): string {
  return join(binariesRoot, 'ocr')
}

/**
 * 预检模型资产：存在 + 体积 + SHA256。
 * 每次 detect 前执行、不缓存（16MB 校验 ≈60ms，换取模型损坏可被即时发现）。
 * 任一不符 → `MODEL_MISSING`（spec §10.5）。`assets` 可注入假表供单测。
 */
export async function verifyOcrAssets(
  dir: string,
  assets: Readonly<Record<string, OcrAssetSpec>> = OCR_ASSETS
): Promise<void> {
  for (const [id, spec] of Object.entries(assets)) {
    const path = join(dir, spec.file)
    let bytes: Buffer
    try {
      bytes = await readFile(path)
    } catch (err) {
      throw ocrToolError('MODEL_MISSING', `${id}: ${errnoCode(err) || '无法读取'}`)
    }
    if (bytes.length !== spec.bytes) {
      throw ocrToolError('MODEL_MISSING', `${id}: 体积 ${bytes.length} ≠ ${spec.bytes}`)
    }
    const actual = createHash('sha256').update(bytes).digest('hex')
    if (actual !== spec.sha256) {
      throw ocrToolError('MODEL_MISSING', `${id}: SHA256 不匹配`)
    }
  }
}
