/**
 * @file 输出命名与冲突重命名（spec §6，纯函数无副作用）
 * @author cuilanchao
 * @date 2026-11-18
 * @description 模式命名模板（压缩 q{质量}/转换/缩放四模式）+ 已占用集合内的
 *              `{base} ({n}){suffix}` 自动重命名（Windows 大小写不敏感比较）
 */
import type { TargetFormat } from './schema'

/**
 * 冲突自动重命名（实现上提至 @lumin/shared，跨工具共用；保持本工具导出名）
 */
export { uniqueFileName as uniqueName } from '@lumin/shared'


/** 压缩「原格式」可直出的扩展名（jpg/jpeg 归一 jpg；gif/webp 动画路径归 webp） */
export type OutputFormat = TargetFormat | 'bmp' | 'tiff'

/** 调整效果（M40：灰度/反色/黑白二值，spec §2.4） */
export type EffectKind = 'grayscale' | 'invert' | 'binary'

/**
 * 压缩模式的输出扩展名（spec §2.1/§6）：gif「原格式」自动走 webp 动画路径；
 * jpeg 归一为 jpg；其余保持原扩展名
 * @param inputExt 输入归一扩展名（schema `SupportedExtension`）
 */
export function compressOutputExt(inputExt: string): OutputFormat {
  if (inputExt === 'gif' || inputExt === 'webp') return 'webp'
  if (inputExt === 'png') return 'png'
  if (inputExt === 'avif') return 'avif'
  if (inputExt === 'bmp') return 'bmp'
  if (inputExt === 'tiff') return 'tiff'
  return 'jpg'
}

/** 缩放命名的尺寸段（spec §6 模板） */
export type SizeTag =
  | { kind: 'percent'; percent: number }
  | { kind: 'width'; width: number }
  | { kind: 'height'; height: number }
  | { kind: 'fit'; fitWidth: number; fitHeight: number }

/**
 * 输出文件名模板（spec §6）：
 * - 压缩 `{原名}.q{质量}.{ext}` · 转换 `{原名}.{ext}`
 * - 缩放 百分比 `{原名}.{p}%.{ext}` / 宽 `.w{W}.` / 高 `.h{H}.` / 适配框 `.fit{W}x{H}.`
 * - 调整（M40）灰度 `.gray.` / 反色 `.invert.` / 黑白 `.bw{阈值}.`
 * @param args 输入文件名（含扩展名，取最后一个点前为主名）、模式、质量、尺寸段/效果、输出扩展名
 */
export function buildOutputName(args: {
  inputName: string
  mode: 'compress' | 'convert' | 'resize' | 'effect'
  quality?: number
  size?: SizeTag
  effect?: { kind: EffectKind; threshold?: number }
  ext: string
}): string {
  const dot = args.inputName.lastIndexOf('.')
  const stem = dot <= 0 ? args.inputName : args.inputName.slice(0, dot)
  if (args.mode === 'compress') {
    return `${stem}.q${args.quality ?? 75}.${args.ext}`
  }
  if (args.mode === 'convert') {
    return `${stem}.${args.ext}`
  }
  if (args.mode === 'effect') {
    const effect = args.effect
    if (effect === undefined) return `${stem}.${args.ext}`
    const tag =
      effect.kind === 'grayscale'
        ? 'gray'
        : effect.kind === 'invert'
          ? 'invert'
          : `bw${effect.threshold ?? 128}`
    return `${stem}.${tag}.${args.ext}`
  }
  const size = args.size
  if (size === undefined) return `${stem}.${args.ext}`
  const tag =
    size.kind === 'percent'
      ? `${size.percent}%`
      : size.kind === 'width'
        ? `w${size.width}`
        : size.kind === 'height'
          ? `h${size.height}`
          : `fit${size.fitWidth}x${size.fitHeight}`
  return `${stem}.${tag}.${args.ext}`
}
