import { describe, expect, it } from 'vitest'

import { getEyeDropper, isEyedropperCancel } from './eyedropper'

describe('getEyeDropper', () => {
  it('存在构造器时返回', () => {
    class FakeEyeDropper {
      open(): Promise<{ sRGBHex: string }> {
        return Promise.resolve({ sRGBHex: '#123456' })
      }
    }
    expect(getEyeDropper({ EyeDropper: FakeEyeDropper })).toBe(FakeEyeDropper)
  })

  it('缺失或非函数时返回 null', () => {
    expect(getEyeDropper({})).toBeNull()
    expect(getEyeDropper({ EyeDropper: 'yes' })).toBeNull()
    expect(getEyeDropper(null)).toBeNull()
    expect(getEyeDropper(undefined)).toBeNull()
  })
})

describe('isEyedropperCancel', () => {
  it('识别 AbortError（用户按 Esc）', () => {
    expect(isEyedropperCancel({ name: 'AbortError' })).toBe(true)
    expect(isEyedropperCancel({ name: 'NotSupportedError' })).toBe(false)
    expect(isEyedropperCancel(null)).toBe(false)
    expect(isEyedropperCancel('AbortError')).toBe(false)
  })
})
