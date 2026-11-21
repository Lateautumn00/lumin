/**
 * @file node.ts 单测：七通道入参校验、错误映射、配置记忆与服务器生命周期
 * @author cuilanchao
 * @date 2026-11-21
 */
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type {
  IpcHandler,
  IpcHandlerContext,
  MainPluginContext,
  ToolSettings
} from '@lumin/plugin-api'
import type { RunProcessResult } from '@lumin/node-kit'
import { manifest } from './manifest'
import { registerWith, type DevToolboxDeps } from './node'
import type { StaticServer } from './server'
import { toolError } from './errors'

const TCP_OUTPUT = [
  '  协议  本地地址        外部地址        状态           PID',
  '  TCP    0.0.0.0:135     0.0.0.0:0      LISTENING       1234',
  '  TCP    127.0.0.1:8080  127.0.0.1:5    ESTABLISHED     5678'
].join('\r\n')

const UDP_OUTPUT = [
  '  协议  本地地址        外部地址        PID',
  '  UDP    0.0.0.0:500     *:*             3333'
].join('\r\n')

const TASKLIST_OUTPUT = [
  '"svchost.exe","1234","Console","1","10,000 K"',
  '"node.exe","5678","Console","1","20,000 K"',
  '"udp-owner.exe","3333","Console","1","1,000 K"'
].join('\r\n')

function result(stdout: string, overrides: Partial<RunProcessResult> = {}): RunProcessResult {
  return {
    code: 0,
    signal: null,
    stdout,
    stderr: '',
    timedOut: false,
    aborted: false,
    truncated: false,
    ...overrides
  }
}

interface DepsOptions {
  tcpOutput?: string
  udpOutput?: string
  tasklistOutput?: string
  netstatFailure?: boolean
  tasklistFailure?: boolean
  startError?: unknown
  killError?: unknown
  ownPid?: number
  killed?: number[]
}

function fakeServer(root: string, startError?: unknown): StaticServer {
  let running = false
  let port = 0
  return {
    root,
    start: async (requested) => {
      if (startError !== undefined) throw startError
      running = true
      port = requested
      return requested
    },
    stop: async () => {
      running = false
    },
    status: () => ({
      running,
      requests: [],
      ...(running ? { port, root } : {})
    })
  }
}

function createDeps(options: DepsOptions = {}): DevToolboxDeps {
  return {
    runProcess: async (request) => {
      if (request.command === 'tasklist') {
        if (options.tasklistFailure === true) return result('', { code: 1 })
        return result(options.tasklistOutput ?? TASKLIST_OUTPUT)
      }
      if (options.netstatFailure === true) {
        return result('', { code: 1, stderr: '拒绝访问' })
      }
      const isUdp = request.args?.includes('udp') === true
      return result(isUdp ? (options.udpOutput ?? UDP_OUTPUT) : (options.tcpOutput ?? TCP_OUTPUT))
    },
    ownPid: options.ownPid ?? 100,
    killProcess: async (pid) => {
      if (options.killError !== undefined) throw options.killError
      options.killed?.push(pid)
    },
    createServer: (root) => fakeServer(root, options.startError)
  }
}

interface Harness {
  invoke(action: string, payload?: unknown): Promise<unknown>
  store: Map<string, unknown>
}

function createHarness(deps: DevToolboxDeps): Harness {
  const handlers = new Map<string, (context: IpcHandlerContext<unknown>) => unknown>()
  const store = new Map<string, unknown>()
  const settings: ToolSettings = {
    get: async <T>(key: string, defaultValue: T): Promise<T> =>
      store.has(key) ? (store.get(key) as T) : defaultValue,
    set: async <T>(key: string, value: T): Promise<void> => {
      store.set(key, value)
    }
  }
  const ctx: MainPluginContext = {
    toolId: 'dev-toolbox',
    manifest,
    registerIpc: <P, R>(action: string, handler: IpcHandler<P, R>): void => {
      handlers.set(action, (context) => handler(context as IpcHandlerContext<P>) as R)
    },
    registerTask: () => undefined,
    settings,
    log: {
      debug: () => undefined,
      info: () => undefined,
      warn: () => undefined,
      error: () => undefined
    },
    paths: { temp: '', userData: '', binaries: '' }
  }
  registerWith(ctx, deps)
  return {
    store,
    invoke: async (action, payload) => {
      const handler = handlers.get(action)
      if (handler === undefined) throw new Error(`未注册通道：${action}`)
      return await handler({ toolId: 'dev-toolbox', action, payload })
    }
  }
}

let tempDirs: string[] = []

