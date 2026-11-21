/**
 * @file tree.test.ts 纯函数单测（规则解析 / 树渲染 / 空目录判定 / 时间 / 分批）
 * @author cuilanchao
 * @date 2026-11-21
 */
import { describe, expect, it } from 'vitest'
import {
  chunkPaths,
  findEmptyDirs,
  formatDateTime,
  isExcluded,
  matchesExtensions,
  parseDateTime,
  parseExtensions,
  parsePatterns,
  renderTree,
  type DirEntry,
  type TreeNode
} from './tree'

function dir(name: string, children: TreeNode[] = []): TreeNode {
  return { name, kind: 'dir', children }
}

function file(name: string): TreeNode {
  return { name, kind: 'file', children: [] }
}

function entry(path: string, childDirs: string[] = [], fileCount = 0): DirEntry {
  return { path, childDirs, fileCount }
}

describe('parsePatterns', () => {
  it('按换行/逗号/分号切分', () => {
    expect(parsePatterns('node_modules\n*.log,temp;cache')).toEqual([
      'node_modules',
      '*.log',
      'temp',
      'cache'
    ])
  })

  it('去空白并转小写', () => {
    expect(parsePatterns('  Build ,  DIST ')).toEqual(['build', 'dist'])
  })

  it('去重且保留首次顺序', () => {
    expect(parsePatterns('a,b,a\nB')).toEqual(['a', 'b'])
  })

  it('空输入返回空数组', () => {
    expect(parsePatterns('')).toEqual([])
    expect(parsePatterns(' , ;\n ')).toEqual([])
  })
})

describe('isExcluded', () => {
  it('精确匹配（大小写不敏感）', () => {
    expect(isExcluded('node_modules', ['node_modules'])).toBe(true)
    expect(isExcluded('NODE_MODULES', ['node_modules'])).toBe(true)
  })

  it('星号通配匹配扩展名', () => {
    expect(isExcluded('a.log', ['*.log'])).toBe(true)
    expect(isExcluded('a.LOG', ['*.log'])).toBe(true)
    expect(isExcluded('a.txt', ['*.log'])).toBe(false)
  })

  it('星号通配匹配前缀', () => {
    expect(isExcluded('temp_2026', ['temp_*'])).toBe(true)
    expect(isExcluded('mytemp_2026', ['temp_*'])).toBe(false)
  })

  it('正则元字符按字面量处理', () => {
    expect(isExcluded('a.txt', ['a.txt'])).toBe(true)
    expect(isExcluded('aXtxt', ['a.txt'])).toBe(false)
    expect(isExcluded('a(b).tmp', ['a(b).tmp'])).toBe(true)
  })

  it('空规则集恒为 false', () => {
    expect(isExcluded('anything', [])).toBe(false)
  })

  it('无星号规则不做子串匹配', () => {
    expect(isExcluded('logs', ['log'])).toBe(false)
  })
})

describe('parseExtensions', () => {
  it('去前导点并转小写', () => {
    expect(parseExtensions('.LOG, Tmp ,.bak')).toEqual(['log', 'tmp', 'bak'])
  })

  it('去重', () => {
    expect(parseExtensions('log,LOG,.log')).toEqual(['log'])
  })

  it('空项被过滤', () => {
    expect(parseExtensions(' , .., ')).toEqual([])
  })

  it('支持中文分号分隔', () => {
    expect(parseExtensions('log；tmp')).toEqual(['log', 'tmp'])
  })
})

describe('matchesExtensions', () => {
  it('命中扩展名（大小写不敏感）', () => {
    expect(matchesExtensions('a.log', ['log'])).toBe(true)
    expect(matchesExtensions('a.LOG', ['log'])).toBe(true)
  })

  it('多扩展名按最后一个点取后缀', () => {
    expect(matchesExtensions('archive.tar.gz', ['gz'])).toBe(true)
    expect(matchesExtensions('archive.tar.gz', ['tar'])).toBe(false)
  })

  it('无扩展名不匹配', () => {
    expect(matchesExtensions('Makefile', ['log'])).toBe(false)
    expect(matchesExtensions('Makefile', [])).toBe(false)
  })

  it('点开头文件不视为扩展名', () => {
    expect(matchesExtensions('.gitignore', ['gitignore'])).toBe(false)
  })

  it('结尾是点不匹配', () => {
    expect(matchesExtensions('a.', ['a'])).toBe(false)
  })
})

