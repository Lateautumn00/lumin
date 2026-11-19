/**
 * @file serve-updates.mjs
 * @author cuilanchao
 * @date 2026-11-19
 * @description 本地更新源：以 apps/desktop/release 为根提供静态文件（支持 Range，供 electron-updater 断点续传），默认 127.0.0.1:8787。
 *              用于 docs/smoke/shell.md §5 更新冒烟与本地联调，不参与打包产物。
 */
import { createReadStream, existsSync, statSync } from 'node:fs'
import { createServer } from 'node:http'
import { extname, join, normalize, resolve } from 'node:path'

const ROOT = resolve(process.cwd(), 'apps/desktop/release')
const PORT = Number(process.env.UPDATE_PORT ?? 8787)
const HOST = process.env.UPDATE_HOST ?? '127.0.0.1'

const MIME = {
  '.yml': 'text/yaml; charset=utf-8',
  '.exe': 'application/octet-stream',
  '.blockmap': 'application/octet-stream',
  '.zip': 'application/zip'
}

if (!existsSync(ROOT)) {
  console.error(`更新源目录不存在：${ROOT}（先执行 pnpm dist 生成产物）`)
  process.exit(1)
}

/**
 * 解析请求路径为安全绝对路径（拒绝路径穿越与目录请求）。
 * @param {string} urlPath 请求 URL 的 pathname
 * @returns {string | null} 合法文件绝对路径，否则 null
 */
function resolveRequestPath(urlPath) {
  const decoded = decodeURIComponent(urlPath.split('?')[0] ?? '/')
  const relative = normalize(decoded).replace(/^([/\\])+/, '')
  if (relative === '' || relative.includes('..')) return null
  const target = resolve(join(ROOT, relative))
  if (!target.startsWith(ROOT)) return null
  if (!existsSync(target) || !statSync(target).isFile()) return null
  return target
}

const server = createServer((req, res) => {
  const target = resolveRequestPath(req.url ?? '/')
  if (target === null) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' })
    res.end('Not Found')
    return
  }

  const size = statSync(target).size
  const type = MIME[extname(target).toLowerCase()] ?? 'application/octet-stream'
  const range = req.headers.range

  if (typeof range === 'string' && range.startsWith('bytes=')) {
    const [startText, endText] = range.slice(6).split('-')
    const start = Number(startText ?? 0)
    const end = endText === undefined || endText === '' ? size - 1 : Number(endText)
    if (!Number.isFinite(start) || !Number.isFinite(end) || start > end || start >= size) {
      res.writeHead(416, { 'Content-Range': `bytes */${size}` })
      res.end()
      return
    }
    res.writeHead(206, {
      'Content-Type': type,
      'Content-Length': end - start + 1,
      'Content-Range': `bytes ${start}-${end}/${size}`,
      'Accept-Ranges': 'bytes'
    })
    createReadStream(target, { start, end }).pipe(res)
    return
  }

  res.writeHead(200, {
    'Content-Type': type,
    'Content-Length': size,
    'Accept-Ranges': 'bytes'
  })
  createReadStream(target).pipe(res)
})

server.listen(PORT, HOST, () => {
  console.log(`更新源已启动：http://${HOST}:${PORT}（根目录 ${ROOT}）`)
})
