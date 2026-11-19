/**
 * @file batch.ts
 * @author cuilanchao
 * @date 2026-11-19
 * @description 批量转换纯函数：路径去重（Windows 大小写不敏感）、单文件失败归一化为结构化失败项、进度文案。
 */
import { basename } from 'node:path'
import { toStructuredError } from '@lumin/shared'
import type { BatchFailure } from './schema'

/**
 * 批量输入去重（保持首次出现顺序）。
 * Windows 文件系统大小写不敏感，去重键统一小写，避免同一文件重复转换。
 */
export function dedupeInputPaths(paths: string[]): string[] {
  const seen = new Set<string>()
  const result: string[] = []
  for (const path of paths) {
    const key = path.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    result.push(path)
  }
  return result
}

/**
 * 单文件失败 → 结构化失败项（供批次继续执行并汇总上报）。
 * 非结构化抛出物（如裸 Error）归一为 `INTERNAL`，不吞消息。
 */
export function toBatchFailure(inputPath: string, err: unknown): BatchFailure {
  const structured = toStructuredError(err)
  return {
    inputPath,
    code: structured.code,
    message: structured.message,
    ...(structured.detail === undefined ? {} : { detail: structured.detail })
  }
}

/** 逐文件进度文案：`2/5 转换中：报告.xlsx`（index 从 0 起） */
export function batchProgressMessage(index: number, total: number, inputPath: string): string {
  return `${index + 1}/${total} 转换中：${basename(inputPath)}`
}
