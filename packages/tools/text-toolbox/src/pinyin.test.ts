/**
 * @file pinyin.ts 单测：四种模式、非汉字保留/移除、多音字、换行与体积上限
 * @author cuilanchao
 * @date 2026-11-22
 * @description 覆盖 spec §2.7 拼音 Tab 的成功与错误分支
 */
import { describe, expect, it } from 'vitest'
import { convertPinyin, type PinyinOptions } from './pinyin'
import { MAX_TEXT_BYTES } from './errors'

/** 取成功值（失败时抛错便于断言） */
function valueOf(result: { ok: true; value: string } | { ok: false; error: unknown }): string {
  if (!result.ok) throw new Error('期望成功')
  return result.value
}

/** 以指定选项转换并取成功值 */
async function convert(text: string, options: PinyinOptions): Promise<string> {
  return valueOf(await convertPinyin(text, options))
}

describe('convertPinyin', () => {
  it('带声调：常用词与多音字', async () => {
    expect(await convert('你好', { style: 'tone' })).toBe('nǐ hǎo')
    expect(await convert('中国', { style: 'tone' })).toBe('zhōng guó')
    expect(await convert('重庆', { style: 'tone' })).toBe('chóng qìng')
  })

  it('数字声调', async () => {
    expect(await convert('你好', { style: 'tone-number' })).toBe('ni3 hao3')
  })

  it('无声调', async () => {
    expect(await convert('你好', { style: 'plain' })).toBe('ni hao')
  })

  it('首字母连写', async () => {
    expect(await convert('你好', { style: 'initial' })).toBe('nh')
    expect(await convert('中国', { style: 'initial' })).toBe('zg')
  })

  it('非汉字默认原样保留且不重复加空格', async () => {
    expect(await convert('Lumin 你好 2026', { style: 'tone' })).toBe('Lumin nǐ hǎo 2026')
    expect(await convert('中文abc测试', { style: 'tone' })).toBe('zhōng wén abc cè shì')
  })

  it('可移除非汉字字符', async () => {
    expect(await convert('Lumin 你好 2026', { style: 'tone', keepNonZh: false })).toBe('nǐ hǎo')
    expect(await convert('中文abc测试', { style: 'tone', keepNonZh: false })).toBe(
      'zhōng wén cè shì'
    )
  })

  it('保留换行', async () => {
    expect(await convert('第一行\n第二行', { style: 'tone' })).toBe('dì yī háng\ndì èr háng')
  })

  it('空文本返回空串', async () => {
    expect(await convert('', { style: 'tone' })).toBe('')
  })

  it('超过 5MB 上限返回 TT_TEXT_TOO_LARGE', async () => {
    const result = await convertPinyin('a'.repeat(MAX_TEXT_BYTES + 1), { style: 'tone' })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('TT_TEXT_TOO_LARGE')
  })
})
