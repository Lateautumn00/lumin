import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { TaskCrashError, TaskTimeoutError, type RunTaskOptions } from '@lumin/node-kit'
import type { IpcHandler, MainPluginContext, TaskHandler } from '@lumin/plugin-api'
import type { TaskUpdate } from '@lumin/shared'
import { manifest } from './manifest'
import {
  createNodeDeps,
  type ExamSplitDeps,
  mapWorkerError,
  OP_TIMEOUT_MS,
  registerMain,
  registerWith
} from './node'
import type { OpResult, WorkerRequest } from './pdf-ops'

interface Harness {
  tasks: Map<string, TaskHandler<unknown, unknown>>
  calls: RunTaskOptions<WorkerRequest>[]
  updates: TaskUpdate[]
}

const roots: string[] = []

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function createCtx(
  root: string,
  tasks: Map<string, TaskHandler<unknown, unknown>>
): MainPluginContext {
  return {
    toolId: manifest.id,
    manifest,
    registerIpc: <P, R>(_action: string, _handler: IpcHandler<P, R>): void => undefined,
    registerTask: <P, R>(action: string, handler: TaskHandler<P, R>): void => {
      tasks.set(action, handler as unknown as TaskHandler<unknown, unknown>)
    },
    settings: {
      get: async <T>(_key: string, defaultValue: T): Promise<T> => defaultValue,
      set: async () => undefined
    },
    log: {
      debug: () => undefined,
      info: () => undefined,
      warn: () => undefined,
      error: () => undefined
    },
    paths: { temp: join(root, 'temp'), userData: join(root, 'userData') }
  }
}

function createHarness(overrides: Partial<ExamSplitDeps> = {}): Harness {
  const root = mkdtempSync(join(tmpdir(), 'lumin-exam-node-'))
  roots.push(root)
  const tasks = new Map<string, TaskHandler<unknown, unknown>>()
  const calls: RunTaskOptions<WorkerRequest>[] = []
  const updates: TaskUpdate[] = []
  const ctx = createCtx(root, tasks)
  const deps: ExamSplitDeps = {
    workerPath: 'fake-worker.js',
    checkReadable: async () => undefined,
    checkExclusive: async () => undefined,
    run: async (options) => {
      calls.push(options)
      options.onUpdate?.({ kind: 'progress', stage: 'load', current: 1, total: 1 })
      return { outputPaths: ['out.pdf'] } satisfies OpResult
    },
    ...overrides
  }
  registerWith(ctx, deps)
  return { tasks, calls, updates }
}

async function runTask(
  harness: Harness,
  action: string,
  payload: unknown
): Promise<{ result?: unknown; error?: unknown }> {
  const handler = harness.tasks.get(action)
  if (handler === undefined) throw new Error(`缺少 task：${action}`)
  try {
    const result = await handler({
      toolId: manifest.id,
      action,
      payload,
      taskId: 'task-1',
      signal: new AbortController().signal,
      emit: (update) => harness.updates.push(update)
    })
    return { result }
  } catch (err) {
    return { error: err }
  }
}

function makeInput(root: string, name = '卷.pdf'): string {
  const path = join(root, name)
  writeFileSync(path, '%PDF-1.7 fake')
  return path
}

