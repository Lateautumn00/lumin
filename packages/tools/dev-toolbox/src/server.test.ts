/**
 * @file server.ts 单测：真实 http + 临时目录，覆盖目录列表/文件/404/403/405/HEAD/端口占用
 * @author cuilanchao
 * @date 2026-11-21
 */
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { request as httpRequest } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createStaticServer, escapeHtml, renderDirectoryIndex, type StaticServer } from './server'

interface ResponseView {
  status: number
  contentType: string
  body: string
}

let roots: string[] = []
let servers: StaticServer[] = []

async function makeRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'lumin-dt-'))
  roots.push(root)
  return root
}

function request(port: number, path: string, method = 'GET'): Promise<ResponseView> {
  return new Promise((resolvePromise, reject) => {
    const req = httpRequest({ host: '127.0.0.1', port, path, method }, (res) => {
      const chunks: Buffer[] = []
      res.on('data', (chunk: Buffer) => chunks.push(chunk))
      res.on('end', () =>
        resolvePromise({
          status: res.statusCode ?? 0,
          contentType: String(res.headers['content-type'] ?? ''),
          body: Buffer.concat(chunks).toString('utf8')
        })
      )
    })
    req.on('error', reject)
    req.end()
  })
}

async function start(root: string): Promise<{ server: StaticServer; port: number }> {
  const server = createStaticServer(root)
  servers.push(server)
  const port = await server.start(0)
  return { server, port }
}

/** 服务端日志在响应结束后异步补记，轮询等待到指定条数 */
async function waitForRequests(
  server: StaticServer,
  count: number
): Promise<ReturnType<StaticServer['status']>['requests']> {
  const deadline = Date.now() + 3000
  while (Date.now() < deadline) {
    const requests = server.status().requests
    if (requests.length >= count) return requests
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 10))
  }
  return server.status().requests
}

beforeEach(() => {
  roots = []
  servers = []
})

afterEach(async () => {
  for (const server of servers) await server.stop()
  for (const root of roots) await rm(root, { recursive: true, force: true })
})

