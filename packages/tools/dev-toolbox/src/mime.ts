/**
 * @file 静态服务器 MIME 表（内置，未知类型回退 application/octet-stream）
 * @author cuilanchao
 * @date 2026-11-21
 */
import { extname } from 'node:path'

/** 扩展名 → Content-Type（小写、不含点） */
const MIME_TYPES: Record<string, string> = {
  html: 'text/html; charset=utf-8',
  htm: 'text/html; charset=utf-8',
  css: 'text/css; charset=utf-8',
  js: 'text/javascript; charset=utf-8',
  mjs: 'text/javascript; charset=utf-8',
  json: 'application/json; charset=utf-8',
  txt: 'text/plain; charset=utf-8',
  md: 'text/markdown; charset=utf-8',
  svg: 'image/svg+xml',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  ico: 'image/x-icon',
  pdf: 'application/pdf',
  wasm: 'application/wasm',
  woff2: 'font/woff2',
  mp4: 'video/mp4',
  mp3: 'audio/mpeg',
  map: 'application/json; charset=utf-8'
}

/** 未知类型回退 */
export const DEFAULT_MIME_TYPE = 'application/octet-stream'

/**
 * 按文件扩展名取 Content-Type
 * @param filePath 文件路径（大小写不敏感）
 */
export function mimeTypeOf(filePath: string): string {
  const extension = extname(filePath).slice(1).toLowerCase()
  return MIME_TYPES[extension] ?? DEFAULT_MIME_TYPE
}
