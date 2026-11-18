import { spawn } from 'node:child_process'

export interface RunProcessOptions {
  command: string
  args?: readonly string[]
  cwd?: string
  /** 超时后杀进程树并以 timedOut 返回；不设则不限时 */
  timeoutMs?: number
  /** 外部取消（如任务队列 abort）；触发后杀进程树并以 aborted 返回 */
  signal?: AbortSignal
  env?: NodeJS.ProcessEnv
  /** 单流捕获上限（字符），超长截断保头，默认 256KB */
  maxOutputChars?: number
  /**
   * stdout/stderr 解码编码，默认 utf8。
   * Windows 系统命令（如 reg query）输出 OEM/ANSI 代码页（zh-CN 为 GBK），
   * 须显式指定 'gbk' 才能得到正确文本（Electron/Node 全量 ICU 支持）。
   */
  encoding?: 'utf8' | 'gbk'
  /**
   * 流式行回调（可选）：解码后按换行切分逐行推送（含行内容、不含换行符）。
   * 进度类外部程序（如 yt-dlp）需要边跑边解析输出时使用；
   * 回调抛错不中断进程捕获，异常仅透传给 close 后的 resolve 流程外。
   */
  onStdoutLine?: (line: string) => void
  onStderrLine?: (line: string) => void
}

export interface RunProcessResult {
  code: number | null
  signal: NodeJS.Signals | null
  stdout: string
  stderr: string
  timedOut: boolean
  aborted: boolean
  /** 输出因超过 maxOutputChars 被截断 */
  truncated: boolean
}

export class SpawnError extends Error {
  override readonly name = 'SpawnError'
  constructor(
    message: string,
    readonly command: string,
    override readonly cause?: unknown
  ) {
    super(message)
  }
}

const DEFAULT_MAX_OUTPUT_CHARS = 256 * 1024

function killTree(pid: number): void {
  if (process.platform === 'win32') {
    const killer = spawn('taskkill', ['/pid', String(pid), '/T', '/F'], {
      stdio: 'ignore',
      windowsHide: true
    })
    // taskkill 自身失败不致命（进程可能已退出）
    killer.on('error', () => undefined)
  } else {
    try {
      process.kill(-pid, 'SIGKILL')
    } catch {
      try {
        process.kill(pid, 'SIGKILL')
      } catch {
        // 进程已退出
      }
    }
  }
}

/**
 * spawn 子进程：捕获 stdout/stderr，支持超时与 AbortSignal 取消（杀进程树）。
 * 仅 spawn 失败（ENOENT 等）抛 SpawnError；非零退出码属正常结果由调用方判定。
 */
export function runProcess(options: RunProcessOptions): Promise<RunProcessResult> {
  const {
    command,
    args = [],
    cwd,
    timeoutMs,
    signal,
    env,
    maxOutputChars = DEFAULT_MAX_OUTPUT_CHARS,
    encoding = 'utf8',
    onStdoutLine,
    onStderrLine
  } = options

  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      resolve({
        code: null,
        signal: null,
        stdout: '',
        stderr: '',
        timedOut: false,
        aborted: true,
        truncated: false
      })
      return
    }

    const child = spawn(command, [...args], {
      cwd,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true
    })

    let stdout = ''
    let stderr = ''
    let truncated = false
    let timedOut = false
    let aborted = false
    let settled = false

    // gbk 走流式解码（多字节字符可能跨 chunk 边界）；utf8 沿用 Buffer.toString
    // 类型随各编译程序的全局 TextDecoder 推断（DOM 与 node:util 定义不一致，禁显式注解）
    const outDecoder = encoding === 'gbk' ? new TextDecoder('gbk') : null
    const errDecoder = encoding === 'gbk' ? new TextDecoder('gbk') : null
    const decodeChunk = (decoder: typeof outDecoder, chunk: Buffer): string =>
      decoder === null ? chunk.toString('utf8') : decoder.decode(chunk, { stream: true })

    const append = (current: string, text: string): string => {
      if (current.length >= maxOutputChars) {
        truncated = true
        return current
      }
      const room = maxOutputChars - current.length
      if (text.length > room) {
        truncated = true
        return current + text.slice(0, room)
      }
      return current + text
    }

    // 流式行切分：按 \r?\n 分段，尾部残行缓存到下一 chunk（\r\n 分隔符按行尾处理）
    const makeLineSplitter = (onLine: (line: string) => void): ((text: string) => void) => {
      let rest = ''
      return (text: string): void => {
        const combined = rest + text
        const parts = combined.split(/\r\n|\n|\r/)
        rest = parts.pop() ?? ''
        for (const line of parts) onLine(line)
      }
    }
    const splitOut = onStdoutLine === undefined ? null : makeLineSplitter(onStdoutLine)
    const splitErr = onStderrLine === undefined ? null : makeLineSplitter(onStderrLine)

    const flushLine = (
      split: ((text: string) => void) | null,
      decoder: typeof outDecoder,
      chunk: Buffer
    ): string => {
      const text = decodeChunk(decoder, chunk)
      if (split !== null) split(text)
      return text
    }

    child.stdout?.on('data', (chunk: Buffer) => {
      stdout = append(stdout, flushLine(splitOut, outDecoder, chunk))
    })
    child.stderr?.on('data', (chunk: Buffer) => {
      stderr = append(stderr, flushLine(splitErr, errDecoder, chunk))
    })

    let timer: NodeJS.Timeout | undefined
    if (timeoutMs !== undefined) {
      timer = setTimeout(() => {
        timedOut = true
        if (child.pid !== undefined) killTree(child.pid)
      }, timeoutMs)
    }

    const onAbort = (): void => {
      aborted = true
      if (child.pid !== undefined) killTree(child.pid)
    }
    signal?.addEventListener('abort', onAbort, { once: true })

    const cleanup = (): void => {
      if (timer !== undefined) clearTimeout(timer)
      signal?.removeEventListener('abort', onAbort)
    }

    child.on('error', (err) => {
      if (settled) return
      settled = true
      cleanup()
      reject(new SpawnError(`进程启动失败：${command}`, command, err))
    })

    child.on('close', (code, sig) => {
      if (settled) return
      settled = true
      cleanup()
      resolve({
        code,
        signal: sig,
        stdout,
        stderr,
        timedOut,
        aborted,
        truncated
      })
    })
  })
}
