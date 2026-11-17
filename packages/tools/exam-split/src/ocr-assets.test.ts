import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, describe, expect, it } from 'vitest'
import { OCR_ASSETS, ocrModelDir, verifyOcrAssets, type OcrAssetSpec } from './ocr-assets'

const REPO_ROOT = fileURLToPath(new URL('../../../../', import.meta.url))
const REAL_DIR = join(REPO_ROOT, 'binaries', 'ocr')
const FETCH_SCRIPT = join(REPO_ROOT, 'scripts', 'fetch-binaries.mjs')

let root = ''

function tempRoot(): string {
  if (root === '') root = mkdtempSync(join(tmpdir(), 'lumin-exam-assets-'))
  return root
}

afterAll(() => {
  if (root !== '') rmSync(root, { recursive: true, force: true })
})

/** 伪造资产表 → 临时目录（key = 落盘文件名） */
function fakeDir(files: Record<string, string | Buffer>): string {
  const dir = join(tempRoot(), `fake-${Math.random().toString(36).slice(2)}`)
  mkdirSync(dir, { recursive: true })
  for (const [name, content] of Object.entries(files)) writeFileSync(join(dir, name), content)
  return dir
}

function spec(file: string, content: string, overrides: Partial<OcrAssetSpec> = {}): OcrAssetSpec {
  return {
    file,
    bytes: Buffer.byteLength(content),
    sha256: createHash('sha256').update(content).digest('hex'),
    ...overrides
  }
}

describe('OCR_ASSETS（AGENTS §10：固定 URL + SHA256 钉死）', () => {
  it('文件名/体积/SHA256 与 fetch-binaries.mjs 逐字同步', async () => {
    const source = await readFile(FETCH_SCRIPT, 'utf8')
    for (const asset of Object.values(OCR_ASSETS)) {
      expect(source).toContain(asset.sha256)
      expect(source).toContain(`bytes: ${asset.bytes}`)
      expect(source).toContain(`'${asset.file}'`)
    }
  })

  it('四个资产齐全且口径固定（det/rec/cls/dict 实测 16.2MB，spec §10.8）', () => {
    expect(Object.keys(OCR_ASSETS).sort()).toEqual(['cls', 'det', 'dict', 'rec'])
    const total = Object.values(OCR_ASSETS).reduce((sum, asset) => sum + asset.bytes, 0)
    expect(total).toBe(16_215_256)
  })
})

describe('ocrModelDir', () => {
  it('模型目录 = {binaries}/ocr（fetch-binaries.mjs 落盘结构）', () => {
    expect(ocrModelDir('C:/app/resources/binaries')).toBe(join('C:/app/resources/binaries', 'ocr'))
  })
})

describe('verifyOcrAssets（spec §10.5 → MODEL_MISSING）', () => {
  it('资产缺失 → MODEL_MISSING（detail 带资产 id 与 errno）', async () => {
    const dir = fakeDir({})
    await expect(verifyOcrAssets(dir, { det: spec('det.onnx', 'x') })).rejects.toMatchObject({
      code: 'MODEL_MISSING',
      detail: 'det: ENOENT'
    })
  })

  it('体积不符 → MODEL_MISSING（截断/损坏文件被拒）', async () => {
    const content = 'hello-model'
    const dir = fakeDir({ 'det.onnx': content })
    await expect(
      verifyOcrAssets(dir, { det: spec('det.onnx', content, { bytes: content.length + 1 }) })
    ).rejects.toMatchObject({ code: 'MODEL_MISSING', detail: expect.stringContaining('体积') })
  })

  it('SHA256 不符 → MODEL_MISSING（同体积改一字节也被拒）', async () => {
    const content = 'hello-model'
    const dir = fakeDir({ 'det.onnx': 'hello-modem' })
    await expect(verifyOcrAssets(dir, { det: spec('det.onnx', content) })).rejects.toMatchObject({
      code: 'MODEL_MISSING',
      detail: expect.stringContaining('SHA256')
    })
  })

  it('齐全且哈希正确 → 通过（多资产逐个校验）', async () => {
    const a = 'model-a'
    const b = 'dict-b'
    const dir = fakeDir({ 'det.onnx': a, 'ppocr_keys_v1.txt': b })
    await expect(
      verifyOcrAssets(dir, { det: spec('det.onnx', a), dict: spec('ppocr_keys_v1.txt', b) })
    ).resolves.toBeUndefined()
  })

  it.skipIf(!existsSync(REAL_DIR))(
    '真实 binaries/ocr → 四资产全部通过（每次 detect 前的预检口径）',
    async () => {
      await expect(verifyOcrAssets(REAL_DIR)).resolves.toBeUndefined()
    }
  )
})
