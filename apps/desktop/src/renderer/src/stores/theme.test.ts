import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useThemeStore } from './theme'

interface FakePanel {
  dataset: Record<string, string | undefined>
}

let panel: FakePanel
let storedMode: unknown
let setCalls: { key: string; value: unknown }[]
let writeFails: boolean
let readFails: boolean
let mediaMatches: boolean
let mediaHandler: ((event: { matches: boolean }) => void) | null

beforeEach(() => {
  panel = { dataset: {} }
  storedMode = 'system'
  setCalls = []
  writeFails = false
  readFails = false
  mediaMatches = false
  mediaHandler = null

  vi.stubGlobal('document', { documentElement: panel })
  vi.stubGlobal('window', {
    lumin: {
      settings: {
        get: async <T>(_key: string, defaultValue: T): Promise<T> => {
          if (readFails) throw new Error('读取失败')
          return (storedMode === undefined ? defaultValue : storedMode) as T
        },
        set: async (key: string, value: unknown): Promise<void> => {
          if (writeFails) throw new Error('写入失败')
          setCalls.push({ key, value })
        }
      }
    },
    matchMedia: (): {
      matches: boolean
      addEventListener: (type: string, handler: (event: { matches: boolean }) => void) => void
      removeEventListener: () => void
    } => ({
      get matches(): boolean {
        return mediaMatches
      },
      addEventListener: (_type, handler) => {
        mediaHandler = handler
      },
      removeEventListener: () => undefined
    })
  })
  setActivePinia(createPinia())
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('useThemeStore', () => {
  it('默认 system，按系统偏好解析并写入 data-theme', async () => {
    const store = useThemeStore()
    await store.load()
    expect(store.mode).toBe('system')
    expect(store.resolved).toBe('light')
    expect(panel.dataset['theme']).toBe('light')
  })

  it('存量 dark 直接生效', async () => {
    storedMode = 'dark'
    const store = useThemeStore()
    await store.load()
    expect(store.mode).toBe('dark')
    expect(store.resolved).toBe('dark')
    expect(panel.dataset['theme']).toBe('dark')
  })

  it('非法存量回落 system', async () => {
    storedMode = 'sepia'
    const store = useThemeStore()
    await store.load()
    expect(store.mode).toBe('system')
  })

  it('系统偏好变化仅 system 模式生效', async () => {
    const store = useThemeStore()
    await store.load()
    mediaHandler?.({ matches: true })
    expect(store.resolved).toBe('dark')
    expect(panel.dataset['theme']).toBe('dark')

    await store.setMode('light')
    mediaHandler?.({ matches: true })
    expect(store.resolved).toBe('light')
    expect(panel.dataset['theme']).toBe('light')
  })

  it('setMode 立即应用并持久化键值', async () => {
    const store = useThemeStore()
    await store.load()
    await store.setMode('dark')
    expect(store.mode).toBe('dark')
    expect(store.resolved).toBe('dark')
    expect(panel.dataset['theme']).toBe('dark')
    expect(setCalls).toEqual([{ key: 'shell.theme.mode', value: 'dark' }])
  })

  it('写入失败回滚到切换前模式并抛出', async () => {
    storedMode = 'light'
    const store = useThemeStore()
    await store.load()
    writeFails = true
    await expect(store.setMode('dark')).rejects.toThrow('写入失败')
    expect(store.mode).toBe('light')
    expect(store.resolved).toBe('light')
    expect(panel.dataset['theme']).toBe('light')
  })

  it('读取失败回落 system 且继续应用', async () => {
    readFails = true
    const store = useThemeStore()
    await store.load()
    expect(store.mode).toBe('system')
    expect(store.resolved).toBe('light')
    expect(panel.dataset['theme']).toBe('light')
  })
})
