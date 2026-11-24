/**
 * @file 图片导出单测
 * @author cuilanchao
 * @date 2026-11-24
 * @description 覆盖包围盒计算、尺寸校验、SVG 文档构造、原生 SVG（可栅格化）构造与折行转义、
 *              节点矩形收集（布局偏移/回退）、Canvas 栅格化（成功/取消/异常）与 Blob→base64。
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  MAX_EXPORT_SIDE,
  blobToBase64,
  buildRasterSvg,
  buildSvgDocument,
  collectStageRects,
  computeExportBox,
  escapeXmlText,
  rasterizePng,
  resolveExportSize,
  wrapText,
  type RasterNode
} from './export-image'

/** 伪 HTMLElement（仅提供导出逻辑用到的布局字段） */
class FakeHTMLElement {
  offsetLeft = 0
  offsetTop = 0
  offsetWidth = 0
  offsetHeight = 0
  offsetParent: FakeHTMLElement | null = null
  private readonly rect: { left: number; top: number; width: number; height: number }

  constructor(
    rect: { left: number; top: number; width: number; height: number } = {
      left: 0,
      top: 0,
      width: 0,
      height: 0
    }
  ) {
    this.rect = rect
  }

  getBoundingClientRect(): DOMRect {
    return this.rect as DOMRect
  }
}

/** 栅格化依赖的可变行为开关 */
interface RasterHooks {
  imageError?: boolean
  contextNull?: boolean
  blobNull?: boolean
  abortBeforeLoadEnd?: boolean
  readerResult?: string | null
  readerError?: boolean
}

/** 安装 rasterizePng / blobToBase64 所需全局桩 */
function installRasterStubs(hooks: RasterHooks = {}): {
  createObjectURL: ReturnType<typeof vi.fn>
  revokeObjectURL: ReturnType<typeof vi.fn>
} {
  const createObjectURL = vi.fn(() => 'blob:mock')
  const revokeObjectURL = vi.fn()
  vi.stubGlobal('URL', { createObjectURL, revokeObjectURL })

  class StubImage {
    onload: (() => void) | null = null
    onerror: (() => void) | null = null
    private source = ''

    set src(value: string) {
      this.source = value
      queueMicrotask(() => {
        if (hooks.abortBeforeLoadEnd === true && typeof AbortSignal !== 'undefined') {
          signalRef?.dispatchEvent(new Event('abort'))
        }
        if (hooks.imageError === true) this.onerror?.()
        else this.onload?.()
      })
    }

    get src(): string {
      return this.source
    }
  }
  vi.stubGlobal('Image', StubImage)

  const blob = new Blob(['png'], { type: 'image/png' })
  const canvas = {
    width: 0,
    height: 0,
    getContext: () => (hooks.contextNull === true ? null : { drawImage: vi.fn() }),
    toBlob: (callback: (value: Blob | null) => void) => {
      callback(hooks.blobNull === true ? null : blob)
    }
  }
  vi.stubGlobal('document', { createElement: () => canvas })

  class StubFileReader {
    onload: (() => void) | null = null
    onerror: (() => void) | null = null
    result: string | null = null

    readAsDataURL(): void {
      queueMicrotask(() => {
        if (hooks.readerError === true) this.onerror?.()
        else {
          this.result =
            hooks.readerResult === undefined ? 'data:image/png;base64,QUJD' : hooks.readerResult
          this.onload?.()
        }
      })
    }
  }
  vi.stubGlobal('FileReader', StubFileReader)
  return { createObjectURL, revokeObjectURL }
}

let signalRef: AbortSignal | undefined

afterEach(() => {
  signalRef = undefined
  vi.unstubAllGlobals()
})

