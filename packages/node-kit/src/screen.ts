/**
 * @file screen.ts 显示器选择与整屏截图（纯逻辑 + 注入式依赖）
 * @author cuilanchao
 * @date 2026-11-21
 * @description Electron desktopCapturer 能力的公共封装，color-toolbox（吸管取色）与
 *              misc-toolbox（屏幕标尺）共用；Electron 实例由各工具 node.ts 组装注入，
 *              本文件不 import electron，便于单测。
 */

/** 显示器信息（Electron Display 子集，便于单测构造） */
export interface ScreenDisplayInfo {
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
  getDisplays(): readonly ScreenDisplayInfo[]
  /** 当前应用窗口所在显示器 id；无窗口时为 null */
  getCurrentDisplayId(): number | null
  getSources(thumbnailSize: {
    width: number
    height: number
  }): Promise<readonly CaptureSourceInfo[]>
}

/** 显示器选项（回包给 renderer 做多屏切换） */
export interface ScreenDisplayOption {
  readonly id: string
  readonly label: string
}

/** 截图结果（纯 PNG dataURL + 尺寸 + 显示器列表） */
export interface ScreenCaptureResult {
  readonly displayId: string
  readonly displayName: string
  readonly width: number
  readonly height: number
  readonly scaleFactor: number
  readonly dataUrl: string
  readonly displays: readonly ScreenDisplayOption[]
}

/**
 * 选择要截取的显示器：请求的 id → 当前窗口所在 → 首个
 * @param displays 全部显示器
 * @param requestedId 入参指定的显示器 id
 * @param currentId 当前窗口所在显示器 id
 */
export function selectDisplay(
  displays: readonly ScreenDisplayInfo[],
  requestedId: string | undefined,
  currentId: number | null
): ScreenDisplayInfo | null {
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
 * 截取指定的（或当前的）显示器画面
 * @param deps 截图能力
 * @param requestedId 入参指定的显示器 id
 * @returns PNG dataURL、截图尺寸与显示器列表
 * @throws Error 未检测到显示器 / 未获取到屏幕画面 / 底层异常透传
 */
export async function captureDisplay(
  deps: ScreenCaptureDeps,
  requestedId: string | undefined
): Promise<ScreenCaptureResult> {
  const displays = deps.getDisplays()
  const display = selectDisplay(displays, requestedId, deps.getCurrentDisplayId())
  if (display === null) throw new Error('未检测到显示器')

  const options = displays.map((item, index) => ({
    id: String(item.id),
    label: item.label === '' ? `显示器 ${index + 1}` : item.label
  }))
  const displayName = options.find((item) => item.id === String(display.id))?.label ?? '显示器'
  const thumbnailSize = {
    width: Math.max(1, Math.round(display.bounds.width * display.scaleFactor)),
    height: Math.max(1, Math.round(display.bounds.height * display.scaleFactor))
  }

  const sources = await deps.getSources(thumbnailSize)
  const source = sources.find((item) => item.display_id === String(display.id)) ?? sources[0]
  if (source === undefined || source.thumbnail.isEmpty()) {
    throw new Error('未获取到屏幕画面')
  }
  const size = source.thumbnail.getSize()
  const dataUrl = `data:image/png;base64,${source.thumbnail.toPNG().toString('base64')}`
  return {
    displayId: String(display.id),
    displayName,
    width: size.width,
    height: size.height,
    scaleFactor: display.scaleFactor,
    dataUrl,
    displays: options
  }
}
