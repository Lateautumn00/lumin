#!/usr/bin/env node
/**
 * 下载/校验外部二进制与 OCR 模型（AGENTS §3/§10：固定 URL + SHA256 钉死，产物不入 git）。
 *
 * 用法：
 *   node scripts/fetch-binaries.mjs            # 下载缺失或校验失败的文件
 *   node scripts/fetch-binaries.mjs --check    # 只校验，不下载（CI/发布前）
 *   node scripts/fetch-binaries.mjs --group download   # 只处理指定组（默认全部）
 *
 * 产物落 `binaries/`（已 gitignore）：
 *   binaries/ocr/{det,rec,cls}.onnx + binaries/ocr/ppocr_keys_v1.txt
 *   binaries/download/yt-dlp.exe + binaries/download/{ffmpeg,ffprobe}.exe
 *
 * 模型源：RapidOCR 官方托管（modelscope），SHA256 与其上游 default_models.yaml 一致；
 * cls 与字典以上游不可达时的本机实测值钉死（2026-11-16，见 plan §4.4 M3b 记录）。
 * 下载引擎：yt-dlp 2026.10.26 官方 Release（SHA256 本机实测钉死）；ffmpeg/ffprobe 来自
 * ffmpeg-static b6.1.1 Release（win32-x64，.gz 压缩变体，SHA256 为解压后本机实测钉死，
 * 2026-11-18，见 docs/smoke/video-download.md）。
 */
import { createHash } from 'node:crypto'
import { gunzipSync } from 'node:zlib'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

/**
 * @typedef {{ id: string, url: string, sha256: string, bytes?: number, gunzip?: boolean }} Asset
 * bytes 可省略（省略时只校验 SHA256）：yt-dlp 单文件 Release 无稳定体积参照；
 * gunzip=true 表示下载的是 .gz 压缩文件，需解压后落盘并按解压产物校验 SHA256/bytes
 */

/** @type {Readonly<Record<string, { outDir: string, assets: ReadonlyArray<Asset> }>>} */
const GROUPS = {
  ocr: {
    outDir: join(ROOT, 'binaries', 'ocr'),
    assets: [
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
  },
  download: {
    outDir: join(ROOT, 'binaries', 'download'),
    assets: [
      {
        id: 'yt-dlp',
        url: 'https://github.com/yt-dlp/yt-dlp/releases/download/2026.10.26/yt-dlp.exe',
        sha256: 'f5389d3698ecde4ef06f4e6b1ce0294fe9ac1396228c8990b8d3416d6d177a7d'
      },
      {
        id: 'ffmpeg',
        url: 'https://github.com/eugeneware/ffmpeg-static/releases/download/b6.1.1/ffmpeg-win32-x64.gz',
        sha256: '04e1307997530f9cf2fe35cba2ca7e8875ca91da02f89d6c7243df819c94ad00',
        bytes: 82797568,
        gunzip: true
      },
      {
        id: 'ffprobe',
        url: 'https://github.com/eugeneware/ffmpeg-static/releases/download/b6.1.1/ffprobe-win32-x64.gz',
        sha256: '3a7e2dc003dc2cd1472827e4c7c4f056ae1ae0ae7c5bbc580c99b49827351ba4',
        bytes: 82668032,
        gunzip: true
      }
    ]
  }
}

/** 目标文件名（id → 落盘名） */
const FILE_NAMES = {
  det: 'det.onnx',
  rec: 'rec.onnx',
  cls: 'cls.onnx',
  dict: 'ppocr_keys_v1.txt',
  'yt-dlp': 'yt-dlp.exe',
  ffmpeg: 'ffmpeg.exe',
  ffprobe: 'ffprobe.exe'
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
  let buf = Buffer.from(await res.arrayBuffer())
  if (asset.gunzip === true) buf = gunzipSync(buf)
  const actual = createHash('sha256').update(buf).digest('hex')
  if (actual !== asset.sha256) {
    throw new Error(`${asset.id}: SHA256 不匹配，期望 ${asset.sha256}，实得 ${actual}`)
  }
  if (asset.bytes !== undefined && buf.length !== asset.bytes) {
    throw new Error(`${asset.id}: 体积异常，期望 ${asset.bytes}，实得 ${buf.length}`)
  }
  await writeFile(path, buf)
  return buf.length
}

async function main() {
  const checkOnly = process.argv.includes('--check')
  const groupIdx = process.argv.indexOf('--group')
  const onlyGroup = groupIdx !== -1 ? process.argv[groupIdx + 1] : null

  let failed = 0
  for (const [groupName, group] of Object.entries(GROUPS)) {
    if (onlyGroup !== null && groupName !== onlyGroup) continue
    await mkdir(group.outDir, { recursive: true })

    for (const asset of group.assets) {
      const path = join(group.outDir, FILE_NAMES[asset.id])
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
  }

  if (failed > 0) {
    console.error(`\n${failed} 个文件未就绪，请运行 node scripts/fetch-binaries.mjs 重新下载`)
    process.exit(1)
  }
  console.log('\n外部二进制就绪')
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err))
  process.exit(1)
})