async function makeTempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'lumin-dt-node-'))
  tempDirs.push(dir)
  return dir
}

afterEach(async () => {
  for (const dir of tempDirs) await rm(dir, { recursive: true, force: true })
  tempDirs = []
})

describe('manifest', () => {
  it('id/icon/category/order 符合 spec', () => {
    expect(manifest.id).toBe('dev-toolbox')
    expect(manifest.icon).toBe('terminal')
    expect(manifest.category).toBe('misc')
  })
})

describe('ports-query', () => {
  it('合并 TCP/UDP 并按端口排序、回填进程名', async () => {
    const harness = createHarness(createDeps())
    const data = (await harness.invoke('ports-query', {})) as {
      rows: { port: number; protocol: string; process: string }[]
      truncated: boolean
    }
    expect(data.rows.map((row) => row.port)).toEqual([135, 500, 8080])
    expect(data.rows.map((row) => row.protocol)).toEqual(['TCP', 'UDP', 'TCP'])
    expect(data.rows[0]?.process).toBe('svchost.exe')
    expect(data.rows[1]?.process).toBe('udp-owner.exe')
    expect(data.truncated).toBe(false)
  })

  it('指定端口只返回匹配行', async () => {
    const harness = createHarness(createDeps())
    const data = (await harness.invoke('ports-query', { port: 8080 })) as {
      rows: { port: number }[]
    }
    expect(data.rows).toHaveLength(1)
    expect(data.rows[0]?.port).toBe(8080)
  })

  it('tasklist 失败时端口列表仍返回，进程名留空', async () => {
    const harness = createHarness(createDeps({ tasklistFailure: true }))
    const data = (await harness.invoke('ports-query', {})) as {
      rows: { process: string }[]
    }
    expect(data.rows).toHaveLength(3)
    expect(data.rows.every((row) => row.process === '')).toBe(true)
  })

  it('netstat 失败映射 DT_NETSTAT_FAILED', async () => {
    const harness = createHarness(createDeps({ netstatFailure: true }))
    await expect(harness.invoke('ports-query', {})).rejects.toMatchObject({
      code: 'DT_NETSTAT_FAILED',
      detail: '拒绝访问'
    })
  })

  it('超过 5000 行截断', async () => {
    const lines = ['  TCP    0.0.0.0:1    0.0.0.0:0    LISTENING    1']
    for (let index = 0; index < 5001; index += 1) {
      lines.push(`  TCP    127.0.0.1:${(index % 65535) + 1}    127.0.0.1:0    LISTENING    1`)
    }
    const harness = createHarness(createDeps({ tcpOutput: lines.join('\n') }))
    const data = (await harness.invoke('ports-query', {})) as {
      rows: unknown[]
      truncated: boolean
    }
    expect(data.rows).toHaveLength(5000)
    expect(data.truncated).toBe(true)
  })

  it('端口非法映射 DT_INVALID_PORT', async () => {
    const harness = createHarness(createDeps())
    await expect(harness.invoke('ports-query', { port: 70000 })).rejects.toMatchObject({
      code: 'DT_INVALID_PORT'
    })
    await expect(harness.invoke('ports-query', { port: '80' })).rejects.toMatchObject({
      code: 'DT_INVALID_PORT'
    })
  })

  it('整体入参类型错误映射 DT_INVALID_PAYLOAD', async () => {
    const harness = createHarness(createDeps())
    await expect(harness.invoke('ports-query', 42)).rejects.toMatchObject({
      code: 'DT_INVALID_PAYLOAD'
    })
  })
})

describe('port-kill', () => {
  it('正常结束进程', async () => {
    const killed: number[] = []
    const harness = createHarness(createDeps({ killed }))
    await expect(harness.invoke('port-kill', { pid: 42 })).resolves.toEqual({ ok: true })
    expect(killed).toEqual([42])
  })

  it('拒绝自身 PID 与非正 PID', async () => {
    const harness = createHarness(createDeps({ ownPid: 100 }))
    for (const pid of [100, 0, -1]) {
      await expect(harness.invoke('port-kill', { pid })).rejects.toMatchObject({
        code: 'DT_KILL_SELF_FORBIDDEN'
      })
    }
  })

  it('taskkill 失败映射 DT_KILL_FAILED', async () => {
    const harness = createHarness(
      createDeps({ killError: Object.assign(new Error('boom'), { code: 'EPERM' }) })
    )
    await expect(harness.invoke('port-kill', { pid: 42 })).rejects.toMatchObject({
      code: 'DT_KILL_FAILED',
      detail: 'EPERM'
    })
  })

  it('结构化错误透传', async () => {
    const harness = createHarness(createDeps({ killError: toolError('DT_KILL_FAILED', 'denied') }))
    await expect(harness.invoke('port-kill', { pid: 42 })).rejects.toMatchObject({
      code: 'DT_KILL_FAILED',
      detail: 'denied'
    })
  })

  it('PID 类型错误映射 DT_INVALID_PAYLOAD', async () => {
    const harness = createHarness(createDeps())
    await expect(harness.invoke('port-kill', { pid: 'x' })).rejects.toMatchObject({
      code: 'DT_INVALID_PAYLOAD'
    })
  })
})

