/**
 * @file ffmpeg 旋转/翻转参数与输出命名（M70 §4.48 由 image-rotate 合并，纯函数无副作用）
 * @author cuilanchao
 * @date 2026-11-25
 * @description 滤镜链（先翻转后旋转）、高保真编码参数、产物命名
 */
import { buildImageEncodeArgs } from '@lumin/node-kit'
import type { Flip, Rotation } from './schema'

/** 操作参数（schema 校验后的旋转/翻转组合） */
export interface RotateOperation {
  rotation: Rotation
  flip: Flip
}

/**
 * 构建滤镜链（顺序固定：先翻转后旋转，spec §2.6）
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
 * 输出文件名模板（spec §2.6）：`{主名}_旋转{角度}[_水平翻转|_垂直翻转].{ext}`
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
 * 输出编码参数（保持原格式，高保真固定质量；公共实现见 `@lumin/node-kit`）
 * @param ext 归一输出扩展名
 */
export function buildRotateEncodeArgs(ext: string): string[] {
  return buildImageEncodeArgs(ext)
}
