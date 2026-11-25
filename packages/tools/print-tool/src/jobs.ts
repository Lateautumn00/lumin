/**
 * @file jobs.ts
 * @author cuilanchao
 * @date 2026-11-25
 * @description 打印任务纯函数：HTML 包装模板、取消/失败判定、临时产物过期判定。
 */

/** 临时产物保留时长：24 小时 */
export const JOB_TTL_MS = 24 * 60 * 60 * 1000

/** HTML 文本/属性转义 */
export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

/**
 * 图片打印用的 A4 HTML（图片等比缩放至页内，避免超出纸张）。
 * @param options title 窗口/文档标题；imageUrl 图片的 file:// URL
 */
export function buildImageHtml(options: { title: string; imageUrl: string }): string {
  const title = escapeHtml(options.title)
  const src = escapeHtml(options.imageUrl)
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src file: data:; style-src 'unsafe-inline'">
<title>${title}</title>
<style>
  @page { size: A4; margin: 12mm; }
  html, body { margin: 0; padding: 0; height: 100%; }
  body { display: flex; align-items: center; justify-content: center; }
  img { max-width: 100%; max-height: 100%; object-fit: contain; }
</style>
</head>
<body><img src="${src}" alt="${title}"></body>
</html>`
}

/**
 * 栅格兜底打印用的 HTML：每页一张图，按 A4 分页。
 * @param options title 文档标题；imageUrls 逐页 PNG 的 file:// URL（顺序即页码）
 */
export function buildRasterHtml(options: { title: string; imageUrls: readonly string[] }): string {
  const title = escapeHtml(options.title)
  const pages = options.imageUrls
    .map(
      (url, index) =>
        `<section><img src="${escapeHtml(url)}" alt="${title} 第 ${index + 1} 页"></section>`
    )
    .join('\n')
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src file: data:; style-src 'unsafe-inline'">
<title>${title}</title>
<style>
  @page { size: A4; margin: 0; }
  html, body { margin: 0; padding: 0; }
  section { width: 210mm; height: 297mm; display: flex; align-items: center; justify-content: center; page-break-after: always; }
  section:last-child { page-break-after: auto; }
  img { max-width: 100%; max-height: 100%; object-fit: contain; }
</style>
</head>
<body>${pages}</body>
</html>`
}

/** 系统对话框失败原因归类：cancel 视为用户取消而非失败（spec §3） */
export function isCancelledReason(reason: string | undefined | null): boolean {
  return typeof reason === 'string' && /cancel/i.test(reason)
}

/** 临时产物是否超过保留时长 */
export function isStaleJob(mtimeMs: number, nowMs: number, ttlMs = JOB_TTL_MS): boolean {
  return nowMs - mtimeMs > ttlMs
}
