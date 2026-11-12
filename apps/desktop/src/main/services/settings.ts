import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'

export interface SettingsService {
  get<T>(key: string, defaultValue: T): Promise<T>
  set<T>(key: string, value: T): Promise<void>
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

export function createSettingsService(filePath: string): SettingsService {
  let cache: Record<string, unknown> | null = null

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
    await rename(tmp, filePath)
  }

  return {
    async get<T>(key: string, defaultValue: T): Promise<T> {
      const data = await load()
      const result = readPath(data, key)
      return result.found ? (result.value as T) : defaultValue
    },
    async set<T>(key: string, value: T): Promise<void> {
      const data = await load()
      writePath(data, key, value)
      await persist(data)
    }
  }
}
