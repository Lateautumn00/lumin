/**
 * @file gif.ts 单测（M40，spec §2.5/§5）
 * @author cuilanchao
 * @date 2026-11-21
 * @description 帧率换算、画布规划与超限、滤镜图拼装、循环参数与输出命名
 */
import { describe, expect, it } from 'vitest'
import {
  GIF_MAX_PIXELS,
  buildGifFilterGraph,
  fpsFromFrameMs,
  gifLoopArg,
  gifOutputName,
  planGifCanvas
} from './gif'

describe('fpsFromFrameMs', () => {
  it('1000 / 帧时长，保留 3 位小数', () => {
    expect(fpsFromFrameMs(500)).toBe(2)
    expect(fpsFromFrameMs(100)).toBe(10)
    expect(fpsFromFrameMs(300)).toBe(3.333)
  })

  it('越界钳制到 50–5000ms', () => {
    expect(fpsFromFrameMs(10)).toBe(20)
    expect(fpsFromFrameMs(9000)).toBe(0.2)
  })

  it('非整数取整后再换算', () => {
    expect(fpsFromFrameMs(99.6)).toBe(10)
  })
})

describe('planGifCanvas', () => {
  it('宽 0 → 首张宽；高取缩放后最大值', () => {
    expect(
      planGifCanvas(
        [
          { width: 200, height: 100 },
          { width: 100, height: 100 },
          { width: 400, height: 600 }
        ],
        0
      )
    ).toEqual({ width: 200, height: 300 })
  })

  it('指定宽 → 等比换算各帧高', () => {
    expect(
      planGifCanvas(
        [
          { width: 1000, height: 500 },
          { width: 500, height: 1000 }
        ],
        250
      )
    ).toEqual({ width: 250, height: 500 })
  })

  it('空列表 / 非法宽 → null', () => {
    expect(planGifCanvas([], 0)).toBeNull()
    expect(planGifCanvas([{ width: 100, height: 100 }], -5)).toBeNull()
  })

  it('宽超 4096 → null', () => {
    expect(planGifCanvas([{ width: 5000, height: 100 }], 0)).toBeNull()
    expect(planGifCanvas([{ width: 100, height: 100 }], 4097)).toBeNull()
  })

  it('高超 4096 → null', () => {
    expect(planGifCanvas([{ width: 100, height: 5000 }], 0)).toBeNull()
  })

  it('总像素超上限 → null；恰好 4096² 允许', () => {
    expect(planGifCanvas([{ width: 3000, height: 6000 }], 3000)).toBeNull()
    const canvas = planGifCanvas([{ width: 4096, height: 4096 }], 0)
    expect(canvas).toEqual({ width: 4096, height: 4096 })
    expect(canvas === null ? 0 : canvas.width * canvas.height).toBe(GIF_MAX_PIXELS)
  })

  it('零尺寸帧 → null', () => {
    expect(planGifCanvas([{ width: 0, height: 100 }], 0)).toBeNull()
  })
})

describe('buildGifFilterGraph', () => {
  const canvas = { width: 200, height: 100 }

  it('逐帧 scale/pad + concat + palette 链', () => {
    const graph = buildGifFilterGraph(2, canvas)
    expect(graph).toContain('[0:v]scale=200:100:force_original_aspect_ratio=decrease')
    expect(graph).toContain('[1:v]scale=200:100:force_original_aspect_ratio=decrease')
    expect(graph).toContain('concat=n=2:v=1:a=0[cat]')
    expect(graph).toContain('[cat]split[palsrc][framesrc]')
    expect(graph).toContain('[palsrc]palettegen[palette]')
    expect(graph).toContain('[framesrc][palette]paletteuse')
  })

  it('单帧也生成完整链', () => {
    expect(buildGifFilterGraph(1, canvas)).toContain('concat=n=1:v=1:a=0')
  })
})

describe('gifLoopArg', () => {
  it('-1 不循环 / 0 无限 / N 次', () => {
    expect(gifLoopArg(-1)).toBe('-1')
    expect(gifLoopArg(-5)).toBe('-1')
    expect(gifLoopArg(0)).toBe('0')
    expect(gifLoopArg(5)).toBe('5')
  })

  it('超过 10 钳制', () => {
    expect(gifLoopArg(99)).toBe('10')
  })
})

describe('gifOutputName', () => {
  it('动图_{yyyyMMdd-HHmmss}.gif', () => {
    expect(gifOutputName(new Date(2026, 10, 21, 9, 5, 3))).toBe('动图_20261121-090503.gif')
  })
})
