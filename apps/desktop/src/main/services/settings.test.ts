import { afterEach, describe, expect, it } from 'vitest'
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { createSettingsService } from './settings'

const dirs: string[] = []

async function tempFile(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'lumin-settings-'))
  dirs.push(dir)
  return join(dir, 'settings.json')
}

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

describe('createSettingsService', () => {
  it('缺省键返回默认值', async () => {
    const service = createSettingsService(await tempFile())
    expect(await service.get('shell.taskConcurrency', 2)).toBe(2)
    expect(await service.get('a.b.c', 'fallback')).toBe('fallback')
  })

  it('嵌套读写与磁盘持久化（新实例可读）', async () => {
    const file = await tempFile()
    const service = createSettingsService(file)
    await service.set('shell.taskConcurrency', 4)
    await service.set('tools.example.theme', 'dark')
    expect(await service.get('shell.taskConcurrency', 2)).toBe(4)
    expect(await service.get('tools.example.theme', 'light')).toBe('dark')

    const fresh = createSettingsService(file)
    expect(await fresh.get('shell.taskConcurrency', 2)).toBe(4)
    expect(await fresh.get('tools.example.theme', 'light')).toBe('dark')
  })

  it('损坏文件回退为空对象', async () => {
    const file = await tempFile()
    await writeFile(file, 'not-json{{{', 'utf8')
    const service = createSettingsService(file)
    expect(await service.get('a.b', 'fallback')).toBe('fallback')
    await service.set('a.b', 1)
    expect(await service.get('a.b', 0)).toBe(1)
  })

  it('非对象根 JSON 回退为空对象', async () => {
    const file = await tempFile()
    await writeFile(file, '[1,2,3]', 'utf8')
    const service = createSettingsService(file)
    expect(await service.get('x', 'd')).toBe('d')
    await service.set('x', 'v')
    expect(await service.get('x', '')).toBe('v')
  })

  it('既有数组分支被替换为对象', async () => {
    const file = await tempFile()
    await writeFile(file, JSON.stringify({ list: [1, 2] }), 'utf8')
    const service = createSettingsService(file)
    await service.set('list.x', 9)
    expect(await service.get('list.x', 0)).toBe(9)
  })

  it('空键抛错', async () => {
    const service = createSettingsService(await tempFile())
    await expect(service.set('', 1)).rejects.toThrow('设置键无效')
  })

  it('写入后无临时文件残留且内容为合法 JSON', async () => {
    const file = await tempFile()
    const service = createSettingsService(file)
    await service.set('k', { nested: true })
    const entries = await readdir(dirname(file))
    expect(entries.filter((name) => name.endsWith('.tmp'))).toEqual([])
    const raw = await readFile(file, 'utf8')
    expect(JSON.parse(raw)).toEqual({ k: { nested: true } })
  })
})
