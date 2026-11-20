/**
 * @file ffmpeg 旋转/翻转参数与输出命名（spec §4/§5，纯函数无副作用）
 * @author cuilanchao
 * @date 2026-11-20
 * @description 滤镜链（先翻转后旋转）、编码参数、产物命名与单张失败归类
 */
import type { Flip, Rotation } from './schema'

/** 操作参数（schema 校验后的旋转/翻转组合） */
export interface RotateOperation {
  rotation: Rotation
  flip: Flip
}

/**
 * 构建滤镜链（顺序固定：先翻转后旋转；spec §4）
 * - 水平翻转 `hflip` / 垂直翻转 `vflip`
 * - 90° `transpose=1`（顺时针）/ 180° `transpose=1,transpose=1` / 270° `transpose=2`
 * @param options 旋转与翻转组合
 * @returns 滤镜名列表；空操作 → []
 */
export function buildFilterChain(options: RotateOperation): string[] {
  const filters: string[] = []
  if (options.flip === 'horizontal') filters.push('hflip')
  if (options.flip === 'vertical') filters.push('vflip')
  if (options.rotation === '90') filters.push('transpose=1')
  if (options.rotation === '180') filters.push('transpose=1', 'transpose=1')
  if (options.rotation === '270') filters.push('transpose=2')
  return filters
}

/**
 * ffmpeg `-vf` 参数（无操作返回空数组，便于拼接）
 * @param options 旋转与翻转组合
 */
export function buildFilterArgs(options: RotateOperation): string[] {
  const chain = buildFilterChain(options)
  return chain.length === 0 ? [] : ['-vf', chain.join(',')]
}

/**
 * 输出文件名模板（spec §5）：`{主名}_旋转{角度}[_水平翻转|_垂直翻转].{ext}`
 * @param args 输入文件名（含扩展名，取最后一个点前为主名）、操作组合、输出扩展名（已归一）
 */
export function buildRotateOutputName(args: {
  inputName: string
  rotation: Rotation
  flip: Flip
  ext: string
}): string {
  const dot = args.inputName.lastIndexOf('.')
  const stem = dot <= 0 ? args.inputName : args.inputName.slice(0, dot)
  const parts = [stem]
  if (args.rotation !== 'none') parts.push(`旋转${args.rotation}`)
  if (args.flip === 'horizontal') parts.push('水平翻转')
  if (args.flip === 'vertical') parts.push('垂直翻转')
  return `${parts.join('_')}.${args.ext}`
}

/**
 * 输出编码参数（保持原格式，质量固定高保真；spec §4）
 * @param ext 归一输出扩展名
 */
export function buildEncodeArgs(ext: string): string[] {
  if (ext === 'jpg') return ['-q:v', '2']
  if (ext === 'webp') return ['-quality', '92']
  if (ext === 'png') return ['-compression_level', '6']
  // bmp/tiff 无质量参数
  return []
}

/** ffmpeg 单张失败归类（spec §6：磁盘满/权限/输出打开失败 vs 输入损坏） */
export type FfmpegFailure = 'IR_OUTPUT_WRITE_FAILED' | 'IR_FILE_CORRUPT'

/**
 * 按 ffmpeg stderr 归类单张失败原因
 * @param stderr ffmpeg 错误输出
 * @param outputPath 本次编码的目标输出路径（用于区分输入/输出侧 open 失败）
 */
export function classifyFfmpegFailure(stderr: string, outputPath?: string): FfmpegFailure {
  if (/no space left on device/i.test(stderr)) return 'IR_OUTPUT_WRITE_FAILED'
  if (/permission denied|access is denied/i.test(stderr)) return 'IR_OUTPUT_WRITE_FAILED'
  if (outputPath !== undefined) {
    // Windows deny-ACL 实测：无 Permission denied 字样，仅「Could not open file : <输出路径>」
    const escaped = outputPath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    if (new RegExp(`could not open file[^\\n]*${escaped}`, 'i').test(stderr)) {
      return 'IR_OUTPUT_WRITE_FAILED'
    }
    if (/error muxing a packet|error submitting a packet/i.test(stderr)) {
      return 'IR_OUTPUT_WRITE_FAILED'
    }
  }
  return 'IR_FILE_CORRUPT'
}
