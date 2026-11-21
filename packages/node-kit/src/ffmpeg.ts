/**
 * @file ffmpeg.ts 图片类 ffmpeg 公共参数与失败归类（纯函数，多工具共用）
 * @author cuilanchao
 * @date 2026-11-21
 * @description 输出编码参数与单张编码失败语义；工具侧按各自错误码映射
 */

/** 图片编码失败的公共语义（工具侧再映射为自身错误码） */
export type FfmpegImageFailure = 'FILE_CORRUPT' | 'OUTPUT_WRITE_FAILED'

/**
 * 输出编码参数（保持原格式，质量固定高保真）
 * @param ext 归一输出扩展名（jpg/jpeg 视作 jpg）
 */
export function buildImageEncodeArgs(ext: string): string[] {
  if (ext === 'jpg' || ext === 'jpeg') return ['-q:v', '2']
  if (ext === 'webp') return ['-quality', '92']
  if (ext === 'png') return ['-compression_level', '6']
  // bmp/tiff 无质量参数
  return []
}

/**
 * 按 ffmpeg stderr 归类单张失败原因
 * @param stderr ffmpeg 错误输出
 * @param outputPath 本次编码的目标输出路径（用于区分输入/输出侧 open 失败）
 */
export function classifyFfmpegFailure(
  stderr: string,
  outputPath?: string
): FfmpegImageFailure {
  if (/no space left on device/i.test(stderr)) return 'OUTPUT_WRITE_FAILED'
  if (/permission denied|access is denied/i.test(stderr)) return 'OUTPUT_WRITE_FAILED'
  if (outputPath !== undefined) {
    // Windows deny-ACL 实测：无 Permission denied 字样，仅「Could not open file : <输出路径>」
    const escaped = outputPath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    if (new RegExp(`could not open file[^\\n]*${escaped}`, 'i').test(stderr)) {
      return 'OUTPUT_WRITE_FAILED'
    }
    if (/error muxing a packet|error submitting a packet/i.test(stderr)) {
      return 'OUTPUT_WRITE_FAILED'
    }
  }
  return 'FILE_CORRUPT'
}
