/**
 * @file schema.ts 单测（核心纯函数，覆盖率 ≥80% 分组）
 * @author cuilanchao
 * @date 2026-11-18
 * @description 分享口令 URL 提取 / probe/start 入参 preprocess 链路校验
 */
import { describe, expect, it } from 'vitest'
import { extractVideoUrl, probePayloadSchema, startPayloadSchema } from './schema'

describe('extractVideoUrl', () => {
  it('抖音真实分享口令 → 提取短链（剥离反引号包裹）', () => {
    const raw =
      '2.51 复制打开抖音，看看【云端地理的作品】骷髅海岸是怎么形成的# 抖音精选计划 # 地理 #... `https://v.douyin.com/na3SyHkTkJo/` lCH:/ I@V.yT 12/18 :1pm'
    expect(extractVideoUrl(raw)).toBe('https://v.douyin.com/na3SyHkTkJo/')
  })

  it('引号/书名号/方括号包裹 → 剥离首尾包裹字符', () => {
    expect(extractVideoUrl('见 "https://a.b/c" 说明')).toBe('https://a.b/c')
    expect(extractVideoUrl('《https://a.b/c》请看')).toBe('https://a.b/c')
    expect(extractVideoUrl('【https://a.b/c】')).toBe('https://a.b/c')
  })

  it('URL 与中文正文无空格紧邻 → 不吞正文', () => {
    expect(extractVideoUrl('看看https://v.douyin.com/na3SyHkTkJo/这是标题')).toBe(
      'https://v.douyin.com/na3SyHkTkJo/'
    )
  })

  it('纯 URL 原样返回', () => {
    expect(extractVideoUrl('https://www.bilibili.com/video/BV1GJ411x7h7/')).toBe(
      'https://www.bilibili.com/video/BV1GJ411x7h7/'
    )
  })

  it('URL 尾部紧跟中文标点 → 剥离标点保留路径斜杠', () => {
    expect(extractVideoUrl('地址 https://a.b/c/，后文')).toBe('https://a.b/c/')
    expect(extractVideoUrl('https://a.b/c。')).toBe('https://a.b/c')
  })

  it('多个 URL → 取第一个', () => {
    expect(extractVideoUrl('a https://x.y/1 b https://z.w/2')).toBe('https://x.y/1')
  })

  it('无 URL → 原样返回（交由 VIDEO_URL_RE 校验报错）', () => {
    expect(extractVideoUrl('这是一段没有链接的口令')).toBe('这是一段没有链接的口令')
  })
})

describe('payload preprocess（分享口令直接粘贴）', () => {
  const SHARE_TEXT =
    '2.51 复制打开抖音，看看【云端地理的作品】骷髅海岸… `https://v.douyin.com/na3SyHkTkJo/` lCH:/'

  it('probe：整段口令 → url 提取后通过校验', () => {
    const parsed = probePayloadSchema.parse({ url: SHARE_TEXT })
    expect(parsed.url).toBe('https://v.douyin.com/na3SyHkTkJo/')
  })

  it('start：整段口令 → url 提取后通过校验（preset/outputDir 不受影响）', () => {
    const parsed = startPayloadSchema.parse({ url: SHARE_TEXT, preset: 'best' })
    expect(parsed.url).toBe('https://v.douyin.com/na3SyHkTkJo/')
    expect(parsed.preset).toBe('best')
  })

  it('无 URL 的口令 → VD_URL_INVALID 对应的校验失败', () => {
    expect(() => probePayloadSchema.parse({ url: '没有链接' })).toThrow()
  })
})
