/**
 * @file 屏幕吸管（EyeDropper API）可用性检测与取消判定
 * @author cuilanchao
 * @date 2026-11-20
 * @description Chromium 的 EyeDropper 尚未收录进 TS lib.dom，这里给出最小类型并做运行时可检测；
 *              不依赖 DOM 具体实现，便于单测注入假对象。
 */

/** 吸管返回结果（sRGB 十六进制） */
export interface EyeDropperResult {
  readonly sRGBHex: string
}

/** 吸管实例 */
export interface EyeDropperLike {
  open: () => Promise<EyeDropperResult>
}

/** 吸管构造器 */
export interface EyeDropperConstructorLike {
  new (): EyeDropperLike
}

function readProperty(source: unknown, key: string): unknown {
  if (typeof source !== 'object' || source === null) return undefined
  return Reflect.get(source, key)
}

/**
 * 检测当前环境是否提供 EyeDropper 构造器
 * @param source 检测源（默认 globalThis；单测可注入假对象）
 * @returns 不可用时返回 null
 */
export function getEyeDropper(source: unknown = globalThis): EyeDropperConstructorLike | null {
  const ctor = readProperty(source, 'EyeDropper')
  return typeof ctor === 'function' ? (ctor as EyeDropperConstructorLike) : null
}

/**
 * 判断吸管是否由用户取消（按 Esc），取消不属于错误
 * @param error 吸管 open() 抛出的异常
 */
export function isEyedropperCancel(error: unknown): boolean {
  return readProperty(error, 'name') === 'AbortError'
}