describe('createStaticServer', () => {
  it('目录请求返回 HTML 列表（目录优先、含子目录斜杠）', async () => {
    const root = await makeRoot()
    await writeFile(join(root, 'a.txt'), 'hello')
    await mkdir(join(root, 'sub'))
    const { port } = await start(root)

    const response = await request(port, '/')
    expect(response.status).toBe(200)
    expect(response.contentType).toContain('text/html')
    expect(response.body).toContain('a.txt')
    expect(response.body).toContain('sub/')
    expect(response.body.indexOf('sub/')).toBeLessThan(response.body.indexOf('a.txt'))
  })

  it('存在的 index.html 优先于目录列表', async () => {
    const root = await makeRoot()
    await writeFile(join(root, 'index.html'), '<h1>首页</h1>')
    const { port } = await start(root)

    const response = await request(port, '/')
    expect(response.status).toBe(200)
    expect(response.body).toContain('首页')
  })

  it('文件请求返回正确 Content-Type 与内容', async () => {
    const root = await makeRoot()
    await writeFile(join(root, 'app.js'), 'console.log(1)')
    const { port } = await start(root)

    const response = await request(port, '/app.js')
    expect(response.status).toBe(200)
    expect(response.contentType).toContain('text/javascript')
    expect(response.body).toBe('console.log(1)')
  })

  it('HEAD 请求返回 200 且无响应体', async () => {
    const root = await makeRoot()
    await writeFile(join(root, 'a.txt'), 'hello')
    const { port } = await start(root)

    const response = await request(port, '/a.txt', 'HEAD')
    expect(response.status).toBe(200)
    expect(response.body).toBe('')
  })

  it('非 GET/HEAD 返回 405', async () => {
    const root = await makeRoot()
    const { port } = await start(root)

    const response = await request(port, '/', 'POST')
    expect(response.status).toBe(405)
  })

  it('不存在的路径返回 404', async () => {
    const root = await makeRoot()
    const { port } = await start(root)

    expect((await request(port, '/missing.txt')).status).toBe(404)
  })

  it('编码后的父目录穿越返回 403', async () => {
    const root = await makeRoot()
    const { port } = await start(root)

    expect((await request(port, '/..%2f..%2fpackage.json')).status).toBe(403)
  })

  it('访问日志记录方法/路径/状态/字节，状态接口按新→旧返回', async () => {
    const root = await makeRoot()
    await writeFile(join(root, 'a.txt'), 'hello')
    const { server, port } = await start(root)

    await request(port, '/a.txt')
    // 等首条访问日志落账再发第二次请求：服务端 finish 事件与客户端响应完成无严格先后，
    // 全量并发跑测时否则会出现两条日志顺序互换的偶发失败
    await waitForRequests(server, 1)
    await request(port, '/missing.txt')

    const status = server.status()
    expect(status.running).toBe(true)
    expect(status.port).toBe(port)
    const requests = await waitForRequests(server, 2)
    expect(requests).toHaveLength(2)
    expect(requests[0]).toMatchObject({ path: '/missing.txt', status: 404 })
    expect(requests[1]).toMatchObject({ path: '/a.txt', status: 200, bytes: 5 })
  })

  it('停止后 running=false，可再次启动', async () => {
    const root = await makeRoot()
    const { server, port } = await start(root)

    await server.stop()
    expect(server.status().running).toBe(false)
    expect(server.status().port).toBeUndefined()

    const again = await server.start(0)
    expect(again).toBeGreaterThan(0)
    expect(server.status().running).toBe(true)
    expect(port).toBeGreaterThan(0)
  })

  it('端口被占用映射为 DT_PORT_IN_USE', async () => {
    const root = await makeRoot()
    const first = await start(root)
    const second = createStaticServer(root)
    servers.push(second)

    await expect(second.start(first.port)).rejects.toMatchObject({ code: 'DT_PORT_IN_USE' })
  })

  it('中文/空格文件名与含空格根目录可正常访问（R2 路径实测）', async () => {
    const base = await makeRoot()
    const root = join(base, 'site dir')
    await mkdir(root)
    await writeFile(join(root, '中文 文件.txt'), '内容', 'utf8')
    const { port } = await start(root)

    const response = await request(port, `/${encodeURIComponent('中文 文件.txt')}`)
    expect(response.status).toBe(200)
    expect(response.body).toBe('内容')
  })

  it('超大文件（8 MB）流式返回且字节数正确（R2 超大文件实测）', async () => {
    const root = await makeRoot()
    const size = 8 * 1024 * 1024
    await writeFile(join(root, 'big.bin'), Buffer.alloc(size, 0x61))
    const { server, port } = await start(root)

    const response = await request(port, '/big.bin')
    expect(response.status).toBe(200)
    expect(response.body.length).toBe(size)
    const requests = await waitForRequests(server, 1)
    expect(requests[0]).toMatchObject({ status: 200, bytes: size })
  })

  it('并发请求全部成功并逐条记录（R2 并发实测）', async () => {
    const root = await makeRoot()
    await writeFile(join(root, 'a.txt'), 'hello')
    const { server, port } = await start(root)

    const responses = await Promise.all([
      request(port, '/a.txt'),
      request(port, '/a.txt'),
      request(port, '/'),
      request(port, '/missing.txt'),
      request(port, '/a.txt')
    ])
    expect(responses.map((item) => item.status).sort()).toEqual([200, 200, 200, 200, 404])
    expect(await waitForRequests(server, 5)).toHaveLength(5)
  })
})

describe('目录列表 HTML', () => {
  it('escapeHtml 转义五类字符', () => {
    expect(escapeHtml(`<a href="x">'&'</a>`)).toBe(
      '&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;'
    )
  })

  it('renderDirectoryIndex 转义文件名并标注目录/大小', () => {
    const html = renderDirectoryIndex('/d', [
      { name: '<evil>.txt', size: 12, isDir: false },
      { name: 'sub', size: 0, isDir: true }
    ])
    expect(html).toContain('&lt;evil&gt;.txt')
    expect(html).toContain('sub/')
    expect(html).toContain('12')
  })
})
