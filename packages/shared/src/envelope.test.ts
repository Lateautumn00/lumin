import { describe, expect, it } from 'vitest'
import {
  channelSchema,
  errnoCode,
  invokeRequestSchema,
  invokeResponseSchema,
  isStructuredError,
  makeError,
  structuredErrorSchema,
  submitResultSchema,
  taskEventSchema,
  taskUpdateSchema,
  toStructuredError,
  updateEventSchema
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

  it('带 errno 码的 Error 不冒充结构化错误码', () => {
    const fsErr = Object.assign(new Error('EPERM: operation not permitted'), { code: 'EPERM' })
    expect(toStructuredError(fsErr)).toEqual({
      code: 'INTERNAL',
      message: 'EPERM: operation not permitted'
    })
  })

  it('其它值归一为 INTERNAL', () => {
    expect(toStructuredError('oops')).toEqual({ code: 'INTERNAL', message: 'oops' })
    expect(toStructuredError(42)).toEqual({ code: 'INTERNAL', message: '42' })
  })
})

describe('isStructuredError', () => {
  it('接受合规 plain object 结构化错误', () => {
    expect(isStructuredError(makeError('BUSY', '忙碌'))).toBe(true)
    expect(isStructuredError({ code: 'PDF_ENCRYPTED', message: '加密', detail: 'x' })).toBe(true)
  })

  it('Error 实例一票否决（即使形状合规）', () => {
    const err = Object.assign(new Error('msg'), { code: 'EBUSY', message: 'x' })
    expect(isStructuredError(err)).toBe(false)
    expect(isStructuredError(new Error('x'))).toBe(false)
  })

  it('拒绝 errno 码 object、非法码形与非对象', () => {
    expect(isStructuredError(Object.assign(new Error('e'), { code: 'EPERM' }))).toBe(false)
    expect(isStructuredError({ code: 'file_locked', message: 'x' })).toBe(false)
    expect(isStructuredError({ code: 'OK', message: '' })).toBe(false)
    expect(isStructuredError({ code: 'X' })).toBe(false)
    expect(isStructuredError(null)).toBe(false)
    expect(isStructuredError('CODE')).toBe(false)
  })
})

describe('errnoCode', () => {
  it('从带 code 的错误对象取 errno 码', () => {
    expect(errnoCode(Object.assign(new Error('e'), { code: 'EBUSY' }))).toBe('EBUSY')
    expect(errnoCode({ code: 'ENOENT' })).toBe('ENOENT')
  })

  it('无 code / code 非字符串 / 非对象返回空串', () => {
    expect(errnoCode(new Error('e'))).toBe('')
    expect(errnoCode({ code: 42 })).toBe('')
    expect(errnoCode(null)).toBe('')
    expect(errnoCode(undefined)).toBe('')
    expect(errnoCode('EPERM')).toBe('')
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
  it('progress 更新（可省 total/message/stage）', () => {
    expect(taskUpdateSchema.safeParse({ kind: 'progress', current: 1 }).success).toBe(true)
    expect(
      taskUpdateSchema.safeParse({ kind: 'progress', current: 1, total: 10, message: '处理中' })
        .success
    ).toBe(true)
    expect(
      taskUpdateSchema.safeParse({ kind: 'progress', current: 0, stage: 'locate' }).success
    ).toBe(true)
    expect(taskUpdateSchema.safeParse({ kind: 'progress', current: 1, stage: '' }).success).toBe(
      false
    )
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

describe('updateEventSchema', () => {
  it('接受全六种事件', () => {
    expect(updateEventSchema.safeParse({ kind: 'checking' }).success).toBe(true)
    expect(updateEventSchema.safeParse({ kind: 'available', version: '1.0.1' }).success).toBe(true)
    expect(updateEventSchema.safeParse({ kind: 'not-available' }).success).toBe(true)
    expect(updateEventSchema.safeParse({ kind: 'downloading', percent: 42.5 }).success).toBe(true)
    expect(updateEventSchema.safeParse({ kind: 'downloaded', version: '1.0.1' }).success).toBe(true)
    expect(
      updateEventSchema.safeParse({
        kind: 'error',
        error: { code: 'INTERNAL', message: '网络失败' }
      }).success
    ).toBe(true)
  })

  it('拒绝越界 percent / 缺失字段 / 未知 kind', () => {
    expect(updateEventSchema.safeParse({ kind: 'downloading', percent: -1 }).success).toBe(false)
    expect(updateEventSchema.safeParse({ kind: 'downloading', percent: 101 }).success).toBe(false)
    expect(updateEventSchema.safeParse({ kind: 'available' }).success).toBe(false)
    expect(updateEventSchema.safeParse({ kind: 'installed' }).success).toBe(false)
  })
})
