/**
 * @file dev-toolbox 主进程逻辑（七条 invoke 通道，全部入参 zod 校验）
 * @author cuilanchao
 * @date 2026-11-21
 * @description ports-query / port-kill / server-start / server-stop / server-status / config / set-config。
 *              外部进程一律经 node-kit runProcess 数组传参（禁止 shell 字符串拼接）；
 *              静态服务器仅监听 127.0.0.1，生命周期跨页签保留在主进程。
 */
import { stat } from 'node:fs/promises'
import type { MainPluginContext, RegisterMain } from '@lumin/plugin-api'
import { runProcess, type RunProcessOptions, type RunProcessResult } from '@lumin/node-kit'
import type { ZodType } from 'zod'
import { errnoCode, isStructuredError, toolError } from './errors'
import {
  attachProcessNames,
  filterByPort,
  limitRows,
  parseNetstat,
  parseTasklist,
  sortRows
} from './netstat'
import { createStaticServer, type StaticServer } from './server'
import {
  DEFAULT_SERVER_PORT,
  MAX_PORT_ROWS,
  configResultSchema,
  portKillPayloadSchema,
  portKillResultSchema,
  portsQueryPayloadSchema,
  portsQueryResultSchema,
  serverStartPayloadSchema,
  serverStartResultSchema,
  serverStatusResultSchema,
  serverStopResultSchema,
  setConfigPayloadSchema,
  type ConfigResult,
  type PortKillResult,
  type PortsQueryPayload,
  type PortsQueryResult,
  type ServerStartResult,
  type ServerStatusResult,
  type ServerStopResult,
  type SetConfigPayload
} from './schema'

/** 设置键（工具命名空间 `tools.dev-toolbox.*` 下的键名，与 spec §4 一致） */
const KEY_ROOT = 'devToolboxRoot'
const KEY_PORT = 'devToolboxPort'

/** 外部命令输出上限（不依赖壳默认值，避免大 tasklist 截断） */
const MAX_OUTPUT_CHARS = 4 * 1024 * 1024
const PROCESS_TIMEOUT_MS = 15_000

/** 可注入依赖（测试替换外部进程与服务器实现） */
export interface DevToolboxDeps {
  runProcess(options: RunProcessOptions): Promise<RunProcessResult>
  ownPid: number
  killProcess(pid: number): Promise<void>
  createServer(root: string): StaticServer
}

/** 默认依赖：win32 的 netstat/tasklist/taskkill 与真实 http 服务器 */
export function createDefaultDeps(): DevToolboxDeps {
  return {
    runProcess: (options) => runProcess(options),
    ownPid: process.pid,
    killProcess: async (pid) => {
      const result = await runProcess({
        command: 'taskkill',
        args: ['/PID', String(pid), '/T', '/F'],
        timeoutMs: PROCESS_TIMEOUT_MS,
        encoding: 'gbk'
      })
      if (result.code !== 0) {
        throw toolError(
          'DT_KILL_FAILED',
          result.stderr.trim() || `taskkill 退出码 ${result.code ?? 'null'}`
        )
      }
    },
    createServer: (root) => createStaticServer(root)
  }
}

/** zod 校验：失败统一 DT_INVALID_PAYLOAD（取首条 issue 文案） */
function parseOrThrow<T>(schema: ZodType<T>, payload: unknown): T {
  const parsed = schema.safeParse(payload)
  if (!parsed.success) {
    throw toolError('DT_INVALID_PAYLOAD', parsed.error.issues[0]?.message ?? '参数无效')
  }
  return parsed.data
}

/** 端口查询入参：端口字段存在但不合法 → DT_INVALID_PORT，其余 → DT_INVALID_PAYLOAD */
function parsePortsQuery(payload: unknown): PortsQueryPayload {
  const parsed = portsQueryPayloadSchema.safeParse(payload ?? {})
  if (parsed.success) return parsed.data
  const rawPort =
    typeof payload === 'object' && payload !== null
      ? (payload as { port?: unknown }).port
      : undefined
  if (rawPort !== undefined) throw toolError('DT_INVALID_PORT')
  throw toolError('DT_INVALID_PAYLOAD', parsed.error.issues[0]?.message ?? '参数无效')
}

/** 读取进程名（失败仅留空，不影响端口列表） */
async function readProcessNames(deps: DevToolboxDeps): Promise<Map<number, string>> {
  try {
    const result = await deps.runProcess({
      command: 'tasklist',
      args: ['/FO', 'CSV', '/NH'],
      timeoutMs: PROCESS_TIMEOUT_MS,
      encoding: 'gbk',
      maxOutputChars: MAX_OUTPUT_CHARS
    })
    if (result.code !== 0 || result.timedOut) return new Map()
    return parseTasklist(result.stdout)
  } catch {
    return new Map()
  }
}