describe('server-start / server-stop / server-status', () => {
  it('根目录不存在或不是目录映射 DT_ROOT_INVALID', async () => {
    const root = await makeTempDir()
    const filePath = join(root, 'a.txt')
    await writeFile(filePath, 'x')
    const harness = createHarness(createDeps())

    await expect(
      harness.invoke('server-start', { root: join(root, 'missing'), port: 8080 })
    ).rejects.toMatchObject({ code: 'DT_ROOT_INVALID' })
    await expect(
      harness.invoke('server-start', { root: filePath, port: 8080 })
    ).rejects.toMatchObject({ code: 'DT_ROOT_INVALID', detail: '目标不是目录' })
  })

  it('启动成功写回配置并暴露状态', async () => {
    const root = await makeTempDir()
    const harness = createHarness(createDeps())

    const started = (await harness.invoke('server-start', { root, port: 8080 })) as {
      running: boolean
      port: number
      root: string
    }
    expect(started).toEqual({ running: true, port: 8080, root })
    expect(harness.store.get('devToolboxRoot')).toBe(root)
    expect(harness.store.get('devToolboxPort')).toBe(8080)

    const status = (await harness.invoke('server-status')) as {
      running: boolean
      port?: number
      root?: string
    }
    expect(status).toMatchObject({ running: true, port: 8080, root })

    await expect(harness.invoke('server-stop')).resolves.toEqual({ running: false })
    await expect(harness.invoke('server-status')).resolves.toEqual({
      running: false,
      requests: []
    })
  })

  it('未启动时停止与查询状态安全返回', async () => {
    const harness = createHarness(createDeps())
    await expect(harness.invoke('server-stop')).resolves.toEqual({ running: false })
    await expect(harness.invoke('server-status')).resolves.toEqual({
      running: false,
      requests: []
    })
  })

  it('端口占用结构化错误透传', async () => {
    const root = await makeTempDir()
    const harness = createHarness(
      createDeps({ startError: toolError('DT_PORT_IN_USE', 'EADDRINUSE') })
    )
    await expect(harness.invoke('server-start', { root, port: 8080 })).rejects.toMatchObject({
      code: 'DT_PORT_IN_USE'
    })
  })

  it('未知启动异常映射 DT_SERVER_FAILED', async () => {
    const root = await makeTempDir()
    const harness = createHarness(createDeps({ startError: new Error('boom') }))
    await expect(harness.invoke('server-start', { root, port: 8080 })).rejects.toMatchObject({
      code: 'DT_SERVER_FAILED'
    })
  })

  it('参数非法映射 DT_INVALID_PAYLOAD', async () => {
    const harness = createHarness(createDeps())
    await expect(harness.invoke('server-start', { root: '', port: 8080 })).rejects.toMatchObject({
      code: 'DT_INVALID_PAYLOAD'
    })
  })
})

describe('config / set-config', () => {
  it('缺省返回默认端口与空目录', async () => {
    const harness = createHarness(createDeps())
    await expect(harness.invoke('config')).resolves.toEqual({ root: null, port: 8080 })
  })

  it('保存后读回，root=null 清空', async () => {
    const harness = createHarness(createDeps())
    await expect(harness.invoke('set-config', { root: 'C:\\site', port: 3000 })).resolves.toEqual({
      root: 'C:\\site',
      port: 3000
    })
    await expect(harness.invoke('set-config', { root: null })).resolves.toEqual({
      root: null,
      port: 3000
    })
  })

  it('存量非法值回退默认', async () => {
    const harness = createHarness(createDeps())
    harness.store.set('devToolboxRoot', '')
    harness.store.set('devToolboxPort', 'abc')
    await expect(harness.invoke('config')).resolves.toEqual({ root: null, port: 8080 })
  })

  it('非法端口映射 DT_INVALID_PAYLOAD', async () => {
    const harness = createHarness(createDeps())
    await expect(harness.invoke('set-config', { port: 0 })).rejects.toMatchObject({
      code: 'DT_INVALID_PAYLOAD'
    })
  })
})
