/**
 * @file hash.worker.test.ts 哈希任务单测（真实临时文件）
 * @author cuilanchao
 * @date 2026-11-19
 * @description 三算法已知值、多算法一次读取、中文/空格路径、空文件、缺失/目录项逐项失败、
 *              超过 20 GB 上限、进度阶段与单调性、结果保持输入顺序、空列表由 schema 拒绝
 */
import { mkdtemp, mkdir, rm, truncate, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { TaskRunContext } from '@lumin/node-kit'
import type { TaskUpdate } from '@lumin/shared'
import { afterEach, describe, expect, it } from 'vitest'
import { describeError, hashFile, runHash } from './hash.worker'
import { MAX_FILE_BYTES, hashPayloadSchema, type HashRequest } from './schema'

/** 'abc' 的标准摘要（RFC 测试向量） */
const ABC = {
  md5: '900150983cd24fb0d6963f7d28e17f72',
  sha1: 'a9993e364706816aba3e25717850c26c9cd0d89d',
  sha256: 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'
}

/** 空文件摘要 */
const EMPTY = {
  md5: 'd41d8cd98f00b204e9800998ecf8427e',
  sha256: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'
}

let root = ''

async function tempDir(): Promise<string> {
  root = await mkdtemp(join(tmpdir(), 'lumin-fh-worker-'))
  return root
}

afterEach(async () => {
  if (root !== '') await rm(root, { recursive: true, force: true })
  root = ''
})

/** 收集进度的假任务上下文 */
function createContext(): { ctx: TaskRunContext; events: TaskUpdate[] } {
  const events: TaskUpdate[] = []
  return { ctx: { emit: (update) => events.push(update) }, events }
}

describe('hashFile', () => {
  it('单次读流同时计算三种算法（已知值）', async () => {
    const dir = await tempDir()
    const path = join(dir, 'abc.txt')
    await writeFile(path, 'abc')
    const chunks: number[] = []

    const hashes = await hashFile(path, ['md5', 'sha1', 'sha256'], (bytes) => chunks.push(bytes))

    expect(hashes).toEqual(ABC)
    expect(chunks.reduce((sum, size) => sum + size, 0)).toBe(3)
  })

  it('空文件返回空串摘要且不产生数据块', async () => {
    const dir = await tempDir()
    const path = join(dir, 'empty.txt')
    await writeFile(path, '')
    const chunks: number[] = []

    const hashes = await hashFile(path, ['md5', 'sha256'], (bytes) => chunks.push(bytes))

    expect(hashes).toEqual(EMPTY)
    expect(chunks).toEqual([])
  })

  it('读取缺失文件抛 errno（ENOENT）', async () => {
    const dir = await tempDir()
    await expect(
      hashFile(join(dir, 'missing.txt'), ['sha256'], () => undefined)
    ).rejects.toMatchObject({ code: 'ENOENT' })
  })
})

describe('runHash', () => {
  it('中文/空格路径 + 多算法 + 结果保持输入顺序', async () => {
    const dir = await tempDir()
    const first = join(dir, '文件 一.txt')
    const second = join(dir, '文件 二.txt')
    await writeFile(first, 'abc')
    await writeFile(second, 'abc')
    const { ctx } = createContext()
    const request: HashRequest = {
      paths: [first, second],
      algorithms: ['md5', 'sha256']
    }

    const done = await runHash(request, ctx, () => 1000)

    expect(done.results.map((item) => item.path)).toEqual([first, second])
    expect(done.results.every((item) => item.status === 'ok')).toBe(true)
    expect(done.results[0]?.hashes).toEqual({ md5: ABC.md5, sha256: ABC.sha256 })
    expect(done.failedCount).toBe(0)
    expect(done.totalBytes).toBe(6)
    expect(done.elapsedMs).toBe(0)
  })

  it('缺失文件与目录项逐项失败，不中断其余文件', async () => {
    const dir = await tempDir()
    const ok = join(dir, 'ok.txt')
    await writeFile(ok, 'abc')
    await mkdir(join(dir, 'folder'))
    const { ctx } = createContext()
    const missing = join(dir, 'missing.txt')
    const folder = join(dir, 'folder')

    const done = await runHash(
      { paths: [missing, ok, folder], algorithms: ['sha256'] },
      ctx
    )

    expect(done.results).toHaveLength(3)
    expect(done.results[0]).toMatchObject({ path: missing, status: 'failed', code: 'FH_FILE_INVALID' })
    expect(done.results[0]?.message).toBe('ENOENT')
    expect(done.results[1]).toMatchObject({ path: ok, status: 'ok' })
    expect(done.results[2]).toMatchObject({ path: folder, status: 'failed', code: 'FH_FILE_INVALID' })
    expect(done.failedCount).toBe(2)
    expect(done.totalBytes).toBe(3)
  })

  it('超过 20 GB 的单文件记入失败且不读取', async () => {
    const dir = await tempDir()
    const huge = join(dir, 'huge.bin')
    await writeFile(huge, '')
    await truncate(huge, MAX_FILE_BYTES + 1)
    const { ctx } = createContext()

    const done = await runHash({ paths: [huge], algorithms: ['sha256'] }, ctx)

    expect(done.results[0]).toMatchObject({
      path: huge,
      status: 'failed',
      code: 'FH_FILE_INVALID',
      message: '文件超过 20 GB 上限'
    })
    expect(done.totalBytes).toBe(0)
  })

  it('进度：先 prepare（按文件数）再 hash（按字节），字节进度单调不减', async () => {
    const dir = await tempDir()
    const a = join(dir, 'a.bin')
    const b = join(dir, 'b.bin')
    await writeFile(a, Buffer.alloc(200 * 1024, 1))
    await writeFile(b, Buffer.alloc(100 * 1024, 2))
    const { ctx, events } = createContext()

    await runHash({ paths: [a, b], algorithms: ['sha256'] }, ctx)

    const prepares = events.filter((event) => event.kind === 'progress' && event.stage === 'prepare')
    const hashes = events.filter((event) => event.kind === 'progress' && event.stage === 'hash')
    expect(prepares).toHaveLength(3)
    expect(prepares[0]).toMatchObject({ current: 0, total: 2 })
    expect(prepares[2]).toMatchObject({ current: 2, total: 2 })
    expect(hashes.length).toBeGreaterThan(3)
    expect(hashes[0]).toMatchObject({ current: 0, total: 300 * 1024 })
    const bytes = hashes.map((event) => (event.kind === 'progress' ? event.current : 0))
    for (let index = 1; index < bytes.length; index++) {
      expect(bytes[index] ?? 0).toBeGreaterThanOrEqual(bytes[index - 1] ?? 0)
    }
    expect(bytes[bytes.length - 1]).toBe(300 * 1024)
  })

  it('空列表由 schema 拒绝', () => {
    expect(hashPayloadSchema.safeParse({ paths: [], algorithms: ['sha256'] }).success).toBe(false)
  })
})

describe('describeError', () => {
  it('Error / 字符串 / 其他类型归一且截断', () => {
    expect(describeError(new Error('boom'))).toBe('boom')
    expect(describeError('text')).toBe('text')
    expect(describeError(null)).toBe('未知错误')
    expect(describeError('x'.repeat(300)).length).toBe(201)
  })
})
