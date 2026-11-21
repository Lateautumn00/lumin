/**
 * @file 裁剪滤镜、九宫格锚点、输出命名与失败归类（spec §4/§5，纯函数无副作用）
 * @author cuilanchao
 * @date 2026-11-21
 * @description 比例裁剪取原图内最大同比例矩形，锚点决定位置；自由裁剪按百分比取区域
 */
import {
  buildImageEncodeArgs,
  classifyFfmpegFailure as classifyFfmpegImageFailure
} from '@lumin/node-kit'
import type { CropAnchor, CropOptions } from './schema'

/** 九宫格锚点 → 裁剪窗口在可移动范围内的比例（0 / 0.5 / 1） */
export const ANCHOR_FACTORS: Record<CropAnchor, { ax: number; ay: number }> = {
  'top-left': { ax: 0, ay: 0 },
  top: { ax: 0.5, ay: 0 },
  'top-right': { ax: 1, ay: 0 },
  left: { ax: 0, ay: 0.5 },
  center: { ax: 0.5, ay: 0.5 },
  right: { ax: 1, ay: 0.5 },
  'bottom-left': { ax: 0, ay: 1 },
  bottom: { ax: 0.5, ay: 1 },
  'bottom-right': { ax: 1, ay: 1 }
}

/**
 * 取得锚点在水平/垂直方向的偏移比例
 * @param anchor 九宫格锚点
 */
export function anchorFactors(anchor: CropAnchor): { ax: number; ay: number } {
  return ANCHOR_FACTORS[anchor]
}

/**
 * 构建 ffmpeg crop 滤镜（spec §4.1）
 * - 比例：`w=min(iw,ih*W/H)`、`h=min(ih,iw*H/W)`（最大同比例矩形），
 *   `x/y` 由 `(iw-ow)*ax`、`(ih-oh)*ay` 按锚点偏移
 * - 自由：宽高与起点均为图片尺寸的百分比
 * 注意 `min()` 内的逗号须转义为 `\,`（ffmpeg filtergraph 语法）
 * @param options zod 校验后的裁剪参数
 */
export function buildCropFilter(options: CropOptions): string {
  if (options.mode === 'free') {
    return (
      `crop=w=iw*${options.width}/100:h=ih*${options.height}/100` +
      `:x=iw*${options.x}/100:y=ih*${options.y}/100`
    )
  }
  const { ax, ay } = anchorFactors(options.anchor)
  return (
    `crop=w=min(iw\\,ih*${options.ratioW}/${options.ratioH})` +
    `:h=min(ih\\,iw*${options.ratioH}/${options.ratioW})` +
    `:x=(iw-ow)*${ax}:y=(ih-oh)*${ay}`
  )
}

/**
 * ffmpeg `-vf` 参数（裁剪必有滤镜，恒返回两项）
 * @param options zod 校验后的裁剪参数
 */
export function buildCropFilterArgs(options: CropOptions): string[] {
  return ['-vf', buildCropFilter(options)]
}

/**
 * 命名标签（spec §5）：比例 → `{W}x{H}`；自由 → `自由`
 * @param options zod 校验后的裁剪参数
 */
export function cropTag(options: CropOptions): string {
  return options.mode === 'ratio' ? `${options.ratioW}x${options.ratioH}` : '自由'
}

/**
 * 输出文件名模板（spec §5）：`{主名}_裁剪{标签}.{ext}`
 * @param args 输入文件名（取最后一个点前为主名）、裁剪参数、输出扩展名（已归一）
 */
export function buildCropOutputName(args: {
  inputName: string
  options: CropOptions
  ext: string
}): string {
  const dot = args.inputName.lastIndexOf('.')
  const stem = dot <= 0 ? args.inputName : args.inputName.slice(0, dot)
  return `${stem}_裁剪${cropTag(args.options)}.${args.ext}`
}

/**
 * 输出编码参数（保持原格式，公共实现见 `@lumin/node-kit`）
 * @param ext 归一输出扩展名
 */
export function buildEncodeArgs(ext: string): string[] {
  return buildImageEncodeArgs(ext)
}

/** ffmpeg 单张失败归类（spec §6：输出写盘失败 vs 输入损坏） */
export type CropFailure = 'IC_OUTPUT_WRITE_FAILED' | 'IC_FILE_CORRUPT'

/**
 * 按 ffmpeg stderr 归类单张失败原因（公共实现 → 本工具错误码）
 * @param stderr ffmpeg 错误输出
 * @param outputPath 本次编码的目标输出路径（用于区分输入/输出侧 open 失败）
 */
export function classifyCropFailure(stderr: string, outputPath?: string): CropFailure {
  return classifyFfmpegImageFailure(stderr, outputPath) === 'OUTPUT_WRITE_FAILED'
    ? 'IC_OUTPUT_WRITE_FAILED'
    : 'IC_FILE_CORRUPT'
}
