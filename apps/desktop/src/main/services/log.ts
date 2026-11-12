import log from 'electron-log'
import type { ToolLogger } from '@lumin/plugin-api'

export function initLog(): void {
  log.transports.file.level = 'info'
  log.transports.file.maxSize = 5 * 1024 * 1024
  log.transports.file.format = '{y}-{m}-{d} {h}:{i}:{s}.{ms} [{level}] {scope} {text}'
}

export function getLogFilePath(): string {
  return log.transports.file.getFile().path
}

export function createRootLogger(): ToolLogger {
  return {
    debug: (message, ...meta) => log.debug(message, ...meta),
    info: (message, ...meta) => log.info(message, ...meta),
    warn: (message, ...meta) => log.warn(message, ...meta),
    error: (message, ...meta) => log.error(message, ...meta)
  }
}

export function createToolLogger(toolId: string): ToolLogger {
  const scope = log.scope(toolId)
  return {
    debug: (message, ...meta) => scope.debug(message, ...meta),
    info: (message, ...meta) => scope.info(message, ...meta),
    warn: (message, ...meta) => scope.warn(message, ...meta),
    error: (message, ...meta) => scope.error(message, ...meta)
  }
}
