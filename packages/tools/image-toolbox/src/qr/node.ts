/**
 * @file qr-code 主进程逻辑（config / set-output-dir / save）
 * @author cuilanchao
 * @date 2026-11-19
 * @description 无三段式任务：生成与识别都在 renderer，主进程只做输出目录记忆与原子写盘；
 *              save 走 zod 校验 → 文件名清洗 → 冲突递增命名 → 临时文件 + rename（spec §6.5）
 */
import { existsSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { resolveConflictPath } from '@lumin/node-kit'
import { makeError } from '@lumin/shared'
import type { MainPluginContext, RegisterMain } from '@lumin/plugin-api'
import {
  configResultSchema,
  savePayloadSchema,
  saveResultSchema,
  setOutputDirPayloadSchema
} from './schema'
import { errnoCode, toolError } from './errors'
import { normalizePngBase64, sanitizeBaseName, writeAtomic, type AtomicFs } from './save'

/** 可注入依赖（单测传假 fs / exists，不触碰真实冲突上限） */
export interface QrCodeDeps {
  /** 原子写盘 fs 子集 */
  fs?: AtomicFs
  /** 冲突判定（默认 fs.existsSync） */
  exists?: (path: string) => boolean
}

/**
 * 校验并归一 SVG 文本
 * @param data 原始 SVG 文本
 */
function normalizeSvg(data: string): string {
  const trimmed = data.trim()
  if (!trimmed.startsWith('<svg') && !trimmed.startsWith('<?xml')) {
    throw toolError('QR_INVALID_PAYLOAD', 'SVG 数据无效')
  }
  return trimmed
}

/**
 * 注册 qr-code 全部通道（工具注册入口，可注入依赖供测试）
 * @param ctx 主进程插件上下文（paths/settings/log/registerIpc）
 * @param deps 可注入依赖
 */
export function registerWith(ctx: MainPluginContext, deps: QrCodeDeps = {}): void {
  const defaultOutputDir = join(ctx.paths.userData, 'qrcodes')
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
    const { outputDir, baseName, format, data } = parsed.data

    try {
      mkdirSync(outputDir, { recursive: true })
    } catch (err) {
      throw toolError('QR_OUTPUT_WRITE_FAILED', errnoCode(err))
    }

    const desired = join(outputDir, `${sanitizeBaseName(baseName)}.${format}`)
    const target = resolveConflictPath(desired, exists)
    if (target === null) throw toolError('QR_OUTPUT_WRITE_FAILED', '同名文件过多（超过 99 个）')

    const bytes =
      format === 'png' ? Buffer.from(normalizePngBase64(data), 'base64') : normalizeSvg(data)
    try {
      writeAtomic(target, bytes, deps.fs)
    } catch (err) {
      throw toolError('QR_OUTPUT_WRITE_FAILED', errnoCode(err))
    }

    await ctx.settings.set('outputDir', outputDir)
    return saveResultSchema.parse({ output: target })
  })

  ctx.log.info('qr-code registered', { defaultOutputDir })
}

/** 壳注册入口（plugin-host 调用） */
export const registerMain: RegisterMain = (ctx) => {
  registerWith(ctx)
}