/** 执行 netstat（tcp + udp 并发）并解析 */
async function queryPortRows(
  deps: DevToolboxDeps,
  port: number | undefined
): Promise<{ rows: PortsQueryResult['rows']; truncated: boolean }> {
  const runNetstat = (protocol: 'tcp' | 'udp'): Promise<RunProcessResult> =>
    deps.runProcess({
      command: 'netstat',
      args: ['-ano', '-p', protocol],
      timeoutMs: PROCESS_TIMEOUT_MS,
      encoding: 'gbk',
      maxOutputChars: MAX_OUTPUT_CHARS
    })

  const [tcp, udp] = await Promise.all([runNetstat('tcp'), runNetstat('udp')])
  const failure = [tcp, udp].find((result) => result.code !== 0 || result.timedOut)
  if (failure !== undefined) {
    throw toolError('DT_NETSTAT_FAILED', failure.stderr.trim() || 'netstat 执行失败')
  }

  const names = await readProcessNames(deps)
  const merged = attachProcessNames(
    [...parseNetstat(tcp.stdout), ...parseNetstat(udp.stdout)],
    names
  )
  const sorted = sortRows(filterByPort(merged, port))
  return limitRows(sorted, MAX_PORT_ROWS)
}

/** 读取配置记忆（存量非法值回退默认） */
async function readConfig(ctx: MainPluginContext): Promise<ConfigResult> {
  const root: unknown = await ctx.settings.get<unknown>(KEY_ROOT, null)
  const port: unknown = await ctx.settings.get<unknown>(KEY_PORT, DEFAULT_SERVER_PORT)
  const parsed = configResultSchema.safeParse({
    root: typeof root === 'string' && root !== '' ? root : null,
    port
  })
  return parsed.success ? parsed.data : { root: null, port: DEFAULT_SERVER_PORT }
}

/**
 * 注册七通道（测试注入假 deps）
 * @param ctx 主进程插件上下文
 * @param deps 依赖（外部进程 + 服务器工厂）
 */
export function registerWith(ctx: MainPluginContext, deps: DevToolboxDeps): void {
  let server: StaticServer | null = null

  const stopServer = async (): Promise<void> => {
    if (server === null) return
    const current = server
    server = null
    await current.stop()
  }

  ctx.registerIpc('ports-query', async ({ payload }): Promise<PortsQueryResult> => {
    const parsed = parsePortsQuery(payload)
    const startedAt = Date.now()
    const { rows, truncated } = await queryPortRows(deps, parsed.port)
    return portsQueryResultSchema.parse({
      rows,
      truncated,
      elapsedMs: Date.now() - startedAt
    })
  })

  ctx.registerIpc('port-kill', async ({ payload }): Promise<PortKillResult> => {
    const parsed = parseOrThrow(portKillPayloadSchema, payload)
    if (parsed.pid <= 0 || parsed.pid === deps.ownPid) {
      throw toolError('DT_KILL_SELF_FORBIDDEN')
    }
    try {
      await deps.killProcess(parsed.pid)
    } catch (err) {
      if (isStructuredError(err)) throw err
      throw toolError('DT_KILL_FAILED', errnoCode(err))
    }
    return portKillResultSchema.parse({ ok: true })
  })

  ctx.registerIpc('server-start', async ({ payload }): Promise<ServerStartResult> => {
    const parsed = parseOrThrow(serverStartPayloadSchema, payload)
    let info
    try {
      info = await stat(parsed.root)
    } catch (err) {
      throw toolError('DT_ROOT_INVALID', errnoCode(err))
    }
    if (!info.isDirectory()) throw toolError('DT_ROOT_INVALID', '目标不是目录')

    await stopServer()
    const instance = deps.createServer(parsed.root)
    let actualPort: number
    try {
      actualPort = await instance.start(parsed.port)
    } catch (err) {
      if (isStructuredError(err)) throw err
      throw toolError('DT_SERVER_FAILED', errnoCode(err))
    }
    server = instance
    await ctx.settings.set(KEY_ROOT, parsed.root)
    await ctx.settings.set(KEY_PORT, parsed.port)
    return serverStartResultSchema.parse({
      running: true,
      port: actualPort,
      root: parsed.root
    })
  })

  ctx.registerIpc('server-stop', async (): Promise<ServerStopResult> => {
    await stopServer()
    return serverStopResultSchema.parse({ running: false })
  })

  ctx.registerIpc('server-status', async (): Promise<ServerStatusResult> => {
    if (server === null) return { running: false, requests: [] }
    return serverStatusResultSchema.parse(server.status())
  })

  ctx.registerIpc('config', async (): Promise<ConfigResult> => readConfig(ctx))

  ctx.registerIpc('set-config', async ({ payload }): Promise<ConfigResult> => {
    const parsed = parseOrThrow<SetConfigPayload>(setConfigPayloadSchema, payload)
    if (parsed.root !== undefined) await ctx.settings.set(KEY_ROOT, parsed.root)
    if (parsed.port !== undefined) await ctx.settings.set(KEY_PORT, parsed.port)
    return readConfig(ctx)
  })
}

/** 生产注册入口（壳 tool-mains.ts 调用；测试用 registerWith 注入假 deps） */
export const registerMain: RegisterMain = (ctx) => registerWith(ctx, createDefaultDeps())
