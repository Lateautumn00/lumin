import type { MainPluginContext } from '@lumin/plugin-api'
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { describe, expect, it, vi } from 'vitest'
import { UNSUPPORTED_HINT } from './formats'
import { classifyStatError, createNodeDeps, registerMain, registerWith } from './node'
import type { ResolveResult } from './schema'

type IpcHandler = (args: { payload: unknown }) => Promise<unknown>

interface Harness {
  ctx: MainPluginContext
  ipc: Map<string, IpcHandler>
}

function makeCtx(): Harness {
  const ipc = new Map<string, IpcHandler>()
  const ctx = {
    toolId: 'video-player',
    manifest: { id: 'video-player' },
    registerIpc: (action: string, handler: IpcHandler) => {
      ipc.set(action, handler)
    },
    log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }
  } as unknown as MainPluginContext
  return { ctx, ipc }
}

function getIpc(harness: Harness): IpcHandler {
  const handler = harness.ipc.get('resolve')
  if (handler === undefined) throw new Error('ipc resolve 未注册')
  return handler
}

function errnoError(code: string): NodeJS.ErrnoException {
  return Object.assign(new Error(code), { code })
}

async function tempDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'lumin-vp-'))
}

describe('registerWith resolve', () => {
  it('合法 mp4 → file:// URL + 元信息', async () => {
    const dir = await tempDir()
    const file = join(dir, '剪辑 片段.mp4')
    await writeFile(file, Buffer.from('fake-mp4'))
    const harness = makeCtx()
    registerWith(harness.ctx, createNodeDeps())
    const result = (await getIpc(harness)({ payload: { path: file } })) as ResolveResult
    expect(result).toEqual({
      url: pathToFileURL(file).href,
      name: '剪辑 片段.mp4',
      size: 8,
      mime: 'video/mp4'
    })
    expect(decodeURIComponent(result.url)).toContain('剪辑 片段.mp4')
  })

  it('路径含空格/# 时 URL 正确转义', async () => {
    const dir = await tempDir()
    const file = join(dir, '视频 #1.webm')
    await writeFile(file, Buffer.from('x'))
    const harness = makeCtx()
    registerWith(harness.ctx, createNodeDeps())
    const result = (await getIpc(harness)({ payload: { path: file } })) as ResolveResult
    expect(result.url).toContain('%20')
    expect(result.url).toContain('%23')
    expect(result.mime).toBe('video/webm')
  })

  it('不支持格式 → VP_UNSUPPORTED_FORMAT（detail 为提示）', async () => {
    const harness = makeCtx()
    registerWith(harness.ctx, {
      stat: async () => ({ size: 1, isFile: () => true }),
      toFileUrl: (path) => path
    })
    await expect(getIpc(harness)({ payload: { path: 'C:\\a.mkv' } })).rejects.toMatchObject({
      code: 'VP_UNSUPPORTED_FORMAT',
      detail: UNSUPPORTED_HINT
    })
  })

  it('文件不存在 → VP_NOT_FOUND', async () => {
    const dir = await tempDir()
    const harness = makeCtx()
    registerWith(harness.ctx, createNodeDeps())
    await expect(
      getIpc(harness)({ payload: { path: join(dir, '缺失.mp4') } })
    ).rejects.toMatchObject({ code: 'VP_NOT_FOUND', detail: 'ENOENT' })
  })

  it('目录（.mp4 结尾）→ VP_RESOLVE_FAILED', async () => {
    const dir = await tempDir()
    const fakeDir = join(dir, '伪装.mp4')
    await mkdir(fakeDir)
    const harness = makeCtx()
    registerWith(harness.ctx, createNodeDeps())
    await expect(getIpc(harness)({ payload: { path: fakeDir } })).rejects.toMatchObject({
      code: 'VP_RESOLVE_FAILED',
      detail: '不是文件'
    })
  })

  it('stat 失败（非 ENOENT）→ VP_RESOLVE_FAILED', async () => {
    const harness = makeCtx()
    registerWith(harness.ctx, {
      stat: async () => {
        throw errnoError('EACCES')
      },
      toFileUrl: (path) => path
    })
    await expect(getIpc(harness)({ payload: { path: 'C:\\a.mp4' } })).rejects.toMatchObject({
      code: 'VP_RESOLVE_FAILED',
      detail: 'EACCES'
    })
  })

  it('URL 生成失败 → VP_RESOLVE_FAILED', async () => {
    const harness = makeCtx()
    registerWith(harness.ctx, {
      stat: async () => ({ size: 1, isFile: () => true }),
      toFileUrl: () => {
        throw new Error('boom')
      }
    })
    await expect(getIpc(harness)({ payload: { path: 'C:\\a.mp4' } })).rejects.toMatchObject({
      code: 'VP_RESOLVE_FAILED',
      detail: 'Error: boom'
    })
  })

  it('入参非法 → INVALID_PAYLOAD', async () => {
    const harness = makeCtx()
    registerWith(harness.ctx, createNodeDeps())
    await expect(getIpc(harness)({ payload: { path: '' } })).rejects.toMatchObject({
      code: 'INVALID_PAYLOAD'
    })
  })
})

describe('classifyStatError', () => {
  it('ENOENT → VP_NOT_FOUND，其余 → VP_RESOLVE_FAILED', () => {
    expect(classifyStatError(errnoError('ENOENT'))).toMatchObject({ code: 'VP_NOT_FOUND' })
    expect(classifyStatError(errnoError('EPERM'))).toMatchObject({
      code: 'VP_RESOLVE_FAILED',
      detail: 'EPERM'
    })
    expect(classifyStatError(new Error('boom'))).toMatchObject({
      code: 'VP_RESOLVE_FAILED',
      detail: 'Error: boom'
    })
  })
})

describe('registerMain', () => {
  it('注册 resolve 通道', () => {
    const harness = makeCtx()
    registerMain(harness.ctx)
    expect(harness.ipc.has('resolve')).toBe(true)
  })
})
