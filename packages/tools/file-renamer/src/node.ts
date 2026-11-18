/**
 * @file file-renamer 主进程逻辑（纯 fs，无外部进程）
 * @author cuilanchao
 * @date 2026-11-18
 * @description scan（sync，目录文件列表）/ apply / undo（task，串行改名 + 可取消）/
 *              config / set-dir（sync，目录记忆）；批量语义：单条失败不中断（spec §5）
 */
import { readdir, rename, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { isStructuredError, makeError } from '@lumin/shared'
import type { MainPluginContext, RegisterMain, TaskHandlerContext } from '@lumin/plugin-api'
import {
  SCAN_LIMIT,
  applyPayloadSchema,
  configResultSchema,
  renameTaskResultSchema,
  scanPayloadSchema,
  scanResultSchema,
  setDirPayloadSchema,
  type ApplyPayload,
  type RenameFailure,
  type RenamePair,
  type RenameTaskResult,
  type ScanFile,
  type ScanResult
} from './schema'
import { errnoCode, toolError } from './errors'

/** 可注入依赖（单测传假件，避免真实磁盘） */
export interface FileRenamerDeps {
  readdir: typeof readdir
  stat: typeof stat
  rename: typeof rename
}

/** 默认依赖（真实 fs） */
function createDefaultDeps(): FileRenamerDeps {
  return { readdir, stat, rename }
}

/** stat 并发分批大小（避免同时打开过多句柄） */
const STAT_BATCH = 64

/**
 * 注册 file-renamer 全部通道（可注入 deps 供测试）
 * @param ctx 主进程插件上下文
 * @param deps 可注入依赖
 */
export function registerWith(ctx: MainPluginContext, deps: FileRenamerDeps): void {
  // —— scan（sync）：目录内普通文件列表（不递归，超限截断） ——
  ctx.registerIpc('scan', async ({ payload }) => {
    const parsed = scanPayloadSchema.safeParse(payload)
    if (!parsed.success) throw makeError('INVALID_PAYLOAD', '参数无效')
    return scanDir(parsed.data.dir, deps)
  })

  // —— config（sync）：上次使用的目录 ——
  ctx.registerIpc('config', async () => {
    const lastDir = await ctx.settings.get<string | null>('lastDir', null)
    return configResultSchema.parse({ lastDir })
  })

  // —— set-dir（sync）：目录记忆 ——
  ctx.registerIpc('set-dir', async ({ payload }) => {
    const parsed = setDirPayloadSchema.safeParse(payload)
    if (!parsed.success) throw makeError('INVALID_PAYLOAD', '参数无效')
    await ctx.settings.set('lastDir', parsed.data.dir)
  })

  // —— apply / undo（task）：同一算法，undo 由 renderer 传反向 pairs ——
  ctx.registerTask<ApplyPayload, RenameTaskResult>('apply', async (taskCtx) => {
    try {
      return await runPairTask(taskCtx, deps)
    } catch (err) {
      if (isStructuredError(err)) throw err
      throw toolError('FR_RENAME_FAILED', err instanceof Error ? err.message : '')
    }
  })
  ctx.registerTask<ApplyPayload, RenameTaskResult>('undo', async (taskCtx) => {
    try {
      return await runPairTask(taskCtx, deps)
    } catch (err) {
      if (isStructuredError(err)) throw err
      throw toolError('FR_RENAME_FAILED', err instanceof Error ? err.message : '')
    }
  })

  ctx.log.info('file-renamer registered')
}

/**
 * 扫描目录：仅普通文件（忽略目录与符号链接），按名称排序，超 5000 条截断
 * @param dir 目标目录绝对路径
 * @param deps 依赖
 */
async function scanDir(dir: string, deps: FileRenamerDeps): Promise<ScanResult> {
  let dirents
  try {
    dirents = await deps.readdir(dir, { withFileTypes: true })
  } catch (err) {
    throw toolError('FR_DIR_NOT_FOUND', errnoCode(err))
  }
  const names = dirents
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name)
    .sort((a, b) => a.localeCompare(b))
  const truncated = names.length > SCAN_LIMIT
  const target = truncated ? names.slice(0, SCAN_LIMIT) : names

  const files: ScanFile[] = []
  for (let index = 0; index < target.length; index += STAT_BATCH) {
    const chunk = target.slice(index, index + STAT_BATCH)
    const stats = await Promise.all(
      chunk.map(async (name) => {
        try {
          const info = await deps.stat(join(dir, name))
          return { name, size: info.size, mtimeMs: info.mtimeMs }
        } catch {
          // 读取瞬间被删除/占用：跳过该条，不阻塞整表
          return null
        }
      })
    )
    for (const item of stats) if (item !== null) files.push(item)
  }
  return scanResultSchema.parse({ files, truncated })
}

/**
 * 执行一批改名：逐条 rename，目标占用判冲突，单条失败不中断，取消即停
 * @param taskCtx 任务上下文（payload 已 zod 校验）
 * @param deps 依赖
 */
async function runPairTask(
  taskCtx: TaskHandlerContext<ApplyPayload>,
  deps: FileRenamerDeps
): Promise<RenameTaskResult> {
  const parsed = applyPayloadSchema.safeParse(taskCtx.payload)
  if (!parsed.success) throw makeError('INVALID_PAYLOAD', '参数无效')
  const { dir, pairs } = parsed.data

  let existing: string[]
  try {
    existing = await deps.readdir(dir)
  } catch (err) {
    throw toolError('FR_DIR_NOT_FOUND', errnoCode(err))
  }
  /** 开始时目录已占用的名字（lowercase；含本批来源，故 A→B 且 B 存在即冲突） */
  const initialOccupied = new Set(existing.map((name) => name.toLowerCase()))
  const seenTargets = new Set<string>()

  const renamed: RenamePair[] = []
  const failures: RenameFailure[] = []
  const total = pairs.length

  for (const [index, pair] of pairs.entries()) {
    if (taskCtx.signal.aborted) break
    taskCtx.emit({ kind: 'progress', current: index, total, message: pair.from })
    const fromKey = pair.from.toLowerCase()
    const targetKey = pair.to.toLowerCase()
    const caseOnlyChange = targetKey === fromKey
    if (!caseOnlyChange && (seenTargets.has(targetKey) || initialOccupied.has(targetKey))) {
      failures.push({
        from: pair.from,
        code: 'FR_CONFLICT',
        message: '目标名已存在或与其它文件重复'
      })
      continue
    }
    try {
      await deps.rename(join(dir, pair.from), join(dir, pair.to))
      renamed.push(pair)
      seenTargets.add(targetKey)
    } catch (err) {
      failures.push({
        from: pair.from,
        code: 'FR_RENAME_FAILED',
        message: errnoCode(err) || '重命名失败'
      })
    }
  }
  taskCtx.emit({ kind: 'progress', current: total, total, message: '' })
  return renameTaskResultSchema.parse({ renamed, failures })
}

/** 生产注册入口（壳 tool-mains.ts 调用；测试用 registerWith 注入假 deps） */
export const registerMain: RegisterMain = (ctx) => registerWith(ctx, createDefaultDeps())
