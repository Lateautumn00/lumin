/**
 * @file 本机静态服务器（仅 127.0.0.1，GET/HEAD，目录列表/403/404/405）
 * @author cuilanchao
 * @date 2026-11-21
 * @description 与插件上下文解耦：createStaticServer 可独立单测（真实 http + 临时目录）
 */
import { open, readdir, stat } from 'node:fs/promises'
import {
  createServer as createHttpServer,
  type IncomingMessage,
  type Server,
  type ServerResponse
} from 'node:http'
import { join } from 'node:path'
import { pipeline } from 'node:stream/promises'
import { errnoCode, toolError } from './errors'
import { mimeTypeOf } from './mime'
import { resolveRequestPath } from './path-guard'
import { ACCESS_LOG_VISIBLE, MAX_ACCESS_LOG, type AccessLog } from './schema'

/** 服务器状态快照（access log 新→旧） */
export interface StaticServerStatus {
  running: boolean
  port?: number
  root?: string
  requests: AccessLog[]
}

/** 可独立测试的静态服务器句柄 */
export interface StaticServer {
  readonly root: string
  /** 启动并返回实际监听端口 */
  start(port: number): Promise<number>
  stop(): Promise<void>
  status(): StaticServerStatus
}

/** 目录列表条目 */
export interface DirectoryEntry {
  name: string
  size: number
  isDir: boolean
}

/** HTML 转义（目录名/链接） */
export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

/**
 * 生成最小目录列表 HTML（零样式，仅文件名 + 大小）
 * @param pathname 请求路径（展示用）
 * @param entries 目录项（已排序）
 */
export function renderDirectoryIndex(pathname: string, entries: readonly DirectoryEntry[]): string {
  const items = entries.map((entry) => {
    const suffix = entry.isDir ? '/' : ''
    const href = `${encodeURIComponent(entry.name)}${suffix}`
    const size = entry.isDir ? '—' : String(entry.size)
    return `<li><a href="${escapeHtml(href)}">${escapeHtml(entry.name)}${suffix}</a> <span>${size}</span></li>`
  })
  return [
    '<!doctype html>',
    '<html lang="zh-CN">',
    '<head><meta charset="utf-8"><title>目录列表</title></head>',
    '<body>',
    `<h1>${escapeHtml(pathname)}</h1>`,
    `<ul>${items.join('')}</ul>`,
    '</body>',
    '</html>'
  ].join('\n')
}

/**
 * 创建静态服务器（每个实例独占根目录与访问日志）
 * @param root 根目录绝对路径
 */
