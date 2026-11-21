/**
 * @file CURL 命令解析与代码生成（纯 renderer，无 IPC）
 * @author cuilanchao
 * @date 2026-11-21
 * @description 支持 -X/-H/-d/-b/-A/-u/-I/--compressed/-k 与 URL 位置参数；
 *              其余以单/双连字符开头的参数一律报 DT_CURL_PARSE_FAILED（detail 指明参数名）
 */
import { toolError } from './errors'

/** 解析后的请求（method 已补齐缺省值） */
export interface CurlRequest {
  method: string
  url: string
  headers: [string, string][]
  body: string | null
  /** -k/--insecure：代码中仅以注释说明已忽略 */
  insecure: boolean
}

/** 输出目标 */
export type CurlTarget = 'fetch' | 'axios' | 'python'

/** 需要取值的参数 */
const VALUE_FLAGS = new Set([
  '-X',
  '--request',
  '-H',
  '--header',
  '-d',
  '--data',
  '--data-raw',
  '--data-binary',
  '-b',
  '--cookie',
  '-A',
  '--user-agent',
  '-u',
  '--user'
])

/** 无副作用忽略的参数 */
const IGNORED_FLAGS = new Set(['--compressed', '-k', '--insecure'])

/** BASE64 字母表（避免依赖 Buffer/btoa） */
const BASE64_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'

/** 解析失败（统一错误码；detail 说明具体原因） */
function parseError(detail: string): ReturnType<typeof toolError> {
  return toolError('DT_CURL_PARSE_FAILED', detail)
}

/**
 * 切分命令行：支持 `\` + 换行续行、单/双/无引号、`$'...'` 按普通单引号处理
 * @param input 原始 curl 命令文本
 */
export function tokenize(input: string): string[] {
  const text = input.replace(/\\\r?\n/g, ' ')
  const tokens: string[] = []
  let current = ''
  let hasToken = false
  let index = 0

  const flush = (): void => {
    if (!hasToken) return
    tokens.push(current)
    current = ''
    hasToken = false
  }

  while (index < text.length) {
    const char = text.charAt(index)

    if (char === ' ' || char === '\t' || char === '\n' || char === '\r') {
      flush()
      index += 1
      continue
    }

    if (char === "'") {
      const end = text.indexOf("'", index + 1)
      if (end === -1) throw parseError('引号未闭合')
      current += text.slice(index + 1, end)
      hasToken = true
      index = end + 1
      continue
    }

    if (char === '$' && text.charAt(index + 1) === "'") {
      const end = text.indexOf("'", index + 2)
      if (end === -1) throw parseError('引号未闭合')
      current += text.slice(index + 2, end)
      hasToken = true
      index = end + 1
      continue
    }

    if (char === '"') {
      hasToken = true
      let cursor = index + 1
      let closed = false
      while (cursor < text.length) {
        const inner = text.charAt(cursor)
        if (inner === '\\') {
          const next = text.charAt(cursor + 1)
          if (next === '') break
          current += next === '"' || next === '\\' ? next : `\\${next}`
          cursor += 2
          continue
        }
        if (inner === '"') {
          closed = true
          cursor += 1
          break
        }
        current += inner
        cursor += 1
      }
      if (!closed) throw parseError('引号未闭合')
      index = cursor
      continue
    }

    if (char === '\\') {
      const next = text.charAt(index + 1)
      if (next === '') {
        index += 1
        continue
      }
      current += next
      hasToken = true
      index += 2
      continue
    }

    current += char
    hasToken = true
    index += 1
  }

  flush()
  return tokens
}

/** 解析 `Name: Value` 形式的请求头 */
function parseHeader(value: string): [string, string] {
  const index = value.indexOf(':')
  if (index <= 0) throw parseError(`请求头格式无效：${value}`)
  return [value.slice(0, index).trim(), value.slice(index + 1).trim()]
}

/** Base64（UTF-8）编码（用于 -u 的 Authorization: Basic） */
function base64EncodeUtf8(value: string): string {
  const bytes = new TextEncoder().encode(value)
  let output = ''
  for (let index = 0; index < bytes.length; index += 3) {
    const first = bytes[index] ?? 0
    const second = bytes[index + 1]
    const third = bytes[index + 2]
    output += BASE64_ALPHABET.charAt(first >> 2)
    output += BASE64_ALPHABET.charAt(((first & 0x03) << 4) | ((second ?? 0) >> 4))
    output +=
      second === undefined
        ? '='
        : BASE64_ALPHABET.charAt(((second & 0x0f) << 2) | ((third ?? 0) >> 6))
    output += third === undefined ? '=' : BASE64_ALPHABET.charAt(third & 0x3f)
  }
  return output
}

/** 解析过程中的可变累积器 */
interface Accumulator {
  method?: string
  url?: string
  headers: [string, string][]
  dataParts: string[]
  cookie?: string
  userAgent?: string
  user?: string
  head: boolean
  insecure: boolean
}

/** 应用带值参数 */
function applyValue(acc: Accumulator, flag: string, value: string): void {
  switch (flag) {
    case '-X':
    case '--request':
      acc.method = value.toUpperCase()
      return
    case '-H':
    case '--header':
      acc.headers.push(parseHeader(value))
      return
    case '-d':
    case '--data':
    case '--data-raw':
    case '--data-binary':
      acc.dataParts.push(value)
      return
    case '-b':
    case '--cookie':
      acc.cookie = value
      return
    case '-A':
    case '--user-agent':
      acc.userAgent = value
      return
    case '-u':
    case '--user':
      acc.user = value
      return
    default:
      throw parseError(`暂不支持的参数：${flag}`)
  }
}

