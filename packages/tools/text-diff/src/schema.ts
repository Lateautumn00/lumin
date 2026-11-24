/**
 * @file IPC schema 单源（AGENTS §6：IPC schema 归工具包，Zod 双侧校验）
 * @author cuilanchao
 * @date 2026-11-24
 * @description M62 文件比较两同步通道（pick-file / compare-files）的载荷 schema 与回包类型、
 *              200MB 文件上限与 1MB 二进制块常量（spec §4）；文本比较仍为纯 renderer 无通道。
 */
import { z } from 'zod'
import type { DiffStats, LineChange } from './diff'

/** 文件比较单文件字节上限（stat 预检，超过 → TD_FILE_TOO_LARGE，spec §4） */
export const FILE_COMPARE_MAX_BYTES = 200 * 1024 * 1024

/** 二进制模式流式比对块大小（node:crypto 1MB/块；renderer 据此换算块号，spec §4） */
export const BINARY_CHUNK_BYTES = 1024 * 1024

/** pick-file 载荷（空对象信封） */
export const pickFilePayloadSchema = z.object({})

/** compare-files 载荷（左右路径非空字符串；忽略选项可选、缺省 false） */
export const compareFilesPayloadSchema = z.object({
  left: z.string().min(1),
  right: z.string().min(1),
  ignoreWhitespace: z.boolean().default(false),
  ignoreCase: z.boolean().default(false)
})

export type CompareFilesPayload = z.infer<typeof compareFilesPayloadSchema>

/** 复制文本字符上限（unified diff 两侧各 ≤1MB，留足冗余；超过 → INVALID_INPUT） */
export const COPY_TEXT_MAX_CHARS = 4 * 1024 * 1024

/** copy-text 载荷（复制统一 diff 到系统剪贴板） */
export const copyTextPayloadSchema = z.object({
  text: z.string().min(1).max(COPY_TEXT_MAX_CHARS)
})

export type CopyTextPayload = z.infer<typeof copyTextPayloadSchema>

/** copy-text 回包 */
export interface CopyTextResult {
  ok: true
}

/** pick-file 回包（用户取消 → path 为 null） */
export interface PickFileResult {
  path: string | null
}

/** compare-files 文本模式回包（行级结果原样渲染，spec §4） */
export interface TextCompareResult {
  mode: 'text'
  changes: LineChange[]
  stats: DiffStats
  leftLabel: string
  rightLabel: string
  leftLines: string[]
  rightLines: string[]
}

/** compare-files 二进制模式回包（流式 SHA-256 逐块同位比对，内存 O(1)） */
export interface BinaryCompareResult {
  mode: 'binary'
  same: boolean
  /** 首个差异字节偏移（same 时缺省） */
  firstDiffOffset?: number
  /** 两侧较大文件的总块数 */
  totalChunks: number
}

export type CompareFilesResult = TextCompareResult | BinaryCompareResult
