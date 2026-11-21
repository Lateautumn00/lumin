/**
 * @file schema.ts 单测：七通道入参/出参边界
 * @author cuilanchao
 * @date 2026-11-21
 */
import { describe, expect, it } from 'vitest'
import {
  configResultSchema,
  emptyPayloadSchema,
  portRowSchema,
  portsQueryPayloadSchema,
  serverStartPayloadSchema,
  serverStatusResultSchema,
  setConfigPayloadSchema
} from './schema'

describe('portsQueryPayloadSchema', () => {
  it('缺省端口合法', () => {
    expect(portsQueryPayloadSchema.safeParse({}).success).toBe(true)
  })

  it('1..65535 整数合法', () => {
    expect(portsQueryPayloadSchema.safeParse({ port: 80 }).success).toBe(true)
    expect(portsQueryPayloadSchema.safeParse({ port: 65535 }).success).toBe(true)
  })

  it('0/70000/小数/字符串非法', () => {
    expect(portsQueryPayloadSchema.safeParse({ port: 0 }).success).toBe(false)
    expect(portsQueryPayloadSchema.safeParse({ port: 70000 }).success).toBe(false)
    expect(portsQueryPayloadSchema.safeParse({ port: 1.5 }).success).toBe(false)
    expect(portsQueryPayloadSchema.safeParse({ port: '80' }).success).toBe(false)
  })
})

describe('serverStartPayloadSchema', () => {
  it('根目录 + 端口必填', () => {
    expect(serverStartPayloadSchema.safeParse({ root: 'C:\\site', port: 8080 }).success).toBe(true)
    expect(serverStartPayloadSchema.safeParse({ root: '', port: 8080 }).success).toBe(false)
    expect(serverStartPayloadSchema.safeParse({ root: 'C:\\site' }).success).toBe(false)
    expect(serverStartPayloadSchema.safeParse({ root: 'C:\\site', port: 0 }).success).toBe(false)
  })
})

describe('portRowSchema', () => {
  const row = {
    protocol: 'TCP',
    localAddress: '0.0.0.0',
    port: 80,
    state: 'LISTENING',
    pid: 1,
    process: ''
  }

  it('合法行通过', () => {
    expect(portRowSchema.safeParse(row).success).toBe(true)
  })

  it('协议只能是 TCP/UDP，PID 非负', () => {
    expect(portRowSchema.safeParse({ ...row, protocol: 'ICMP' }).success).toBe(false)
    expect(portRowSchema.safeParse({ ...row, pid: -1 }).success).toBe(false)
  })
})

describe('配置与状态 schema', () => {
  it('configResult 允许 root 为 null', () => {
    expect(configResultSchema.safeParse({ root: null, port: 8080 }).success).toBe(true)
    expect(configResultSchema.safeParse({ root: '', port: 8080 }).success).toBe(false)
  })

  it('setConfig 允许 root=null 与部分字段', () => {
    expect(setConfigPayloadSchema.safeParse({ root: null }).success).toBe(true)
    expect(setConfigPayloadSchema.safeParse({ port: 3000 }).success).toBe(true)
    expect(setConfigPayloadSchema.safeParse({ port: 70000 }).success).toBe(false)
  })

  it('serverStatus 运行中可带 port/root，未运行可省略', () => {
    expect(serverStatusResultSchema.safeParse({ running: false, requests: [] }).success).toBe(true)
    expect(
      serverStatusResultSchema.safeParse({
        running: true,
        port: 8080,
        root: 'C:\\site',
        requests: [{ time: 1, method: 'GET', path: '/', status: 200, bytes: 10 }]
      }).success
    ).toBe(true)
  })

  it('emptyPayload 允许 undefined', () => {
    expect(emptyPayloadSchema.safeParse(undefined).success).toBe(true)
  })
})