/**
 * 解析 curl 命令
 * @param input 原始命令文本
 */
export function parseCurl(input: string): CurlRequest {
  const tokens = tokenize(input)
  if (tokens.length === 0) throw parseError('请输入 curl 命令')

  const acc: Accumulator = {
    headers: [],
    dataParts: [],
    head: false,
    insecure: false
  }

  const first = tokens[0]
  const start = first !== undefined && /^curl(\.exe)?$/i.test(first) ? 1 : 0

  for (let index = start; index < tokens.length; index += 1) {
    const token = tokens[index]
    if (token === undefined) continue

    if (token.startsWith('-')) {
      if (token === '-I' || token === '--head') {
        acc.head = true
        continue
      }
      if (IGNORED_FLAGS.has(token)) {
        if (token === '-k' || token === '--insecure') acc.insecure = true
        continue
      }
      if (VALUE_FLAGS.has(token)) {
        const value = tokens[index + 1]
        if (value === undefined) throw parseError(`参数 ${token} 缺少取值`)
        applyValue(acc, token, value)
        index += 1
        continue
      }
      throw parseError(`暂不支持的参数：${token}`)
    }

    if (acc.url === undefined) acc.url = token
  }

  if (acc.url === undefined || acc.url === '') throw parseError('缺少 URL')

  const headers = [...acc.headers]
  if (acc.cookie !== undefined) headers.push(['Cookie', acc.cookie])
  if (acc.userAgent !== undefined) headers.push(['User-Agent', acc.userAgent])
  if (acc.user !== undefined) {
    headers.push(['Authorization', `Basic ${base64EncodeUtf8(acc.user)}`])
  }

  const body = acc.dataParts.length > 0 ? acc.dataParts.join('&') : null
  const method =
    acc.method !== undefined && acc.method !== ''
      ? acc.method
      : acc.head
        ? 'HEAD'
        : body === null
          ? 'GET'
          : 'POST'

  return {
    method,
    url: acc.url,
    headers,
    body,
    insecure: acc.insecure
  }
}

/** 单引号字符串转义（JS / Python 共用） */
function quoted(value: string): string {
  const escaped = value
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\\'")
    .replace(/\r/g, '\\r')
    .replace(/\n/g, '\\n')
  return `'${escaped}'`
}

/** fetch 代码 */
function generateFetch(request: CurlRequest): string {
  const lines: string[] = []
  if (request.insecure) lines.push('// 已忽略 -k/--insecure：Node 默认校验证书')
  lines.push(`const response = await fetch(${quoted(request.url)}, {`)
  lines.push(`  method: ${quoted(request.method)},`)
  if (request.headers.length > 0) {
    lines.push('  headers: {')
    for (const [name, value] of request.headers) {
      lines.push(`    ${quoted(name)}: ${quoted(value)},`)
    }
    lines.push('  },')
  }
  if (request.body !== null) lines.push(`  body: ${quoted(request.body)},`)
  lines.push('})')
  lines.push('const text = await response.text()')
  return lines.join('\n')
}

/** axios 代码 */
function generateAxios(request: CurlRequest): string {
  const lines: string[] = []
  if (request.insecure) lines.push('// 已忽略 -k/--insecure：请按需配置 httpsAgent')
  lines.push('const response = await axios({')
  lines.push(`  url: ${quoted(request.url)},`)
  lines.push(`  method: ${quoted(request.method)},`)
  if (request.headers.length > 0) {
    lines.push('  headers: {')
    for (const [name, value] of request.headers) {
      lines.push(`    ${quoted(name)}: ${quoted(value)},`)
    }
    lines.push('  },')
  }
  if (request.body !== null) lines.push(`  data: ${quoted(request.body)},`)
  lines.push('})')
  return lines.join('\n')
}

/** python（requests）代码 */
function generatePython(request: CurlRequest): string {
  const lines: string[] = []
  if (request.insecure) lines.push('# 已忽略 -k/--insecure：请按需传入 verify=False')
  lines.push('import requests')
  lines.push('')
  lines.push('response = requests.request(')
  lines.push(`    ${quoted(request.method)},`)
  lines.push(`    ${quoted(request.url)},`)
  if (request.headers.length > 0) {
    lines.push('    headers={')
    for (const [name, value] of request.headers) {
      lines.push(`        ${quoted(name)}: ${quoted(value)},`)
    }
    lines.push('    },')
  }
  if (request.body !== null) lines.push(`    data=${quoted(request.body)},`)
  lines.push(')')
  lines.push('print(response.text)')
  return lines.join('\n')
}

/**
 * 按目标语言生成代码
 * @param request 解析结果
 * @param target 输出目标
 */
export function generateCode(request: CurlRequest, target: CurlTarget): string {
  if (target === 'axios') return generateAxios(request)
  if (target === 'python') return generatePython(request)
  return generateFetch(request)
}

/**
 * 解析 + 生成（renderer 一步调用）
 * @param input curl 命令
 * @param target 输出目标
 */
export function convertCurl(input: string, target: CurlTarget): string {
  return generateCode(parseCurl(input), target)
}
