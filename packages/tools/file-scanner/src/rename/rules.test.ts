/**
 * @file rules 计划生成单测（规则叠加顺序、序号/日期、冲突判定、规则校验）
 * @author cuilanchao
 * @date 2026-11-18
 * @description 覆盖 spec §3 规则语义与 §4 第 6–8 条冲突规则
 */
import { describe, expect, it } from 'vitest'
import {
  buildRenamePlan,
  computeNewName,
  createDefaultRules,
  validateRules,
  type PlanFile,
  type RenameRules
} from './rules'

const NOW = new Date(2026, 10, 18, 9, 5, 7)
const MTIME = new Date(2026, 0, 2, 3, 4, 5).getTime()

/**
 * 构造测试规则（基于默认值覆盖）
 * @param patch 局部覆盖
 */
function rulesWith(patch: Partial<RenameRules>): RenameRules {
  return { ...createDefaultRules(), ...patch }
}

describe('computeNewName', () => {
  it('无规则时保持原名', () => {
    expect(computeNewName('a.txt', createDefaultRules(), 0, MTIME, NOW)).toBe('a.txt')
  })

  it('删除字符先于其它规则', () => {
    const rules = rulesWith({
      delete: { enabled: true, from: 1, count: 3 },
      caseMode: 'upper'
    })
    expect(computeNewName('abcDEF.png', rules, 0, MTIME, NOW)).toBe('DEF.png')
  })

  it('查找替换 + 大小写叠加', () => {
    const rules = rulesWith({
      findReplace: {
        enabled: true,
        find: 'img',
        replace: 'photo',
        isRegex: false,
        caseSensitive: false
      },
      caseMode: 'capitalize'
    })
    expect(computeNewName('IMG_001.jpg', rules, 0, MTIME, NOW)).toBe('Photo_001.jpg')
  })

  it('序号前缀补零 + 分隔符', () => {
    const rules = rulesWith({
      index: { enabled: true, position: 'prefix', start: 1, digits: 3, separator: '-' }
    })
    expect(computeNewName('a.png', rules, 0, MTIME, NOW)).toBe('001-a.png')
    expect(computeNewName('a.png', rules, 11, MTIME, NOW)).toBe('012-a.png')
  })

  it('序号后缀 + 无分隔符', () => {
    const rules = rulesWith({
      index: { enabled: true, position: 'suffix', start: 5, digits: 2, separator: '' }
    })
    expect(computeNewName('a.png', rules, 0, MTIME, NOW)).toBe('a05.png')
  })

  it('日期取 mtime 与 now', () => {
    const mtimeRules = rulesWith({
      date: { enabled: true, position: 'prefix', format: 'YYYYMMDD', source: 'mtime' }
    })
    expect(computeNewName('a.png', mtimeRules, 0, MTIME, NOW)).toBe('20260102-a.png')

    const nowRules = rulesWith({
      date: { enabled: true, position: 'suffix', format: 'YYYY-MM-DD', source: 'now' }
    })
    expect(computeNewName('a.png', nowRules, 0, MTIME, NOW)).toBe('a-2026-11-18.png')
  })

  it('序号与日期同时启用且位置不同', () => {
    const rules = rulesWith({
      index: { enabled: true, position: 'prefix', start: 1, digits: 2, separator: '_' },
      date: { enabled: true, position: 'suffix', format: 'YYYYMMDD', source: 'now' }
    })
    expect(computeNewName('a.png', rules, 0, MTIME, NOW)).toBe('01_a_20261118.png')
  })

  it('扩展名小写与自定义', () => {
    expect(
      computeNewName(
        'a.JPG',
        rulesWith({ extension: { mode: 'lower', custom: 'webp' } }),
        0,
        MTIME,
        NOW
      )
    ).toBe('a.jpg')
    expect(
      computeNewName(
        'a.png',
        rulesWith({ extension: { mode: 'custom', custom: 'jpeg' } }),
        0,
        MTIME,
        NOW
      )
    ).toBe('a.jpeg')
    expect(
      computeNewName(
        'README',
        rulesWith({ extension: { mode: 'custom', custom: 'md' } }),
        0,
        MTIME,
        NOW
      )
    ).toBe('README.md')
  })
})

describe('validateRules', () => {
  it('非法正则', () => {
    const rules = rulesWith({
      findReplace: { enabled: true, find: '(', replace: '', isRegex: true, caseSensitive: true }
    })
    expect(validateRules(rules)).toContain('正则')
  })

  it('自定义扩展名非法', () => {
    const rules = rulesWith({ extension: { mode: 'custom', custom: '.jpg' } })
    expect(validateRules(rules)).toContain('扩展名')
    expect(
      validateRules(rulesWith({ extension: { mode: 'custom', custom: 'a'.repeat(11) } }))
    ).not.toBeNull()
    expect(validateRules(rulesWith({ extension: { mode: 'custom', custom: 'jpeg' } }))).toBeNull()
  })

  it('默认规则合法', () => {
    expect(validateRules(createDefaultRules())).toBeNull()
  })
})

