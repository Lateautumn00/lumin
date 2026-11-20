/**
 * @file node.ts 颜色工具箱主进程通道（整屏截图取色）
 * @author cuilanchao
 * @date 2026-11-20
 * @description 单通道 capture-display：desktopCapturer 截取所选显示器 → PNG dataURL 回包。
 *              Electron 能力由 createNodeDeps 组装，测试注入假 deps（不触达真实屏幕）。
 */
import { BrowserWindow, desktopCapturer, screen } from 'electron'
import type { MainPluginContext, RegisterMain } from '@lumin/plugin-api'
import { isStructuredError, toStructuredError } from '@lumin/shared'
import { toolError } from './errors'
import {
  captureDisplayPayloadSchema,
  captureDisplayResultSchema,
  type CaptureDisplayResult
} from './schema'

/** 截图通道动作名（完整通道 = color-toolbox:capture-display） */
const CAPTURE_ACTION = 'capture-display'

/** 显示器信息（Electron Display 子集，便于单测构造） */
export interface DisplayInfo {
  readonly id: number
  readonly label: string
  readonly bounds: { readonly width: number; readonly height: number }
  readonly scaleFactor: number
}

/** 截图缩略图（Electron NativeImage 子集） */
export interface CapturedThumbnail {
  isEmpty(): boolean
  getSize(): { width: number; height: number }
  toPNG(): Buffer
}

/** 截屏来源（Electron DesktopCapturerSource 子集） */
export interface CaptureSourceInfo {
  readonly display_id: string
  readonly name: string
  readonly thumbnail: CapturedThumbnail
}

/** 工具可用的外部能力（node.ts 组装真实实现，测试注入假件） */
export interface ScreenCaptureDeps {
  getDisplays(): readonly DisplayInfo[]
  /** 当前应用窗口所在显示器 id；无窗口时为 null */
  getCurrentDisplayId(): number | null
  getSources(thumbnailSize: { width: number; height: number }): Promise<readonly CaptureSourceInfo[]>
}

/**
 * 选择要截取的显示器：请求的 id → 当前窗口所在 → 首个
 * @param displays 全部显示器
 * @param requestedId 入参指定的显示器 id
 * @param currentId 当前窗口所在显示器 id
 */
export function selectDisplay(
  displays: readonly DisplayInfo[],
  requestedId: string | undefined,
  currentId: number | null
): DisplayInfo | null {
  if (displays.length === 0) return null
  if (requestedId !== undefined) {
    const requested = displays.find((item) => String(item.id) === requestedId)
    if (requested !== undefined) return requested
  }
  if (currentId !== null) {
    const current = displays.find((item) => item.id === currentId)
    if (current !== undefined) return current
  }
  return displays[0] ?? null
}

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

    const displays = deps.getDisplays()
    const display = selectDisplay(displays, parsed.data.displayId, deps.getCurrentDisplayId())
    if (display === null) throw toolError('CT_CAPTURE_FAILED', '未检测到显示器')

    const options = displays.map((item, index) => ({
      id: String(item.id),
      label: item.label === '' ? `显示器 ${index + 1}` : item.label
    }))
    const displayName = options.find((item) => item.id === String(display.id))?.label ?? '显示器'
    const thumbnailSize = {
      width: Math.max(1, Math.round(display.bounds.width * display.scaleFactor)),
      height: Math.max(1, Math.round(display.bounds.height * display.scaleFactor))
    }

    try {
      const sources = await deps.getSources(thumbnailSize)
      const source = sources.find((item) => item.display_id === String(display.id)) ?? sources[0]
      if (source === undefined || source.thumbnail.isEmpty()) {
        throw toolError('CT_CAPTURE_FAILED', '未获取到屏幕画面')
      }
      const size = source.thumbnail.getSize()
      const dataUrl = `data:image/png;base64,${source.thumbnail.toPNG().toString('base64')}`
      return captureDisplayResultSchema.parse({
        displayId: String(display.id),
        displayName,
        width: size.width,
        height: size.height,
        dataUrl,
        displays: options
      })
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
    getSources: (thumbnailSize) =>
      desktopCapturer.getSources({ types: ['screen'], thumbnailSize })
  }
}

export const registerMain: RegisterMain = (ctx) => {
  registerWith(ctx, createNodeDeps())
}
