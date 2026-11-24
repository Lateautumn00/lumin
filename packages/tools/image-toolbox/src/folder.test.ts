/**
 * @file folder.test.ts 文件夹递归收集单测（真实临时目录，M63）
 * @author cuilanchao
 * @date 2026-11-24
 * @description 覆盖白名单过滤、子目录递归、排序与空目录/不存在目录行为
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { collectImages } from './folder'

const roots: string[] = []

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

/** 造临时根目录并记录清理 */
function tempRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'lumin-it-folder-'))
  roots.push(root)
  return root
}

describe('collectImages', () => {
  it('递归收集白名单图片并按路径排序', async () => {
    const root = tempRoot()
    mkdirSync(join(root, 'sub', 'deep'), { recursive: true })
    writeFileSync(join(root, 'b.PNG'), 'x')
    writeFileSync(join(root, 'a.jpg'), 'x')
    writeFileSync(join(root, 'note.txt'), 'x')
    writeFileSync(join(root, 'sub', 'c.webp'), 'x')
    writeFileSync(join(root, 'sub', 'deep', 'd.gif'), 'x')

    const result = await collectImages(root)
    expect(result.truncated).toBe(false)
    expect(result.files).toEqual([
      join(root, 'a.jpg'),
      join(root, 'b.PNG'),
      join(root, 'sub', 'c.webp'),
      join(root, 'sub', 'deep', 'd.gif')
    ])
  })

  it('空目录 → 空列表且未截断', async () => {
    const root = tempRoot()
    await expect(collectImages(root)).resolves.toEqual({ files: [], truncated: false })
  })

  it('目录不存在 → 抛出（由调用方映射结构化错误）', async () => {
    await expect(collectImages(join(tempRoot(), 'missing'))).rejects.toBeTruthy()
  })
})