describe('parseDateTime / formatDateTime', () => {
  it('解析为本地时间', () => {
    const expected = new Date(2026, 0, 2, 3, 4, 0, 0).getTime()
    expect(parseDateTime('2026-01-02 03:04')).toBe(expected)
  })

  it('支持 T 分隔与秒', () => {
    const expected = new Date(2026, 11, 31, 23, 59, 58, 0).getTime()
    expect(parseDateTime('2026-12-31T23:59:58')).toBe(expected)
  })

  it('忽略首尾空白', () => {
    expect(parseDateTime(' 2026-01-02 03:04 ')).not.toBeNull()
  })

  it('格式非法返回 null', () => {
    expect(parseDateTime('2026/01/02 03:04')).toBeNull()
    expect(parseDateTime('')).toBeNull()
    expect(parseDateTime('2026-01-02')).toBeNull()
  })

  it('不存在的日期返回 null', () => {
    expect(parseDateTime('2026-02-31 00:00')).toBeNull()
    expect(parseDateTime('2026-13-01 00:00')).toBeNull()
  })

  it('格式化补零', () => {
    const ms = new Date(2026, 0, 2, 3, 4, 0, 0).getTime()
    expect(formatDateTime(ms)).toBe('2026-01-02 03:04')
  })
})

describe('renderTree', () => {
  const root = dir('root', [
    dir('a', [file('1.txt'), dir('b', [file('2.txt')])]),
    file('c.md')
  ])

  it('输出 Box-drawing 层级', () => {
    expect(renderTree(root, { maxDepth: 3 }).text).toBe(
      ['root', '├── a/', '│   ├── 1.txt', '│   └── b/', '│       └── 2.txt', '└── c.md'].join('\n')
    )
  })

  it('统计目录与文件数', () => {
    const result = renderTree(root, { maxDepth: 3 })
    expect(result.dirs).toBe(2)
    expect(result.files).toBe(3)
    expect(result.truncated).toBe(false)
  })

  it('深度 1 只列一层并标记截断', () => {
    const result = renderTree(root, { maxDepth: 1 })
    expect(result.text).toBe(['root', '├── a/', '└── c.md'].join('\n'))
    expect(result.truncated).toBe(true)
  })

  it('截断但目录本身无子项时不标记', () => {
    const result = renderTree(dir('root', [dir('empty')]), { maxDepth: 1 })
    expect(result.truncated).toBe(false)
  })

  it('空目录只输出根名', () => {
    expect(renderTree(dir('root'), { maxDepth: 3 }).text).toBe('root')
  })

  it('末位分支使用 └──', () => {
    expect(renderTree(dir('root', [file('only.txt')]), { maxDepth: 2 }).text).toBe(
      ['root', '└── only.txt'].join('\n')
    )
  })
})

describe('findEmptyDirs', () => {
  it('全空链路自底向上返回，深层在前', () => {
    const entries = [
      entry('C:\\r', ['C:\\r\\a'], 0),
      entry('C:\\r\\a', ['C:\\r\\a\\b'], 0),
      entry('C:\\r\\a\\b', [], 0)
    ]
    expect(findEmptyDirs('C:\\r', entries)).toEqual(['C:\\r\\a\\b', 'C:\\r\\a'])
  })

  it('含文件的目录不入选且阻断父目录', () => {
    const entries = [
      entry('C:\\r', ['C:\\r\\a'], 0),
      entry('C:\\r\\a', [], 1)
    ]
    expect(findEmptyDirs('C:\\r', entries)).toEqual([])
  })

  it('根目录自身不返回', () => {
    expect(findEmptyDirs('C:\\r', [entry('C:\\r', [], 0)])).toEqual([])
  })

  it('未出现在 entries 的子目录视为不可读（父目录非空）', () => {
    const entries = [entry('C:\\r', ['C:\\r\\a'], 0), entry('C:\\r\\a', ['C:\\r\\a\\x'], 0)]
    expect(findEmptyDirs('C:\\r', entries)).toEqual([])
  })

  it('同级路径按名称排序', () => {
    const entries = [entry('C:\\r', ['C:\\r\\b', 'C:\\r\\a'], 0), entry('C:\\r\\a', [], 0), entry('C:\\r\\b', [], 0)]
    expect(findEmptyDirs('C:\\r', entries)).toEqual(['C:\\r\\a', 'C:\\r\\b'])
  })
})

describe('chunkPaths', () => {
  it('按 200 分批', () => {
    const paths = Array.from({ length: 250 }, (_, index) => `p${index}`)
    const batches = chunkPaths(paths, 200)
    expect(batches).toHaveLength(2)
    expect(batches[0]).toHaveLength(200)
    expect(batches[1]).toHaveLength(50)
  })

  it('空数组返回空批次', () => {
    expect(chunkPaths([], 200)).toEqual([])
  })

  it('非法批大小按 1 处理', () => {
    expect(chunkPaths(['a', 'b'], 0)).toEqual([['a'], ['b']])
  })
})
