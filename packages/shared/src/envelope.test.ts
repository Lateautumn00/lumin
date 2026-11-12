import { describe, expect, it } from 'vitest'
import {
  channelSchema,
  invokeRequestSchema,
  invokeResponseSchema,
  makeError,
  structuredErrorSchema,
  submitResultSchema,
  taskEventSchema,
  taskUpdateSchema,
  toStructuredError
} from './envelope'

describe('channelSchema', () => {
  it('接受两段与多段通道', () => {
    expect(channelSchema.safeParse('example:ping').success).toBe(true)
    expect(channelSchema.safeParse('lumin:settings:get').success).toBe(true)
  })

  it('拒绝缺冒号/大写/空段/首字符非法', () => {
    for (const bad of ['example', 'Example:ping', 'example:', ':ping', 'example:Ping', '']) {
      expect(channelSchema.safeParse(bad).success).toBe(false)
    }
  })
})

describe('structuredErrorSchema', () => {
  it('接受 UPPER_SNAKE 错误码', () => {
    expect(
      structuredErrorSchema.safeParse({ code: 'FILE_LOCKED', message: '文件被占用' }).success
    ).toBe(true)
  })

  it('拒绝小写码与空消息', () => {
    expect(structuredErrorSchema.safeParse({ code: 'file_locked', message: 'x' }).success).toBe(
      false
    )
    expect(structuredErrorSchema.safeParse({ code: 'OK', message: '' }).success).toBe(false)
  })
})

describe('makeError', () => {
  it('构造无 detail 的错误', () => {
    expect(makeError('CANCELLED', '已取消')).toEqual({ code: 'CANCELLED', message: '已取消' })
  })

  it('构造带 detail 的错误', () => {
    expect(makeError('TIMEOUT', '超时', '60s')).toEqual({
      code: 'TIMEOUT',
      message: '超时',
      detail: '60s'
    })
  })
})

describe('toStructuredError', () => {
  it('透传已合规的结构化错误', () => {
    const err = makeError('BUSY', '忙碌')
    expect(toStructuredError(err)).toEqual(err)
  })

  it('Error 归一为 INTERNAL', () => {
    expect(toStructuredError(new Error('炸了'))).toEqual({ code: 'INTERNAL', message: '炸了' })
  })

  it('其它值归一为 INTERNAL', () => {
    expect(toStructuredError('oops')).toEqual({ code: 'INTERNAL', message: 'oops' })
    expect(toStructuredError(42)).toEqual({ code: 'INTERNAL', message: '42' })
  })
})

describe('invokeRequestSchema', () => {
  it('接受合法请求', () => {
    expect(
      invokeRequestSchema.safeParse({ channel: 'example:ping', payload: { a: 1 } }).success
    ).toBe(true)
    expect(invokeRequestSchema.safeParse({ channel: 'example:ping' }).success).toBe(true)
  })

  it('拒绝非法通道', () => {
    expect(invokeRequestSchema.safeParse({ channel: 'bad' }).success).toBe(false)
  })
})

describe('invokeResponseSchema', () => {
  it('成功与失败信封均可校验', () => {
    expect(invokeResponseSchema.safeParse({ ok: true, data: 42 }).success).toBe(true)
    expect(
      invokeResponseSchema.safeParse({ ok: false, error: makeError('INTERNAL', 'x') }).success
    ).toBe(true)
  })

  it('拒绝 ok 非布尔字面量与非法错误形状', () => {
    expect(invokeResponseSchema.safeParse({ ok: 'true' }).success).toBe(false)
    expect(invokeResponseSchema.safeParse({ ok: true }).success).toBe(true)
    expect(
      invokeResponseSchema.safeParse({ ok: false, error: { code: 'x', message: 'x' } }).success
    ).toBe(false)
    expect(
      invokeResponseSchema.safeParse({ ok: false, error: { code: 'X', message: '' } }).success
    ).toBe(false)
  })
})

describe('submitResultSchema', () => {
  it('要求非空 taskId', () => {
    expect(submitResultSchema.safeParse({ taskId: 't-1' }).success).toBe(true)
    expect(submitResultSchema.safeParse({ taskId: '' }).success).toBe(false)
    expect(submitResultSchema.safeParse({}).success).toBe(false)
  })
})

describe('taskUpdateSchema', () => {
  it('progress 更新（可省 total/message）', () => {
    expect(taskUpdateSchema.safeParse({ kind: 'progress', current: 1 }).success).toBe(true)
    expect(
      taskUpdateSchema.safeParse({ kind: 'progress', current: 1, total: 10, message: '处理中' })
        .success
    ).toBe(true)
  })

  it('log 更新', () => {
    expect(taskUpdateSchema.safeParse({ kind: 'log', message: '开始' }).success).toBe(true)
  })

  it('拒绝负数与未知 kind', () => {
    expect(taskUpdateSchema.safeParse({ kind: 'progress', current: -1 }).success).toBe(false)
    expect(taskUpdateSchema.safeParse({ kind: 'done' }).success).toBe(false)
  })
})

describe('taskEventSchema', () => {
  it('done 事件可带可不带 result', () => {
    expect(taskEventSchema.safeParse({ kind: 'done', taskId: 't-1' }).success).toBe(true)
    expect(
      taskEventSchema.safeParse({ kind: 'done', taskId: 't-1', result: { file: 'a.pdf' } }).success
    ).toBe(true)
  })

  it('error 事件必须带结构化错误', () => {
    expect(
      taskEventSchema.safeParse({
        kind: 'error',
        taskId: 't-1',
        error: makeError('TIMEOUT', '超时')
      }).success
    ).toBe(true)
    expect(taskEventSchema.safeParse({ kind: 'error', taskId: 't-1' }).success).toBe(false)
  })

  it('progress/log 事件必须带 taskId', () => {
    expect(taskEventSchema.safeParse({ kind: 'progress', current: 0 }).success).toBe(false)
    expect(taskEventSchema.safeParse({ kind: 'log', message: 'x' }).success).toBe(false)
  })
})
