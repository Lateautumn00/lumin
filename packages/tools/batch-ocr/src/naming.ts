/**
 * @file 导出命名纯函数（合并 TXT 文件名）
 * @author cuilanchao
 * @date 2026-11-20
 * @description 本地时间戳格式 `yyyyMMdd-HHmmss`，不依赖 Date 以外 API，便于单测注入固定时间。
 */

function pad2(value: number): string {
  return String(value).padStart(2, '0')
}

/** 本地时间戳 `yyyyMMdd-HHmmss`（合并导出文件名用） */
export function formatStamp(date: Date): string {
  const day = `${date.getFullYear()}${pad2(date.getMonth() + 1)}${pad2(date.getDate())}`
  const time = `${pad2(date.getHours())}${pad2(date.getMinutes())}${pad2(date.getSeconds())}`
  return `${day}-${time}`
}

/** 合并导出默认文件名 `OCR-合并-{stamp}.txt` */
export function mergedFileName(date: Date): string {
  return `OCR-合并-${formatStamp(date)}.txt`
}