describe('buildRenamePlan', () => {
  const files: PlanFile[] = [
    { name: 'b.png', mtimeMs: MTIME },
    { name: 'a.png', mtimeMs: MTIME },
    { name: 'c.png', mtimeMs: MTIME }
  ]
  const indexRules = rulesWith({
    index: { enabled: true, position: 'prefix', start: 1, digits: 3, separator: '-' }
  })

  it('勾选行按列表顺序编号，未勾选行 skip', () => {
    const plan = buildRenamePlan(files, indexRules, {
      selected: new Set(['b.png', 'c.png']),
      now: NOW
    })
    expect(plan.ruleError).toBeNull()
    const [b, a, c] = plan.entries
    expect(b).toMatchObject({ from: 'b.png', to: '001-b.png', status: 'ok' })
    expect(a).toMatchObject({ from: 'a.png', status: 'skip', reason: '未勾选' })
    expect(c).toMatchObject({ from: 'c.png', to: '002-c.png', status: 'ok' })
    expect(plan.renameCount).toBe(2)
    expect(plan.conflictCount).toBe(0)
  })

  it('名称未变化 → skip', () => {
    const plan = buildRenamePlan(files, createDefaultRules(), {
      selected: new Set(files.map((file) => file.name)),
      now: NOW
    })
    expect(plan.entries.every((entry) => entry.status === 'skip')).toBe(true)
    expect(plan.entries[0]?.reason).toBe('名称未变化')
  })

  it('批内目标重复 → 全部冲突', () => {
    const rules = rulesWith({
      findReplace: {
        enabled: true,
        find: '.+',
        replace: 'same',
        isRegex: true,
        caseSensitive: true
      }
    })
    const plan = buildRenamePlan(files, rules, {
      selected: new Set(files.map((file) => file.name)),
      now: NOW
    })
    expect(plan.conflictCount).toBe(3)
    expect(plan.entries[0]?.reason).toContain('重名')
  })

  it('目标被未勾选文件占用 → 冲突', () => {
    const rules = rulesWith({
      findReplace: { enabled: true, find: '2', replace: '', isRegex: false, caseSensitive: true }
    })
    const extra: PlanFile[] = [
      { name: '2026.txt', mtimeMs: MTIME },
      { name: 'a.txt', mtimeMs: MTIME }
    ]
    const plan = buildRenamePlan(extra, rules, { selected: new Set(['a.txt']), now: NOW })
    // a.txt 无变化（find 未命中）→ skip
    expect(plan.entries[1]?.status).toBe('skip')

    const clash: PlanFile[] = [
      { name: 'b.txt', mtimeMs: MTIME },
      { name: 'x.txt', mtimeMs: MTIME }
    ]
    const clashRules = rulesWith({
      findReplace: { enabled: true, find: 'b', replace: 'x', isRegex: false, caseSensitive: true }
    })
    const clashPlan = buildRenamePlan(clash, clashRules, { selected: new Set(['b.txt']), now: NOW })
    expect(clashPlan.entries[0]).toMatchObject({ status: 'conflict', code: 'FR_CONFLICT' })
    expect(clashPlan.entries[0]?.reason).toContain('未勾选')
  })

  it('链式/交换 → 冲突', () => {
    const rules = rulesWith({
      findReplace: { enabled: true, find: '^a$', replace: 'b', isRegex: true, caseSensitive: true }
    })
    const two: PlanFile[] = [
      { name: 'a.txt', mtimeMs: MTIME },
      { name: 'b.txt', mtimeMs: MTIME }
    ]
    const plan = buildRenamePlan(two, rules, {
      selected: new Set(['a.txt', 'b.txt']),
      now: NOW
    })
    // a→b 与现存 b 同名 → 冲突；b 无变化 → skip
    expect(plan.entries[0]).toMatchObject({ status: 'conflict' })
    expect(plan.entries[1]?.status).toBe('skip')
  })

  it('非法文件名 → 冲突并带名称错误码', () => {
    const rules = rulesWith({
      findReplace: { enabled: true, find: 'a', replace: 'a?', isRegex: false, caseSensitive: true }
    })
    const one: PlanFile[] = [{ name: 'a.txt', mtimeMs: MTIME }]
    const plan = buildRenamePlan(one, rules, { selected: new Set(['a.txt']), now: NOW })
    expect(plan.entries[0]).toMatchObject({ status: 'conflict', code: 'FR_NAME_INVALID' })
  })

  it('规则非法 → 返回 ruleError 且不生成 entries', () => {
    const rules = rulesWith({
      findReplace: { enabled: true, find: '(', replace: '', isRegex: true, caseSensitive: true }
    })
    const plan = buildRenamePlan(files, rules, {
      selected: new Set(files.map((file) => file.name)),
      now: NOW
    })
    expect(plan.ruleError).toContain('正则')
    expect(plan.entries).toEqual([])
  })
})
