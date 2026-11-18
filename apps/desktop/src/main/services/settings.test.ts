import { afterEach, describe, expect, it } from 'vitest'
import { mkdtemp, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
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

  it('并发 set 不丢写、不抛错（Windows rename EPERM 竞态，R2.6 实测）', async () => {
    const file = await tempFile()
    const service = createSettingsService(file)
    await service.set('warm', 1) // 先落盘一次，使后续并发 rename 命中已存在目标
    const results = await Promise.allSettled(
      Array.from({ length: 50 }, (_, i) => service.set(`k${i}`, i))
    )
    const rejected = results.filter((r) => r.status === 'rejected')
    expect(rejected).toEqual([])
    // 全部写入落盘（队列串行，最后一致）
    for (let i = 0; i < 50; i++) {
      expect(await service.get(`k${i}`, -1)).toBe(i)
    }
  })

  it('rename 瞬时占用（EPERM）重试后成功', async () => {
    const file = await tempFile()
    const service = createSettingsService(file)
    await service.set('a', 1)

    let renameCalls = 0
    const retrying = createSettingsService(file, {
      renameImpl: async (from, to) => {
        renameCalls++
        if (renameCalls === 1) throw Object.assign(new Error('占用'), { code: 'EPERM' })
        return rename(from, to)
      }
    })
    await retrying.set('b', 2)
    expect(renameCalls).toBe(2)
    expect(await retrying.get('b', 0)).toBe(2)
  })

  it('rename 瞬时占用重试上限 5 次后直抛', async () => {
    const file = await tempFile()
    let renameCalls = 0
    const service = createSettingsService(file, {
      renameImpl: async () => {
        renameCalls++
        throw Object.assign(new Error('一直占用'), { code: 'EPERM' })
      }
    })
    await expect(service.set('a', 1)).rejects.toMatchObject({ code: 'EPERM' })
    expect(renameCalls).toBe(5)
  })

  it('rename 非瞬时错误（ENOENT）直抛不重试', async () => {
    const file = await tempFile()
    let renameCalls = 0
    const service = createSettingsService(file, {
      renameImpl: async () => {
        renameCalls++
        throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' })
      }
    })
    await expect(service.set('a', 1)).rejects.toMatchObject({ code: 'ENOENT' })
    expect(renameCalls).toBe(1)
  })

  it('rename 无 code 的裸错误不重试', async () => {
    const file = await tempFile()
    let renameCalls = 0
    const service = createSettingsService(file, {
      renameImpl: async () => {
        renameCalls++
        throw new Error('裸错误')
      }
    })
    await expect(service.set('a', 1)).rejects.toThrow('裸错误')
    expect(renameCalls).toBe(1)
  })

  it('EACCES 同样走瞬时重试', async () => {
    const file = await tempFile()
    const service = createSettingsService(file)
    await service.set('a', 1)
    let renameCalls = 0
    const retrying = createSettingsService(file, {
      renameImpl: async (from, to) => {
        renameCalls++
        if (renameCalls === 1) throw Object.assign(new Error('EACCES'), { code: 'EACCES' })
        return rename(from, to)
      }
    })
    await retrying.set('c', 3)
    expect(renameCalls).toBe(2)
    expect(await retrying.get('c', 0)).toBe(3)
  })

  it('写链失败不断链：失败后下一次 set 仍落盘', async () => {
    const file = await tempFile()
    const service = createSettingsService(file)
    const service2 = createSettingsService(file, {
      renameImpl: async () => {
        throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' })
      }
    })
    await expect(service2.set('bad', 0)).rejects.toMatchObject({ code: 'ENOENT' })
    await service.set('good', 42) // 失败后的写入仍入队并成功
    expect(await service.get('good', 0)).toBe(42)
    expect(await service.get('bad', -1)).toBe(-1) // 失败写入未落盘
  })
})
