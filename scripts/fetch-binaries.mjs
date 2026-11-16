#!/usr/bin/env node
/**
 * 下载/校验外部二进制与 OCR 模型（AGENTS §3/§10：固定 URL + SHA256 钉死，产物不入 git）。
 *
 * 用法：
 *   node scripts/fetch-binaries.mjs            # 下载缺失或校验失败的文件
 *   node scripts/fetch-binaries.mjs --check    # 只校验，不下载（CI/发布前）
 *
 * 产物落 `binaries/`（已 gitignore）：
 *   binaries/ocr/{det,rec,cls}.onnx + binaries/ocr/ppocr_keys_v1.txt
 *
 * 模型源：RapidOCR 官方托管（modelscope），SHA256 与其上游 default_models.yaml 一致；
 * cls 与字典以上游不可达时的本机实测值钉死（2026-11-16，见 plan §4.4 M3b 记录）。
 */
import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const OUT_DIR = join(ROOT, 'binaries', 'ocr')

/** @type {ReadonlyArray<{ id: string, url: string, sha256: string, bytes: number }>} */
const ASSETS = [
  {
    id: 'det',
    url: 'https://modelscope.cn/models/RapidAI/RapidOCR/resolve/v3.10.0/onnx/PP-OCRv4/det/ch_PP-OCRv4_det_mobile.onnx',
    sha256: 'd2a7720d45a54257208b1e13e36a8479894cb74155a5efe29462512d42f49da9',
    bytes: 4745517
  },
  {
    id: 'rec',
    url: 'https://modelscope.cn/models/RapidAI/RapidOCR/resolve/v3.10.0/onnx/PP-OCRv4/rec/ch_PP-OCRv4_rec_mobile.onnx',
    sha256: '48fc40f24f6d2a207a2b1091d3437eb3cc3eb6b676dc3ef9c37384005483683b',
    bytes: 10857958
  },
  {
    id: 'cls',
    url: 'https://modelscope.cn/models/RapidAI/RapidOCR/resolve/v3.10.0/onnx/PP-OCRv4/cls/ch_ppocr_mobile_v2.0_cls_mobile.onnx',
    sha256: 'e47acedf663230f8863ff1ab0e64dd2d82b838fceb5957146dab185a89d6215c',
    bytes: 585532
  },
  {
    id: 'dict',
    url: 'https://modelscope.cn/models/RapidAI/RapidOCR/resolve/v3.10.0/paddle/PP-OCRv4/rec/ch_PP-OCRv4_rec_mobile/ppocr_keys_v1.txt',
    sha256: '28b2362ad4ab2dc38769aa72feb535e3a9ddb3fd2a7585a05920e6393b1dc7f7',
    bytes: 26249
  }
]

/** 目标文件名（id → 落盘名） */
const FILE_NAMES = {
  det: 'det.onnx',
  rec: 'rec.onnx',
  cls: 'cls.onnx',
  dict: 'ppocr_keys_v1.txt'
}

async function sha256File(path) {
  return createHash('sha256')
    .update(await readFile(path))
    .digest('hex')
}

async function verify(asset, path) {
  if (!existsSync(path)) return 'missing'
  const actual = await sha256File(path)
  return actual === asset.sha256 ? 'ok' : 'corrupt'
}

async function download(asset, path) {
  const res = await fetch(asset.url, { redirect: 'follow' })
  if (!res.ok) throw new Error(`${asset.id}: HTTP ${res.status} (${asset.url})`)
  const buf = Buffer.from(await res.arrayBuffer())
  const actual = createHash('sha256').update(buf).digest('hex')
  if (actual !== asset.sha256) {
    throw new Error(`${asset.id}: SHA256 不匹配，期望 ${asset.sha256}，实得 ${actual}`)
  }
  if (buf.length !== asset.bytes) {
    throw new Error(`${asset.id}: 体积异常，期望 ${asset.bytes}，实得 ${buf.length}`)
  }
  await writeFile(path, buf)
  return buf.length
}

async function main() {
  const checkOnly = process.argv.includes('--check')
  await mkdir(OUT_DIR, { recursive: true })

  let failed = 0
  for (const asset of ASSETS) {
    const path = join(OUT_DIR, FILE_NAMES[asset.id])
    const state = await verify(asset, path)
    if (state === 'ok') {
      console.log(`OK      ${asset.id}  ${path}`)
      continue
    }
    if (checkOnly) {
      console.error(`FAIL    ${asset.id}  ${state}  ${path}`)
      failed += 1
      continue
    }
    if (state === 'corrupt') console.log(`REPAIR  ${asset.id}  校验失败，重新下载…`)
    else console.log(`FETCH   ${asset.id}  ${asset.url}`)
    const size = await download(asset, path)
    console.log(`OK      ${asset.id}  ${size} bytes`)
  }

  if (failed > 0) {
    console.error(`\n${failed} 个文件校验失败，请运行 node scripts/fetch-binaries.mjs 重新下载`)
    process.exit(1)
  }
  console.log('\nOCR 资产就绪：' + OUT_DIR)
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err))
  process.exit(1)
})
