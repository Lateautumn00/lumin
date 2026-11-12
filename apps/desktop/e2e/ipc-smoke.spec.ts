import path from 'node:path'
import { test, expect, _electron as electron, type ElectronApplication } from '@playwright/test'
import type { TaskEvent } from '@lumin/shared'
import type { LuminBridge } from '@lumin/plugin-api'

declare global {
  interface Window {
    lumin: LuminBridge
  }
}

const appDir = path.resolve(__dirname, '..')

test.describe('IPC 冒烟（R3）', () => {
  let app: ElectronApplication

  test.beforeEach(async () => {
    app = await electron.launch({ args: ['.'], cwd: appDir })
  })

  test.afterEach(async () => {
    await app.close()
  })

  test('启动渲染工具清单', async () => {
    const page = await app.firstWindow()
    await expect(page.getByRole('link', { name: '示例工具' })).toBeVisible()
    await expect(page.getByRole('heading', { name: '示例工具' })).toBeVisible()
  })

  test('同步 invoke：app info / ping / settings 往返', async () => {
    const page = await app.firstWindow()

    const info = await page.evaluate(() => window.lumin.getAppInfo())
    expect(info.appVersion).toMatch(/^\d+\.\d+\.\d+/)
    expect(info.platform).toBe(process.platform)

    const pong = await page.evaluate(() =>
      window.lumin.invoke<{ pong: boolean; at: number }>('example:ping')
    )
    expect(pong.pong).toBe(true)
    expect(pong.at).toBeGreaterThan(0)

    await page.evaluate(() => window.lumin.settings.set('smoke.answer', 42))
    const answer = await page.evaluate(() => window.lumin.settings.get<number>('smoke.answer', 0))
    expect(answer).toBe(42)

    const update = await page.evaluate(() =>
      window.lumin.invoke<{ checked: boolean; reason?: string }>('lumin:update:check')
    )
    expect(update).toEqual({ checked: false, reason: 'dev-mode' })
  })

  test('任务三段式：submit → progress → done', async () => {
    const page = await app.firstWindow()

    const outcome = await page.evaluate(() => {
      return new Promise<{ events: TaskEvent[]; result: unknown }>((resolve, reject) => {
        const events: TaskEvent[] = []
        const off = window.lumin.onTaskEvent((ev) => {
          events.push(ev)
          if (ev.kind === 'done') {
            off()
            resolve({ events, result: ev.result })
          } else if (ev.kind === 'error') {
            off()
            reject(new Error(`${ev.error.code}: ${ev.error.message}`))
          }
        })
        window.lumin
          .invoke<{ taskId: string }>('example:sleep', { durationMs: 300 })
          .catch((err: unknown) => {
            off()
            reject(err)
          })
      })
    })

    expect(outcome.events.some((ev) => ev.kind === 'progress')).toBe(true)
    expect(outcome.result).toEqual({ slept: 300 })
  })

  test('取消任务 → CANCELLED 错误事件', async () => {
    const page = await app.firstWindow()

    const outcome = await page.evaluate(() => {
      return new Promise<{ code: string; message: string }>((resolve, reject) => {
        const off = window.lumin.onTaskEvent((ev) => {
          if (ev.kind === 'error') {
            off()
            resolve({ code: ev.error.code, message: ev.error.message })
          }
        })
        window.lumin
          .invoke<{ taskId: string }>('example:sleep', { durationMs: 5000 })
          .then(({ taskId }) => window.lumin.invoke<boolean>('lumin:task:cancel', { taskId }))
          .then((cancelled) => {
            if (!cancelled) reject(new Error('cancel 返回 false'))
          })
          .catch((err: unknown) => {
            off()
            reject(err)
          })
      })
    })

    expect(outcome).toEqual({ code: 'CANCELLED', message: '任务已取消' })
  })
})
