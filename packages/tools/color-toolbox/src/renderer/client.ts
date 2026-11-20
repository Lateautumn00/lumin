/**
 * @file color-toolbox renderer 类型化 invoke 封装（AGENTS §6：renderer 只经 window.lumin 白名单 bridge）
 * @author cuilanchao
 * @date 2026-11-20
 * @description 整屏截图取色通道，入参/回包类型来自 schema.ts
 */
import type { CaptureDisplayPayload, CaptureDisplayResult } from '../schema'

/** 截取显示器画面用于取色（缺省 displayId = 当前窗口所在显示器） */
export function captureDisplay(payload: CaptureDisplayPayload): Promise<CaptureDisplayResult> {
  return window.lumin.invoke<CaptureDisplayResult>('color-toolbox:capture-display', payload)
}