describe('export-image', () => {
  describe('computeExportBox', () => {
    it('空列表返回最小尺寸', () => {
      expect(computeExportBox([])).toEqual({ x: 0, y: 0, width: 320, height: 200 })
    })

    it('矩形并集加内边距且不小于最小尺寸', () => {
      expect(
        computeExportBox([
          { x: 10, y: 20, width: 100, height: 40 },
          { x: 200, y: 100, width: 50, height: 60 }
        ])
      ).toEqual({ x: -22, y: -12, width: 320, height: 204 })
      expect(computeExportBox([{ x: 10, y: 20, width: 100, height: 40 }])).toEqual({
        x: -22,
        y: -12,
        width: 320,
        height: 200
      })
    })
  })

  describe('resolveExportSize', () => {
    it('倍率四舍五入并夹紧 [1,3]', () => {
      expect(resolveExportSize(100, 50, 2.4)).toEqual({ width: 200, height: 100 })
      expect(resolveExportSize(100, 50, 0)).toEqual({ width: 100, height: 50 })
      expect(resolveExportSize(100, 50, 9)).toEqual({ width: 300, height: 150 })
    })

    it('单边或总像素超限抛 MM_EXPORT_TOO_LARGE', () => {
      expect(() => resolveExportSize(MAX_EXPORT_SIDE + 1, 10, 1)).toThrowError(
        expect.objectContaining({ code: 'MM_EXPORT_TOO_LARGE' })
      )
      expect(() => resolveExportSize(8000, 5000, 1)).toThrowError(
        expect.objectContaining({ code: 'MM_EXPORT_TOO_LARGE' })
      )
    })
  })

  describe('buildSvgDocument', () => {
    const base = { width: 100, height: 50, css: '.a{color:red}', body: '<div>x</div>' }

    it('无背景时不输出 rect，缩放夹紧到 [1,3]', () => {
      const svg = buildSvgDocument({ ...base, background: null, scale: 2 })
      expect(svg).toContain('width="200" height="100" viewBox="0 0 100 50"')
      expect(svg).not.toContain('<rect')
      expect(svg).toContain('<style>.a{color:red}</style>')
      expect(svg).toContain('<foreignObject')
    })

    it('有背景输出 rect；未给 scale 视为 1', () => {
      const svg = buildSvgDocument({ ...base, background: '#fff' })
      expect(svg).toContain('width="100" height="50"')
      expect(svg).toContain('<rect x="0" y="0" width="100" height="50" fill="#fff" />')
    })
  })

  describe('escapeXmlText / wrapText', () => {
    it('转义 & < > " \'', () => {
      expect(escapeXmlText(`<a href="x">A&B'C'</a>`)).toBe(
        '&lt;a href=&quot;x&quot;&gt;A&amp;B&#39;C&#39;&lt;/a&gt;'
      )
    })

    it('CJK 按 1em 折行，ASCII 按 0.55em', () => {
      expect(wrapText('中文主题', 20, 40)).toEqual(['中文', '主题'])
      expect(wrapText('abcdef', 10, 20)).toEqual(['abc', 'def'])
    })

    it('保留显式换行，空文本返回单空行，窄宽度不无限折行', () => {
      expect(wrapText('甲\n乙', 14, 100)).toEqual(['甲', '乙'])
      expect(wrapText('', 14, 100)).toEqual([''])
      expect(wrapText('超长', 14, 1)).toEqual(['超', '长'])
    })
  })

  describe('buildRasterSvg', () => {
    const node: RasterNode = {
      x: 10,
      y: 20,
      width: 120,
      height: 40,
      text: '根主题',
      fill: 'rgb(1, 2, 3)',
      color: 'rgb(4, 5, 6)',
      stroke: 'rgb(7, 8, 9)',
      strokeWidth: 2,
      radius: 8,
      fontSize: 14,
      fontWeight: '600'
    }

    it('无 foreignObject，含背景、分支线与节点矩形/文本', () => {
      const svg = buildRasterSvg({
        width: 320,
        height: 200,
        background: '#fff',
        lines: '<g transform="translate(1 2)"><path d="M0 0L1 1" /></g>',
        nodes: [node]
      })
      expect(svg).not.toContain('foreignObject')
      expect(svg).toContain('viewBox="0 0 320 200"')
      expect(svg).toContain('fill="#fff"')
      expect(svg).toContain('<path d="M0 0L1 1" />')
      expect(svg).toContain('rx="8" ry="8"')
      expect(svg).toContain('stroke="rgb(7, 8, 9)" stroke-width="2"')
      expect(svg).toContain('<tspan x="70" y="40">根主题</tspan>')
    })

    it('无背景省略 rect，缩放夹紧 [1,3]，无描边/圆角时省略属性', () => {
      const svg = buildRasterSvg({
        width: 100,
        height: 50,
        background: null,
        lines: '',
        scale: 9,
        nodes: [{ ...node, strokeWidth: 0, radius: 0 }]
      })
      expect(svg).toContain('width="300" height="150"')
      expect(svg).not.toContain('<rect x="0" y="0" width="100"')
      expect(svg).not.toContain('stroke-width')
      expect(svg).not.toContain('rx=')
    })
  })

  describe('collectStageRects', () => {
    it('未找到 .map-canvas 返回空数组', () => {
      vi.stubGlobal('HTMLElement', FakeHTMLElement)
      const container = { querySelector: () => null, querySelectorAll: () => [] }
      expect(collectStageRects(container as unknown as HTMLElement, 1)).toEqual([])
    })

    it('canvas 非 HTMLElement 返回空数组', () => {
      vi.stubGlobal('HTMLElement', FakeHTMLElement)
      const container = { querySelector: () => ({}), querySelectorAll: () => [] }
      expect(collectStageRects(container as unknown as HTMLElement, 1)).toEqual([])
    })

    it('布局偏移链可达时直接使用 offset 坐标', () => {
      vi.stubGlobal('HTMLElement', FakeHTMLElement)
      const canvas = new FakeHTMLElement()
      const mid = new FakeHTMLElement()
      mid.offsetLeft = 5
      mid.offsetTop = 6
      mid.offsetParent = canvas
      const topic = new FakeHTMLElement()
      topic.offsetLeft = 10
      topic.offsetTop = 20
      topic.offsetWidth = 100
      topic.offsetHeight = 40
      topic.offsetParent = mid
      const container = {
        querySelector: () => canvas,
        querySelectorAll: () => [topic]
      }
      expect(collectStageRects(container as unknown as HTMLElement, 3)).toEqual([
        { x: 15, y: 26, width: 100, height: 40 }
      ])
    })

    it('偏移链断裂时回退 rect 并按缩放折算，scale<=0 视为 1', () => {
      vi.stubGlobal('HTMLElement', FakeHTMLElement)
      const canvas = new FakeHTMLElement({ left: 10, top: 10, width: 0, height: 0 })
      const topic = new FakeHTMLElement({ left: 60, top: 110, width: 200, height: 80 })
      topic.offsetParent = null
      const container = {
        querySelector: () => canvas,
        querySelectorAll: () => [topic]
      }
      const rects = collectStageRects(container as unknown as HTMLElement, 2)
      expect(rects).toEqual([{ x: 25, y: 50, width: 100, height: 40 }])
      expect(collectStageRects(container as unknown as HTMLElement, 0)).toEqual([
        { x: 50, y: 100, width: 200, height: 80 }
      ])
    })
  })

  describe('rasterizePng', () => {
    it('成功返回 PNG Blob 并释放对象 URL', async () => {
      const { revokeObjectURL } = installRasterStubs()
      const blob = await rasterizePng('<svg />', 100, 50)
      expect(blob.type).toBe('image/png')
      expect(revokeObjectURL).toHaveBeenCalledWith('blob:mock')
    })

    it('已取消的 signal 立即抛 MM_EXPORT_FAILED', async () => {
      installRasterStubs()
      const controller = new AbortController()
      controller.abort()
      await expect(rasterizePng('<svg />', 100, 50, controller.signal)).rejects.toMatchObject({
        code: 'MM_EXPORT_FAILED',
        detail: '已取消'
      })
    })

    it('加载完成前取消会拒绝 Promise', async () => {
      installRasterStubs({ abortBeforeLoadEnd: true })
      const controller = new AbortController()
      signalRef = controller.signal
      await expect(rasterizePng('<svg />', 100, 50, controller.signal)).rejects.toMatchObject({
        detail: '已取消'
      })
    })

    it('图片加载失败抛「SVG 渲染失败」', async () => {
      installRasterStubs({ imageError: true })
      await expect(rasterizePng('<svg />', 100, 50)).rejects.toMatchObject({
        detail: 'SVG 渲染失败'
      })
    })

    it('Canvas 上下文缺失抛错', async () => {
      installRasterStubs({ contextNull: true })
      await expect(rasterizePng('<svg />', 100, 50)).rejects.toMatchObject({
        detail: 'Canvas 不可用'
      })
    })

    it('toBlob 返回 null 抛「PNG 编码失败」', async () => {
      installRasterStubs({ blobNull: true })
      await expect(rasterizePng('<svg />', 100, 50)).rejects.toMatchObject({
        detail: 'PNG 编码失败'
      })
    })
  })

  describe('blobToBase64', () => {
    it('去掉 data URL 前缀', async () => {
      installRasterStubs()
      await expect(blobToBase64(new Blob(['x']))).resolves.toBe('QUJD')
    })

    it('结果非字符串时回退空串', async () => {
      installRasterStubs({ readerResult: null })
      await expect(blobToBase64(new Blob(['x']))).resolves.toBe('')
    })

    it('无逗号时返回原串', async () => {
      installRasterStubs({ readerResult: 'RAW' })
      await expect(blobToBase64(new Blob(['x']))).resolves.toBe('RAW')
    })

    it('读取失败抛 MM_EXPORT_FAILED', async () => {
      installRasterStubs({ readerError: true })
      await expect(blobToBase64(new Blob(['x']))).rejects.toMatchObject({
        detail: '读取导出结果失败'
      })
    })
  })
})
