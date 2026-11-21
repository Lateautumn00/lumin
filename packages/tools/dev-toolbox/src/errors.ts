/**
 * @file 工具错误码（UPPER_SNAKE；文案见 docs/spec/dev-toolbox.md，改动须同步 spec）
 * @author cuilanchao
 * @date 2026-11-21
 * @description dev-toolbox 专属结构化错误：构造、重试判定与共享工具委托
 */
import {
  errnoCode as sharedErrnoCode,
  isStructuredError as sharedIsStructuredError,
  type StructuredError
} from '@lumin/shared'

/** 错误码全集（spec §1–§3）；取消由壳统一 `CANCELLED`，不单列 */
export const DEV_TOOLBOX_ERROR_CODES = [
  'DT_INVALID_PAYLOAD',
  'DT_INVALID_PORT',
  'DT_NETSTAT_FAILED',
  'DT_KILL_FAILED',
  'DT_KILL_SELF_FORBIDDEN',
  'DT_CURL_PARSE_FAILED',
  'DT_ROOT_INVALID',
  'DT_PORT_IN_USE',
  'DT_SERVER_FAILED'
] as const

export type DevToolboxErrorCode = (typeof DEV_TOOLBOX_ERROR_CODES)[number]

/** 错误码 → 中文文案（renderer 展示；spec 同源） */
const MESSAGES: Record<DevToolboxErrorCode, string> = {
  DT_INVALID_PAYLOAD: '参数无效',
  DT_INVALID_PORT: '端口号须为 1–65535 的整数',
  DT_NETSTAT_FAILED: '查询端口占用失败',
  DT_KILL_FAILED: '结束进程失败（可能已退出或无权限）',
  DT_KILL_SELF_FORBIDDEN: '不能结束本程序进程',
  DT_CURL_PARSE_FAILED: 'CURL 命令解析失败',
  DT_ROOT_INVALID: '根目录无效（不存在或不是目录）',
  DT_PORT_IN_USE: '端口已被占用',
  DT_SERVER_FAILED: '启动静态服务器失败'
}

/** 可重试错误码（renderer 据此显示 [重试]） */
const RETRYABLE = new Set<DevToolboxErrorCode>([
  'DT_NETSTAT_FAILED',
  'DT_KILL_FAILED',
  'DT_ROOT_INVALID',
  'DT_PORT_IN_USE',
  'DT_SERVER_FAILED'
])

/**
 * 构造结构化错误（detail 缺省时不带字段）
 * @param code 工具错误码
 * @param detail 可选技术细节（errno 等）
 */
export function toolError(code: DevToolboxErrorCode, detail?: string): StructuredError {
  const message = MESSAGES[code]
  return detail === undefined || detail === '' ? { code, message } : { code, message, detail }
}

/**
 * 判断错误码是否可重试
 * @param code 结构化错误码字符串
 */
export function isRetryable(code: string): boolean {
  return RETRYABLE.has(code as DevToolboxErrorCode)
}

/** 取错误中文文案（未知码回退通用文案） */
export function errorMessage(code: string): string {
  return MESSAGES[code as DevToolboxErrorCode] ?? '操作失败'
}

/** 判断抛出物是否已是结构化错误（委托 `@lumin/shared` 单一真相源） */
export const isStructuredError = sharedIsStructuredError

/** 从任意错误取 errno 码（如 EADDRINUSE），无则空串（委托 `@lumin/shared`） */
export const errnoCode = sharedErrnoCode
