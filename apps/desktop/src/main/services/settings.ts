/**
 * @file settings 服务：树形命名空间读写的 JSON 持久化（原子写 + 并发串行 + 瞬时错误重试）
 * @author cuilanchao
 * @date 2026-11-12
 * @description 供壳与各工具 `tools.<id>.*` 隔离使用；写队列消除 Windows 并发 rename 竞态
 */
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'

export interface SettingsService {
  get<T>(key: string, defaultValue: T): Promise<T>
  set<T>(key: string, value: T): Promise<void>
}

/** rename 在 Windows 上的瞬时占用错误（EPERM/EACCES），可短重试 */
function isTransientRenameError(err: unknown): boolean {
  if (typeof err !== 'object' || err === null || !('code' in err)) return false
  const code = (err as { code?: unknown }).code
  return code === 'EPERM' || code === 'EACCES'
}

/** 可注入依赖（测试用；缺省走 fs/promises 真实 rename） */
export interface SettingsDeps {
  renameImpl?: (from: string, to: string) => Promise<void>
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function readPath(data: Record<string, unknown>, key: string): { found: boolean; value: unknown } {
  let current: unknown = data
  for (const part of key.split('.')) {
    if (!isRecord(current) || !Object.hasOwn(current, part))
      return { found: false, value: undefined }
    current = current[part]
  }
  return { found: true, value: current }
}

function writePath(data: Record<string, unknown>, key: string, value: unknown): void {
  const parts = key.split('.')
  const last = parts.pop()
  if (last === undefined || last.length === 0) throw new Error('设置键无效')
  let current: Record<string, unknown> = data
  for (const part of parts) {
    const next = current[part]
    if (isRecord(next)) {
      current = next
    } else {
      const fresh: Record<string, unknown> = {}
      current[part] = fresh
      current = fresh
    }
  }
  current[last] = value
}

export function createSettingsService(filePath: string, deps: SettingsDeps = {}): SettingsService {
  const renameImpl = deps.renameImpl ?? ((from: string, to: string) => rename(from, to))
  let cache: Record<string, unknown> | null = null
  /** 写队列：并发 set 串行化，消除同进程 rename 目标互踩（Windows EPERM，e2e R2.6 实测） */
  let writeChain: Promise<void> = Promise.resolve()

  const load = async (): Promise<Record<string, unknown>> => {
    if (cache) return cache
    try {
      const raw = await readFile(filePath, 'utf8')
      const parsed: unknown = JSON.parse(raw)
      cache = isRecord(parsed) ? parsed : {}
    } catch {
      cache = {}
    }
    return cache
  }

  const persist = async (data: Record<string, unknown>): Promise<void> => {
    const dir = dirname(filePath)
    const tmp = join(
      dir,
      `.settings-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}.tmp`
    )
    await mkdir(dir, { recursive: true })
    await writeFile(tmp, `${JSON.stringify(data, null, 2)}\n`, 'utf8')
    // rename 目标可能被杀毒/索引器瞬时占用：EPERM/EACCES 短重试（共 ~200ms）
    for (let attempt = 0; ; attempt++) {
      try {
        await renameImpl(tmp, filePath)
        return
      } catch (err) {
        if (attempt >= 4 || !isTransientRenameError(err)) throw err
        await new Promise((resolve) => setTimeout(resolve, 50))
      }
    }
  }

  return {
    async get<T>(key: string, defaultValue: T): Promise<T> {
      const data = await load()
      const result = readPath(data, key)
      return result.found ? (result.value as T) : defaultValue
    },
    async set<T>(key: string, value: T): Promise<void> {
      const run = writeChain.then(async () => {
        const data = await load()
        writePath(data, key, value)
        await persist(data)
      })
      // 失败也要让后续写入继续排队（写链不断链）；异常仍抛给本次调用方
      writeChain = run.catch(() => undefined)
      await run
    }
  }
}