describe('registerWith 五通道（spec §2 任务表）', () => {
  it('注册 split/merge/delete/rotate/crop 五个任务', () => {
    const harness = createHarness()
    expect([...harness.tasks.keys()].sort()).toEqual(['crop', 'delete', 'merge', 'rotate', 'split'])
  })

  it('split：合法入参 → 校验+预检+转发 worker，进度透传', async () => {
    const harness = createHarness()
    const root = roots[0]!
    const input = makeInput(root)
    const { result, error } = await runTask(harness, 'split', { inputPath: input, ranges: '1' })
    expect(error).toBeUndefined()
    expect(result).toEqual({ outputPaths: ['out.pdf'] })
    expect(harness.calls).toHaveLength(1)
    const options = harness.calls[0]!
    expect(options.workerPath).toBe('fake-worker.js')
    expect(options.timeoutMs).toBe(OP_TIMEOUT_MS)
    expect(options.payload).toEqual({ op: 'split', payload: { inputPath: input, ranges: '1' } })
    expect(harness.updates[0]).toMatchObject({ stage: 'load' })
  })

  it('merge：多文件入参按 inputPaths 转发', async () => {
    const harness = createHarness()
    const root = roots[0]!
    const a = makeInput(root, 'a.pdf')
    const b = makeInput(root, 'b.pdf')
    const { error } = await runTask(harness, 'merge', { inputPaths: [a, b] })
    expect(error).toBeUndefined()
    expect(harness.calls[0]?.payload).toMatchObject({ op: 'merge' })
  })

  it('rotate：degrees 必填且仅 90/180/270', async () => {
    const harness = createHarness()
    const input = makeInput(roots[0]!)
    const bad = await runTask(harness, 'rotate', { inputPath: input, degrees: 45 })
    expect(bad.error).toMatchObject({ code: 'INVALID_PAYLOAD' })
    const good = await runTask(harness, 'rotate', { inputPath: input, degrees: 180 })
    expect(good.error).toBeUndefined()
  })

  it('crop：box 越界 → INVALID_PAYLOAD，且不触碰预检', async () => {
    const prechecked: string[] = []
    const harness = createHarness({
      checkReadable: async (path) => {
        prechecked.push(path)
      }
    })
    const input = makeInput(roots[0]!)
    const { error } = await runTask(harness, 'crop', {
      inputPath: input,
      box: { x: 0.8, y: 0.1, width: 0.5, height: 0.5 }
    })
    expect(error).toMatchObject({ code: 'INVALID_PAYLOAD' })
    expect(prechecked).toHaveLength(0)
    expect(harness.calls).toHaveLength(0)
  })

  it('delete/crop：合法入参 → 校验+预检+转发 worker', async () => {
    const harness = createHarness()
    const input = makeInput(roots[0]!)
    const deleted = await runTask(harness, 'delete', { inputPath: input, ranges: '1' })
    expect(deleted.error).toBeUndefined()
    expect(harness.calls[0]?.payload).toMatchObject({ op: 'delete' })

    const cropped = await runTask(harness, 'crop', {
      inputPath: input,
      box: { x: 0, y: 0, width: 1, height: 1 }
    })
    expect(cropped.error).toBeUndefined()
    expect(harness.calls[1]?.payload).toMatchObject({ op: 'crop' })
  })

  it('非法入参 → INVALID_PAYLOAD（zod 拒绝，不进 worker）', async () => {
    const harness = createHarness()
    const { error } = await runTask(harness, 'split', { inputPath: 'a.docx', ranges: '1' })
    expect(error).toMatchObject({ code: 'INVALID_PAYLOAD' })
    expect(harness.calls).toHaveLength(0)
  })

  it('预检：不可读 → PDF_NOT_FOUND；被独占 → PDF_LOCKED（spec §5）', async () => {
    const enoent = Object.assign(new Error('ENOENT: no such file'), { code: 'ENOENT' })
    const missing = createHarness({ checkReadable: async () => Promise.reject(enoent) })
    const notFound = await runTask(missing, 'split', { inputPath: 'x.pdf', ranges: '1' })
    expect(notFound.error).toMatchObject({ code: 'PDF_NOT_FOUND', detail: 'ENOENT' })

    const busy = Object.assign(new Error('EBUSY: resource busy'), { code: 'EBUSY' })
    const locked = createHarness({ checkExclusive: async () => Promise.reject(busy) })
    const lockedResult = await runTask(locked, 'split', { inputPath: 'x.pdf', ranges: '1' })
    expect(lockedResult.error).toMatchObject({ code: 'PDF_LOCKED', detail: 'EBUSY' })
  })

  it('merge 预检逐个检查，任一失败即中止', async () => {
    const checked: string[] = []
    const enoent = Object.assign(new Error('ENOENT'), { code: 'ENOENT' })
    const harness = createHarness({
      checkReadable: async (path) => {
        checked.push(path)
        if (path.endsWith('b.pdf')) throw enoent
      }
    })
    const root = roots[0]!
    const { error } = await runTask(harness, 'merge', {
      inputPaths: [makeInput(root, 'a.pdf'), join(root, 'b.pdf')]
    })
    expect(error).toMatchObject({ code: 'PDF_NOT_FOUND' })
    expect(checked).toHaveLength(2)
    expect(harness.calls).toHaveLength(0)
  })

  it('run 抛结构化错误 → 原样透传（worker 内 PDF_ENCRYPTED 等）', async () => {
    const structured = { code: 'PDF_ENCRYPTED', message: 'PDF 已加密' }
    const harness = createHarness({
      run: async () => Promise.reject(structured)
    })
    const { error } = await runTask(harness, 'split', {
      inputPath: makeInput(roots[0]!),
      ranges: '1'
    })
    expect(error).toBe(structured)
  })
})

