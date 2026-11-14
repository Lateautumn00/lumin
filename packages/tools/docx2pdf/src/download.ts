import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { open, rename, stat, unlink } from 'node:fs/promises'
import { join } from 'node:path'
import { toolError } from './errors'

/** 钉死下载源（AGENTS §10：固定 URL + SHA256；m2-spike.md §1 实测选定） */
export const MSI_SOURCES = [
  {
    name: 'aliyun',
    url: 'https://mirrors.aliyun.com/libreoffice/stable/26.8.3/win/x86_64/LibreOffice_26.8.3_Win_x86-64.msi'
  },
  {
    name: 'tdf',
    url: 'https://download.documentfoundation.org/libreoffice/stable/26.8.3/win/x86_64/LibreOffice_26.8.3_Win_x86-64.msi'
  }
] as const

/** MSI 字节数（spike 实测） */
export const MSI_SIZE = 376_311_808
/** MSI SHA256（spike 实测） */
export const MSI_SHA256 = '0e6918c273eabbdbbd800ee0dacbbf130a14c13c2e4cec861b06dd59e015bf94'
/** 下载重试次数（按 [aliyun, tdf] 轮换） */
export const DOWNLOAD_RETRIES = 3
/** 进度节流间隔（ms） */
export const PROGRESS_INTERVAL_MS = 100

export interface DownloadOptions {
  destDir: string
  /** bytesLoaded / bytesTotal（已节流） */
  onProgress?: (bytesLoaded: number, bytesTotal: number) => void
  signal?: AbortSignal
  /** 注入用（测试 mock；默认 globalThis.fetch） */
  fetchImpl?: typeof fetch
  /** 注入用校验目标（默认 MSI_SIZE / MSI_SHA256，仅测试改小样本） */
  expectedSize?: number
  expectedSha256?: string
}

/** 文件 SHA256（小写 hex） */
export async function sha256File(path: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256')
    const stream = createReadStream(path)
    stream.on('data', (chunk) => hash.update(chunk))
    stream.on('error', reject)
    stream.on('end', () => resolve(hash.digest('hex')))
  })
}

async function sizeOf(path: string): Promise<number> {
  try {
    return (await stat(path)).size
  } catch {
    return 0
  }
}

function isAbort(err: unknown): boolean {
  return err instanceof Error && (err.name === 'AbortError' || err.message === 'aborted')
}

async function cleanupPart(partPath: string): Promise<void> {
  try {
    await unlink(partPath)
  } catch {
    /* 已不存在 */
  }
}

/** 单次源尝试：Range 断点续传（.part）；非中止失败保留 .part 供续传 */
async function fetchToPart(
  url: string,
  partPath: string,
  options: DownloadOptions,
  fetchImpl: typeof fetch
): Promise<void> {
  const { signal, onProgress } = options
  const existing = await sizeOf(partPath)
  const headers: Record<string, string> = existing > 0 ? { Range: `bytes=${existing}-` } : {}

  const res = await fetchImpl(url, { headers, signal })
  const resumed = existing > 0 && res.status === 206
  if (!res.ok && res.status !== 206) throw new Error(`HTTP ${res.status}`)
  if (!res.body) throw new Error('空响应体')

  const contentLength = Number(res.headers.get('content-length') ?? '0')
  const contentRange = res.headers.get('content-range')
  const total = contentRange
    ? Number(contentRange.split('/')[1] ?? '0')
    : res.status === 206
      ? existing + contentLength
      : contentLength

  const start = resumed ? existing : 0
  const handle = await open(partPath, resumed ? 'a' : 'w')
  try {
    let loaded = start
    let lastEmit = 0
    for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
      await handle.write(chunk)
      loaded += chunk.byteLength
      const now = Date.now()
      if (onProgress && (now - lastEmit >= PROGRESS_INTERVAL_MS || loaded >= total)) {
        lastEmit = now
        onProgress(loaded, total > 0 ? total : MSI_SIZE)
      }
    }
    await handle.sync()
  } finally {
    await handle.close()
  }
}

/**
 * 下载 LibreOffice MSI（钉死 URL/大小/哈希）：
 * - `.part` 断点续传（Range/206；服务端回 200 则截断重下）
 * - 失败按 [aliyun, tdf] 轮换重试 3 次；非中止失败保留 .part，取消清理
 * - 完成后整文件 SHA256 校验（不匹配删除并抛 CHECKSUM_MISMATCH）
 * - 目标文件已存在且校验通过则直接复用
 * 返回最终 msi 路径。
 */
export async function downloadMsi(options: DownloadOptions): Promise<string> {
  const { destDir, signal, onProgress } = options
  const fetchImpl = options.fetchImpl ?? globalThis.fetch
  const expectedSize = options.expectedSize ?? MSI_SIZE
  const expectedSha256 = options.expectedSha256 ?? MSI_SHA256
  const finalPath = join(destDir, 'LibreOffice_26.8.3_Win_x86-64.msi')
  const partPath = `${finalPath}.part`

  // 已有完整文件：直接校验复用
  if ((await sizeOf(finalPath)) > 0) {
    const digest = await sha256File(finalPath)
    if (digest === expectedSha256) return finalPath
    await unlink(finalPath).catch(() => undefined)
    throw toolError('CHECKSUM_MISMATCH', '既有文件哈希不匹配，已删除')
  }

  let lastError: unknown
  for (let attempt = 0; attempt < DOWNLOAD_RETRIES; attempt += 1) {
    const source = MSI_SOURCES[attempt % MSI_SOURCES.length]
    if (!source) break
    try {
      await fetchToPart(source.url, partPath, options, fetchImpl)
      lastError = undefined
      break
    } catch (err) {
      lastError = err
      if (isAbort(err) || signal?.aborted) {
        await cleanupPart(partPath)
        throw new Error('aborted')
      }
      // 非中止失败：保留 .part 进入下一源续传
    }
  }
  if (lastError !== undefined && lastError !== null) {
    const detail = lastError instanceof Error ? lastError.message : String(lastError)
    throw toolError('DOWNLOAD_FAILED', detail)
  }
  if (signal?.aborted) {
    await cleanupPart(partPath)
    throw new Error('aborted')
  }

  // 大小 + SHA256 双校验
  const downloaded = await sizeOf(partPath)
  if (downloaded !== expectedSize) {
    await cleanupPart(partPath)
    throw toolError('CHECKSUM_MISMATCH', `大小 ${downloaded} ≠ ${expectedSize}`)
  }
  const digest = await sha256File(partPath)
  if (digest !== expectedSha256) {
    await cleanupPart(partPath)
    throw toolError('CHECKSUM_MISMATCH', digest)
  }
  await rename(partPath, finalPath)
  onProgress?.(expectedSize, expectedSize)
  return finalPath
}
