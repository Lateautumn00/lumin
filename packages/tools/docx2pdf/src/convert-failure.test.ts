/**
 * @file convert-failure 单测：转换失败归类（仅主进程）
 * @author cuilanchao
 * @date 2026-11-25
 * @description 校验 stderr 归类：源文件无法加载 → INPUT_LOAD_FAILED，其余 → CONVERT_FAILED。
 */
import { describe, expect, it } from 'vitest'
import { convertFailureCode } from './convert-failure'

describe('convertFailureCode', () => {
  it('源文件无法加载 → INPUT_LOAD_FAILED，其余 → CONVERT_FAILED', () => {
    expect(convertFailureCode('source file could not be loaded')).toBe('INPUT_LOAD_FAILED')
    expect(convertFailureCode('segfault at ...')).toBe('CONVERT_FAILED')
  })
})