describe('mapWorkerError（spec §4/§5）', () => {
  it('超时 → OP_TIMEOUT', () => {
    expect(mapWorkerError(new TaskTimeoutError(120_000))).toEqual({
      code: 'OP_TIMEOUT',
      message: '处理超时（120 秒），已终止'
    })
  })

  it('崩溃 → OP_FAILED，detail 取 cause 尾部', () => {
    const err = mapWorkerError(
      new TaskCrashError('worker exited', new Error('x'.repeat(400) + 'boom-tail'))
    )
    expect(err).toMatchObject({ code: 'OP_FAILED' })
    expect((err as { detail?: string }).detail?.endsWith('boom-tail')).toBe(true)
    expect(((err as { detail?: string }).detail ?? '').length).toBeLessThanOrEqual(2001)
  })

  it('结构化错误原样返回', () => {
    const structured = { code: 'PDF_INVALID', message: '坏文件' }
    expect(mapWorkerError(structured)).toBe(structured)
  })
})

describe('createNodeDeps（生产实现）', () => {
  it('checkReadable：存在可读通过，缺失拒绝', async () => {
    const deps = createNodeDeps()
    const path = join(roots[0] ?? mkdtempSync(join(tmpdir(), 'lumin-exam-dep-')), 'ok.pdf')
    if (roots[0] === undefined) roots.push(path)
    writeFileSync(path, 'x')
    await expect(deps.checkReadable(path)).resolves.toBeUndefined()
    await expect(deps.checkReadable(join(path, 'nope.pdf'))).rejects.toMatchObject({
      code: 'ENOENT'
    })
  })

  it('checkExclusive：正常文件可打开关闭', async () => {
    const deps = createNodeDeps()
    const root = mkdtempSync(join(tmpdir(), 'lumin-exam-ex-'))
    roots.push(root)
    const path = join(root, 'a.pdf')
    writeFileSync(path, 'x')
    await expect(deps.checkExclusive(path)).resolves.toBeUndefined()
  })

  it('run：转发 runTask（fixture worker 协议回 done）', async () => {
    const deps = createNodeDeps()
    const workerPath = fileURLToPath(
      new URL('../../../node-kit/fixtures/worker-protocol.mjs', import.meta.url)
    )
    const result = await deps.run({
      workerPath,
      payload: { op: 'split', payload: { inputPath: 'a.pdf', ranges: '1' } },
      timeoutMs: 10_000
    })
    expect(result).toBeNull()
  })
})

describe('registerMain（生产入口）', () => {
  it('组装生产 deps 并注册五通道', () => {
    const root = mkdtempSync(join(tmpdir(), 'lumin-exam-reg-'))
    roots.push(root)
    const tasks = new Map<string, TaskHandler<unknown, unknown>>()
    registerMain(createCtx(root, tasks))
    expect([...tasks.keys()].sort()).toEqual(['crop', 'delete', 'merge', 'rotate', 'split'])
  })
})
