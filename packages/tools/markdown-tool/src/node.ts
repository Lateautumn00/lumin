/**
 * @file markdown-tool 主进程逻辑（config / set-output-dir / save）
 * @author cuilanchao
 * @date 2026-11-21
 * @description 无三段式任务：Markdown / JSON→TS / YAML 全在 renderer 同步完成；
 *              主进程仅做输出目录记忆与 UTF-8 原子写盘（spec §5）
 */
import { existsSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { resolveConflictPath, writeAtomic, type AtomicFs } from '@lumin/node-kit'
import { makeError } from '@lumin/shared'
import type { MainPluginContext, RegisterMain } from '@lumin/plugin-api'
import {
  configResultSchema,
  savePayloadSchema,
  saveResultSchema,
  setOutputDirPayloadSchema
} from './schema'
import { errnoCode, toolError } from './errors'
import { sanitizeBaseName } from './save'

/** 可注入依赖（单测传假 fs / exists） */
export interface MarkdownToolDeps {
  /** 原子写盘 fs 子集 */
  fs?: AtomicFs
  /** 冲突判定（默认 fs.existsSync） */
  exists?: (path: string) => boolean
}

/**
 * 注册 markdown-tool 全部通道（可注入依赖供测试）
 * @param ctx 主进程插件上下文（paths/settings/log/registerIpc）
 * @param deps 可注入依赖
 */
export function registerWith(ctx: MainPluginContext, deps: MarkdownToolDeps = {}): void {
  const defaultOutputDir = join(ctx.paths.userData, 'markdown')
  const exists = deps.exists ?? existsSync

  // —— config（sync）：输出目录记忆回填（settings `outputDir`） ——
  ctx.registerIpc('config', async () => {
    const saved = await ctx.settings.get<string | null>('outputDir', null)
    return configResultSchema.parse({ outputDir: saved ?? defaultOutputDir })
  })

  // —— set-output-dir（sync）：目录选择后即时记忆 ——
  ctx.registerIpc('set-output-dir', async ({ payload }) => {
    const parsed = setOutputDirPayloadSchema.safeParse(payload)
    if (!parsed.success) throw makeError('INVALID_PAYLOAD', '参数无效')
    await ctx.settings.set('outputDir', parsed.data.outputDir)
  })

  // —— save（sync）：校验 → 清洗 → 冲突命名 → 原子写盘 → 记忆目录 ——
  ctx.registerIpc('save', async ({ payload }) => {
    const parsed = savePayloadSchema.safeParse(payload)
    if (!parsed.success) throw makeError('INVALID_PAYLOAD', '参数无效')
    const { outputDir, baseName, extension, content } = parsed.data

    try {
      mkdirSync(outputDir, { recursive: true })
    } catch (err) {
      throw toolError('MD_SAVE_FAILED', errnoCode(err))
    }

    const desired = join(outputDir, `${sanitizeBaseName(baseName)}.${extension}`)
    const target = resolveConflictPath(desired, exists)
    if (target === null) throw toolError('MD_SAVE_FAILED', '同名文件过多（超过 99 个）')

    try {
      writeAtomic(target, content, deps.fs)
    } catch (err) {
      throw toolError('MD_SAVE_FAILED', errnoCode(err))
    }

    await ctx.settings.set('outputDir', outputDir)
    return saveResultSchema.parse({ output: target })
  })

  ctx.log.info('markdown-tool registered', { defaultOutputDir })
}

/** 壳注册入口（plugin-host 调用） */
export const registerMain: RegisterMain = (ctx) => {
  registerWith(ctx)
}
