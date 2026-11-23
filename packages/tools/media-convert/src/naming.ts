/**
 * @file 输出命名（spec §6，纯函数无副作用）
 * @author cuilanchao
 * @date 2026-11-19
 * @description 四模式命名模板 + 冲突重命名委托 `@lumin/shared`
 */
import type { QualityLevel } from './schema'
import { formatTimeTag } from './media'

/**
 * 冲突自动重命名（实现上提至 @lumin/shared，跨工具共用；保持本工具导出名）
 */
export { uniqueFileName as uniqueName } from '@lumin/shared'

/**
 * 取文件名主名（去最后一个扩展名；无扩展名原样）
 * @param fileName 含扩展名的文件名
 */
export function stemOf(fileName: string): string {
  const dot = fileName.lastIndexOf('.')
  return dot <= 0 ? fileName : fileName.slice(0, dot)
}

/**
 * 格式转换命名：重编码 `{stem}.{ext}`；remux 加 `.remux` 中缀防同名覆盖
 * @param inputName 输入文件名
 * @param ext 目标扩展名
 * @param mode 转换方式（默认重编码）
 */
export function buildTranscodeName(
  inputName: string,
  ext: string,
  mode: 'encode' | 'remux' = 'encode'
): string {
  const stem = stemOf(inputName)
  return mode === 'remux' ? `${stem}.remux.${ext}` : `${stem}.${ext}`
}

/**
 * 截取命名：`{stem}.cut_{开始HHMMSS}-{结束HHMMSS}.mp4`
 * @param inputName 输入文件名
 * @param startSec 开始秒
 * @param endSec 结束秒
 */
export function buildTrimName(inputName: string, startSec: number, endSec: number): string {
  return `${stemOf(inputName)}.cut_${formatTimeTag(startSec)}-${formatTimeTag(endSec)}.mp4`
}

/**
 * 提取音频命名：`{stem}.audio.{ext}`
 * @param inputName 输入文件名
 * @param ext 目标扩展名
 */
export function buildExtractAudioName(inputName: string, ext: string): string {
  return `${stemOf(inputName)}.audio.${ext}`
}

/**
 * 音频互转命名：`{stem}.{ext}`（目标格式即扩展名）
 * @param inputName 输入文件名
 * @param ext 目标扩展名
 */
export function buildAudioConvertName(inputName: string, ext: string): string {
  return `${stemOf(inputName)}.${ext}`
}

/**
 * 压缩命名：`{stem}.c{high|medium|low}.mp4`
 * @param inputName 输入文件名
 * @param level 质量档
 */
export function buildCompressName(inputName: string, level: QualityLevel): string {
  return `${stemOf(inputName)}.c${level}.mp4`
}
