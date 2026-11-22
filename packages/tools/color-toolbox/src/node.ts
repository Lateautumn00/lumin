/**
 * @file node.ts 颜色工具箱主进程通道（整屏截图取色）
 * @author cuilanchao
 * @date 2026-11-20
 * @description 单通道 capture-display：desktopCapturer 截取所选显示器 → PNG dataURL 回包。
 *              Electron 能力由 createNodeDeps 组装，测试注入假 deps（不触达真实屏幕）。
 */
import { BrowserWindow, desktopCapturer, screen } from 'electron'
import type { MainPluginContext, RegisterMain } from '@lumin/plugin-api'
import { captureDisplay, type ScreenCaptureDeps, type ScreenDisplayInfo } from '@lumin/node-kit'
import { isStructuredError, toStructuredError } from '@lumin/shared'
import { toolError } from './errors'
import {
  captureDisplayPayloadSchema,
  captureDisplayResultSchema,
  type CaptureDisplayResult
} from './schema'

/** 截图通道动作名（完整通道 = color-toolbox:capture-display） */
const CAPTURE_ACTION = 'capture-display'

export type { CaptureSourceInfo, CapturedThumbnail, ScreenCaptureDeps } from '@lumin/node-kit'
export type DisplayInfo = ScreenDisplayInfo
export { selectDisplay } from '@lumin/node-kit'

/**
 * 注册 capture-display 通道（可注入 deps 供测试）
 * @param ctx 主进程插件上下文
 * @param deps 截图能力
 */
export function registerWith(ctx: MainPluginContext, deps: ScreenCaptureDeps): void {
  ctx.registerIpc<unknown, CaptureDisplayResult>(CAPTURE_ACTION, async ({ payload }) => {
    const parsed = captureDisplayPayloadSchema.safeParse(payload)
    if (!parsed.success) {
      throw toolError('CT_CAPTURE_FAILED', parsed.error.issues[0]?.message ?? '参数无效')
    }

    try {
      return captureDisplayResultSchema.parse(await captureDisplay(deps, parsed.data.displayId))
    } catch (err) {
      if (isStructuredError(err)) throw err
      throw toolError('CT_CAPTURE_FAILED', toStructuredError(err).message)
    }
  })

  ctx.log.info('color-toolbox registered')
}

/** 生产实现：Electron desktopCapturer / screen / BrowserWindow */
export function createNodeDeps(): ScreenCaptureDeps {
  return {
    getDisplays: () =>
      screen.getAllDisplays().map((display) => ({
        id: display.id,
        label: display.label,
        bounds: { width: display.bounds.width, height: display.bounds.height },
        scaleFactor: display.scaleFactor
      })),
    getCurrentDisplayId: () => {
      const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
      if (win === undefined || win === null) return null
      return screen.getDisplayMatching(win.getBounds()).id
    },
    getSources: (thumbnailSize) => desktopCapturer.getSources({ types: ['screen'], thumbnailSize })
  }
}

export const registerMain: RegisterMain = (ctx) => {
  registerWith(ctx, createNodeDeps())
}
