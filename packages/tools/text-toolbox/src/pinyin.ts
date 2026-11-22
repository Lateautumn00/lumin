/**
 * @file 汉字转拼音纯函数（动态加载 pinyin-pro，拼音字典不进工具首屏 chunk）
 * @author cuilanchao
 * @date 2026-11-22
 * @description 支持带声调 / 数字声调 / 无声调 / 首字母四种模式；非汉字默认原样保留，可选择移除
 */
import { checkTextSize, type TextResult } from './errors'

/** 转换模式：符号声调 / 数字声调 / 无声调 / 首字母连写 */
export type PinyinStyle = 'tone' | 'tone-number' | 'plain' | 'initial'

/** 转换选项 */
export interface PinyinOptions {
  /** 转换模式 */
  style: PinyinStyle
  /** 是否保留非汉字字符（默认 true） */
  keepNonZh?: boolean
}

/** 模式 → pinyin-pro 参数（分隔符仅作用于相邻汉字之间） */
const STYLE_CONFIG: Record<
  PinyinStyle,
  { toneType: 'symbol' | 'num' | 'none'; pattern: 'pinyin' | 'first'; separator: string }
> = {
  tone: { toneType: 'symbol', pattern: 'pinyin', separator: ' ' },
  'tone-number': { toneType: 'num', pattern: 'pinyin', separator: ' ' },
  plain: { toneType: 'none', pattern: 'pinyin', separator: ' ' },
  initial: { toneType: 'none', pattern: 'first', separator: '' }
}

/**
 * 汉字文本 → 拼音
 * @param text 原始文本（含非汉字时按 keepNonZh 处理）
 * @param options 转换模式与非汉字策略
 * @description 非汉字字符原样输出、不额外插入分隔符；相邻汉字之间才加分隔符
 */
export async function convertPinyin(
  text: string,
  options: PinyinOptions
): Promise<TextResult<string>> {
  const tooLarge = checkTextSize(text)
  if (tooLarge !== null) return { ok: false, error: tooLarge }
  if (text === '') return { ok: true, value: '' }

  const config = STYLE_CONFIG[options.style]
  const keepNonZh = options.keepNonZh ?? true
  const { pinyin } = await import('pinyin-pro')
  const tokens = pinyin(text, {
    toneType: config.toneType,
    pattern: config.pattern,
    type: 'all'
  })

  let output = ''
  let previous: 'none' | 'zh' | 'word' | 'space' = 'none'
  for (const token of tokens) {
    if (!token.isZh) {
      if (!keepNonZh) continue
      if (/^\s+$/.test(token.origin)) {
        output += token.origin
        previous = 'space'
        continue
      }
      if (previous === 'zh') output += config.separator
      output += token.origin
      previous = 'word'
      continue
    }
    if (previous === 'zh' || previous === 'word') output += config.separator
    output += config.pattern === 'first' ? token.first : token.result
    previous = 'zh'
  }
  return { ok: true, value: output }
}
