import { createHash } from 'node:crypto'
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { DOWNLOAD_RETRIES, MSI_SOURCES, downloadMsi } from './download'

const sha = (data: Uint8Array | string): string => createHash('sha256').update(data).digest('hex')

/** 构造 fetch 响应桩（body 为异步可迭代，供 for-await 消费） */
function stubResponse(
  status: number,
  chunks: readonly Uint8Array[],
  headers: Record<string, string> = {}
): Response {
  const lower: Record<string, string> = {}
  for (const [key, value] of Object.entries(headers)) lower[key.toLowerCase()] = value
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (key: string) => lower[key.toLowerCase()] ?? null },
    body: (async function* () {
      for (const chunk of chunks) yield chunk
    })()
  } as unknown as Response
}

const PAYLOAD = Buffer.from('fake-msi-payload-bytes')
const EXPECT = { expectedSize: PAYLOAD.byteLength, expectedSha256: sha(PAYLOAD) }

let dir = ''

async function makeDir(): Promise<string> {
  dir = await mkdtemp(join(tmpdir(), 'lumin-dl-test-'))
  return dir
}

afterEach(async () => {
  if (dir !== '') await rm(dir, { recursive: true, force: true })
  dir = ''
})

describe('downloadMsi', () => {
  it('首次下载（200）→ 落盘、校验、返回最终路径', async () => {
    const dest = await makeDir()
    const progress: Array<[number, number]> = []
    const path = await downloadMsi({
      destDir: dest,
      ...EXPECT,
      onProgress: (loaded, total) => progress.push([loaded, total]),
      fetchImpl: async () =>
        stubResponse(200, [PAYLOAD], { 'content-length': String(PAYLOAD.byteLength) })
    })
    expect(path).toBe(join(dest, 'LibreOffice_26.8.3_Win_x86-64.msi'))
    expect(await readFile(path, 'utf8')).toBe(PAYLOAD.toString('utf8'))
    await expect(stat(`${path}.part`)).rejects.toThrow()
    expect(progress.at(-1)).toEqual([PAYLOAD.byteLength, PAYLOAD.byteLength])
  })

  it('.part 存在时按 Range/206 续传拼接', async () => {
    const dest = await makeDir()
    const finalPath = join(dest, 'LibreOffice_26.8.3_Win_x86-64.msi')
    const partPath = `${finalPath}.part`
    const prefix = Buffer.from('fake-')
    await writeFile(partPath, prefix)
    const rest = Buffer.from('msi-payload-bytes')

    let seenRange = ''
    const path = await downloadMsi({
      destDir: dest,
      ...EXPECT,
      fetchImpl: async (_url, init) => {
        const headers = (init?.headers ?? {}) as Record<string, string>
        seenRange = headers['Range'] ?? ''
        return stubResponse(206, [rest], {
          'content-range': `bytes ${prefix.byteLength}-${PAYLOAD.byteLength - 1}/${PAYLOAD.byteLength}`,
          'content-length': String(rest.byteLength)
        })
      }
    })
    expect(seenRange).toBe(`bytes=${prefix.byteLength}-`)
    expect(await readFile(path)).toEqual(PAYLOAD)
  })

  it('服务端忽略 Range 回 200 → 截断重下（不拼接旧字节）', async () => {
    const dest = await makeDir()
    const finalPath = join(dest, 'LibreOffice_26.8.3_Win_x86-64.msi')
    await writeFile(`${finalPath}.part`, 'STALE-OLD-BYTES')

    const path = await downloadMsi({
      destDir: dest,
      ...EXPECT,
      fetchImpl: async () =>
        stubResponse(200, [PAYLOAD], { 'content-length': String(PAYLOAD.byteLength) })
    })
    expect(await readFile(path)).toEqual(PAYLOAD)
  })

  it('首源网络失败 → 按 [aliyun, tdf] 轮换到次源成功', async () => {
    const dest = await makeDir()
    const urls: string[] = []
    const path = await downloadMsi({
      destDir: dest,
      ...EXPECT,
      fetchImpl: async (url) => {
        urls.push(String(url))
        if (urls.length === 1) throw new Error('ECONNRESET')
        return stubResponse(200, [PAYLOAD], { 'content-length': String(PAYLOAD.byteLength) })
      }
    })
    expect(urls).toEqual([MSI_SOURCES[0].url, MSI_SOURCES[1].url])
    expect(await readFile(path)).toEqual(PAYLOAD)
  })

  it('三源全失败 → DOWNLOAD_FAILED，.part 保留供续传', async () => {
    const dest = await makeDir()
    const finalPath = join(dest, 'LibreOffice_26.8.3_Win_x86-64.msi')
    const partPath = `${finalPath}.part`
    await writeFile(partPath, 'partial')

    const err = await downloadMsi({
      destDir: dest,
      ...EXPECT,
      fetchImpl: async () => stubResponse(500, [])
    }).catch((e: unknown) => e)
    expect(err).toMatchObject({ code: 'DOWNLOAD_FAILED', detail: 'HTTP 500' })
    expect(await readFile(partPath, 'utf8')).toBe('partial')
  })

  it('重试次数封顶为 3', async () => {
    const dest = await makeDir()
    let calls = 0
    await downloadMsi({
      destDir: dest,
      ...EXPECT,
      fetchImpl: async () => {
        calls += 1
        throw new Error('net down')
      }
    }).catch(() => undefined)
    expect(calls).toBe(DOWNLOAD_RETRIES)
  })

  it('取消：清理 .part 并抛 aborted', async () => {
    const dest = await makeDir()
    const finalPath = join(dest, 'LibreOffice_26.8.3_Win_x86-64.msi')
    await writeFile(`${finalPath}.part`, 'partial')

    const err = await downloadMsi({
      destDir: dest,
      ...EXPECT,
      fetchImpl: async () => {
        const abortErr = new Error('The operation was aborted')
        abortErr.name = 'AbortError'
        throw abortErr
      }
    }).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(Error)
    expect((err as Error).message).toBe('aborted')
    await expect(stat(`${finalPath}.part`)).rejects.toThrow()
  })

  it('大小不符 → CHECKSUM_MISMATCH 且删除 .part', async () => {
    const dest = await makeDir()
    const err = await downloadMsi({
      destDir: dest,
      ...EXPECT,
      fetchImpl: async () => stubResponse(200, [Buffer.from('short')], { 'content-length': '5' })
    }).catch((e: unknown) => e)
    expect(err).toMatchObject({ code: 'CHECKSUM_MISMATCH' })
    await expect(stat(join(dest, 'LibreOffice_26.8.3_Win_x86-64.msi.part'))).rejects.toThrow()
  })

  it('哈希不符 → CHECKSUM_MISMATCH 且删除 .part', async () => {
    const dest = await makeDir()
    const err = await downloadMsi({
      destDir: dest,
      expectedSize: PAYLOAD.byteLength,
      expectedSha256: 'f'.repeat(64),
      fetchImpl: async () =>
        stubResponse(200, [PAYLOAD], { 'content-length': String(PAYLOAD.byteLength) })
    }).catch((e: unknown) => e)
    expect(err).toMatchObject({ code: 'CHECKSUM_MISMATCH', detail: sha(PAYLOAD) })
    await expect(stat(join(dest, 'LibreOffice_26.8.3_Win_x86-64.msi.part'))).rejects.toThrow()
  })

  it('既有文件哈希匹配 → 复用不发请求', async () => {
    const dest = await makeDir()
    const finalPath = join(dest, 'LibreOffice_26.8.3_Win_x86-64.msi')
    await writeFile(finalPath, PAYLOAD)
    let calls = 0
    const path = await downloadMsi({
      destDir: dest,
      ...EXPECT,
      fetchImpl: async () => {
        calls += 1
        return stubResponse(200, [])
      }
    })
    expect(path).toBe(finalPath)
    expect(calls).toBe(0)
  })

  it('既有文件哈希不符 → 删除并抛 CHECKSUM_MISMATCH', async () => {
    const dest = await makeDir()
    const finalPath = join(dest, 'LibreOffice_26.8.3_Win_x86-64.msi')
    await writeFile(finalPath, 'corrupted')
    const err = await downloadMsi({
      destDir: dest,
      ...EXPECT,
      fetchImpl: async () => stubResponse(200, [])
    }).catch((e: unknown) => e)
    expect(err).toMatchObject({ code: 'CHECKSUM_MISMATCH' })
    await expect(stat(finalPath)).rejects.toThrow()
  })

  it('进度节流：短时间多 chunk 只发少量回调', async () => {
    const dest = await makeDir()
    const chunks = Array.from({ length: 20 }, (_, index) => Uint8Array.of(index))
    const combined = Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)))
    const progress: Array<[number, number]> = []
    await downloadMsi({
      destDir: dest,
      expectedSize: 20,
      expectedSha256: sha(combined),
      onProgress: (loaded, total) => progress.push([loaded, total]),
      fetchImpl: async () => stubResponse(200, chunks, { 'content-length': '20' })
    })
    expect(progress.length).toBeLessThanOrEqual(4)
    expect(progress.at(-1)).toEqual([20, 20])
  })
})