export function createStaticServer(root: string): StaticServer {
  let server: Server | null = null
  let listeningPort: number | null = null
  const logs: AccessLog[] = []

  const record = (entry: AccessLog): void => {
    logs.push(entry)
    if (logs.length > MAX_ACCESS_LOG) logs.splice(0, logs.length - MAX_ACCESS_LOG)
  }

  const sendText = (res: ServerResponse, status: number, text: string): number => {
    const body = Buffer.from(text, 'utf8')
    res.writeHead(status, {
      'Content-Type': 'text/plain; charset=utf-8',
      'Content-Length': body.length
    })
    res.end(body)
    return body.length
  }

  const serveFile = async (
    req: IncomingMessage,
    res: ServerResponse,
    target: string
  ): Promise<number> => {
    // 先打开再写响应头：文件被占用/无权限时可在发出 200 之前映射为 403/500
    const handle = await open(target, 'r')
    try {
      const info = await handle.stat()
      res.writeHead(200, {
        'Content-Type': mimeTypeOf(target),
        'Content-Length': info.size,
        'Cache-Control': 'no-store'
      })
      if ((req.method ?? 'GET').toUpperCase() === 'HEAD') {
        res.end()
        return 0
      }
      await pipeline(handle.createReadStream(), res)
      return info.size
    } finally {
      await handle.close().catch(() => undefined)
    }
  }

  const resolveTarget = async (
    req: IncomingMessage,
    res: ServerResponse,
    pathname: string
  ): Promise<{ status: number; bytes: number }> => {
    const target = resolveRequestPath(root, pathname)
    if (target === null) return { status: 403, bytes: sendText(res, 403, '403 Forbidden') }

    let info
    try {
      info = await stat(target)
    } catch (err) {
      const code = errnoCode(err)
      if (code === 'ENOENT' || code === 'ENOTDIR') {
        return { status: 404, bytes: sendText(res, 404, '404 Not Found') }
      }
      return { status: 403, bytes: sendText(res, 403, '403 Forbidden') }
    }

    if (info.isDirectory()) {
      const indexPath = join(target, 'index.html')
      const indexInfo = await stat(indexPath).catch(() => null)
      if (indexInfo !== null && indexInfo.isFile()) {
        return { status: 200, bytes: await serveFile(req, res, indexPath) }
      }
      const dirents = await readdir(target, { withFileTypes: true })
      const entries: DirectoryEntry[] = []
      for (const dirent of dirents) {
        const childInfo = await stat(join(target, dirent.name)).catch(() => null)
        entries.push({
          name: dirent.name,
          size: childInfo?.size ?? 0,
          isDir: dirent.isDirectory()
        })
      }
      entries.sort(
        (left, right) =>
          Number(right.isDir) - Number(left.isDir) || left.name.localeCompare(right.name)
      )
      const body = Buffer.from(renderDirectoryIndex(pathname, entries), 'utf8')
      res.writeHead(200, {
        'Content-Type': 'text/html; charset=utf-8',
        'Content-Length': body.length
      })
      if ((req.method ?? 'GET').toUpperCase() === 'HEAD') {
        res.end()
        return { status: 200, bytes: 0 }
      }
      res.end(body)
      return { status: 200, bytes: body.length }
    }

    if (!info.isFile()) return { status: 403, bytes: sendText(res, 403, '403 Forbidden') }
    return { status: 200, bytes: await serveFile(req, res, target) }
  }

  const handle = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    const method = (req.method ?? 'GET').toUpperCase()
    let pathname = '/'
    try {
      pathname = new URL(req.url ?? '/', 'http://127.0.0.1').pathname
    } catch {
      pathname = '/'
    }

    let status = 200
    let bytes = 0
    try {
      if (method !== 'GET' && method !== 'HEAD') {
        status = 405
        res.setHeader('Allow', 'GET, HEAD')
        bytes = sendText(res, status, '405 Method Not Allowed')
        return
      }
      const outcome = await resolveTarget(req, res, pathname)
      status = outcome.status
      bytes = outcome.bytes
    } catch (err) {
      const code = errnoCode(err)
      const denied = code === 'EACCES' || code === 'EPERM' || code === 'EBUSY'
      status = denied ? 403 : 500
      if (!res.headersSent) {
        bytes = denied
          ? sendText(res, 403, '403 Forbidden')
          : sendText(res, 500, '500 Internal Server Error')
      } else {
        res.destroy()
        bytes = 0
      }
    } finally {
      record({ time: Date.now(), method, path: pathname, status, bytes })
    }
  }

  async function stop(): Promise<void> {
    const current = server
    server = null
    listeningPort = null
    if (current === null) return
    current.closeAllConnections()
    await new Promise<void>((resolveStop) => {
      current.close(() => resolveStop())
    })
  }

  async function start(port: number): Promise<number> {
    await stop()
    const httpServer = createHttpServer((req, res) => {
      void handle(req, res)
    })
    try {
      await new Promise<void>((resolveListening, rejectListening) => {
        const onError = (err: NodeJS.ErrnoException): void => {
          httpServer.removeListener('listening', onListening)
          rejectListening(err)
        }
        const onListening = (): void => {
          httpServer.removeListener('error', onError)
          resolveListening()
        }
        httpServer.once('error', onError)
        httpServer.once('listening', onListening)
        httpServer.listen(port, '127.0.0.1')
      })
    } catch (err) {
      httpServer.close()
      const code = errnoCode(err)
      throw code === 'EADDRINUSE'
        ? toolError('DT_PORT_IN_USE', code)
        : toolError('DT_SERVER_FAILED', code)
    }
    const address = httpServer.address()
    listeningPort = typeof address === 'object' && address !== null ? address.port : port
    server = httpServer
    return listeningPort
  }

  function status(): StaticServerStatus {
    return {
      running: server !== null,
      ...(listeningPort !== null ? { port: listeningPort } : {}),
      root,
      requests: logs.slice(-ACCESS_LOG_VISIBLE).reverse()
    }
  }

  return { root, start, stop, status }
}
