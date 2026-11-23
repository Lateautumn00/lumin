import path from 'node:path'
import { test, expect, _electron as electron, type ElectronApplication } from '@playwright/test'
import { clickSidebarTool } from './sidebar'
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
    await expect(page.getByRole('button', { name: /计算与转换/ })).toBeVisible()
    await expect(page.getByRole('button', { name: /其他/ })).toBeVisible()
    await expect(page.getByRole('heading', { name: '日历' })).toBeVisible()

    // 原生菜单栏已移除（Q60）
    const menu = await app.evaluate(({ Menu }) => Menu.getApplicationMenu())
    expect(menu).toBeNull()

    // example 置 hidden：侧边栏不展示，但 IPC 通道保留（直连 invoke 验证）
    await expect(page.getByText('示例工具')).toHaveCount(0)
    const pong = await page.evaluate(() =>
      window.lumin.invoke<{ pong: boolean; at: number }>('example:ping')
    )
    expect(pong.pong).toBe(true)
  })

  test('单位换算：类别切换单位重置 + 实时换算 + 收藏', async () => {
    const page = await app.firstWindow()
    await page.evaluate(() => localStorage.removeItem('lumin.tool.unit-converter.favorites'))
    await clickSidebarTool(page, '单位换算')
    await expect(page.getByRole('heading', { name: '单位换算' })).toBeVisible()

    const value = page.getByPlaceholder('输入数值')
    await value.fill('1')
    await expect(page.getByText('= 0.001').first()).toBeVisible()

    await value.fill('1234567')
    await expect(page.getByText('= 1234.567').first()).toBeVisible()

    await page.getByLabel('交换单位').click()
    await expect(page.getByText('= 1234567000').first()).toBeVisible()

    await value.fill('abc')
    await expect(page.getByText('请输入有效数值')).toBeVisible()

    await page.getByLabel('换算类别').click()
    await page.getByText('温度', { exact: true }).click()
    await value.fill('373.15')
    await expect(page.getByText('= 100').first()).toBeVisible()
    await expect(page.getByRole('button', { name: '收藏源单位' })).toBeVisible()
    await page.getByRole('button', { name: '收藏源单位' }).click()
    await expect(page.getByRole('button', { name: '取消收藏源单位' })).toBeVisible()
    await page.getByRole('button', { name: '收藏目标单位' }).click()
    await value.fill('0')
    await expect(page.getByText('= -273.15').first()).toBeVisible()

    await page.reload()
    await clickSidebarTool(page, '单位换算')
    await page.getByLabel('换算类别').click()
    await page.getByText('温度', { exact: true }).click()
    await expect(page.getByRole('button', { name: '取消收藏源单位' })).toBeVisible()
    await expect(page.getByRole('button', { name: '取消收藏目标单位' })).toBeVisible()
  })

  test('单位换算：能量/油耗新类别（倒数换算与错误态）', async () => {
    const page = await app.firstWindow()
    await clickSidebarTool(page, '单位换算')
    await expect(page.getByRole('heading', { name: '单位换算' })).toBeVisible()
    const value = page.getByPlaceholder('输入数值')
    const categorySelect = page.getByLabel('换算类别')

    // 类别列表 17 项且 NSelect 虚拟滚动，用键盘导航到「油耗」（index 13）
    await categorySelect.click()
    for (let i = 0; i < 13; i += 1) await categorySelect.press('ArrowDown')
    await categorySelect.press('Enter')
    await value.fill('5')
    await expect(page.getByText('= 20').first()).toBeVisible()
    await value.fill('0')
    await expect(page.getByText('油耗数值必须大于 0')).toBeVisible()

    // 从「油耗」(13) 上移 2 项到「能量」(11)
    await categorySelect.click()
    for (let i = 0; i < 2; i += 1) await categorySelect.press('ArrowUp')
    await categorySelect.press('Enter')
    await value.fill('1')
    await expect(page.getByText('= 0.001').first()).toBeVisible()
  })

  test('计算器求值（白名单 + DEG 角度 + 历史）', async () => {
    const page = await app.firstWindow()
    await clickSidebarTool(page, '计算器')
    const input = page.getByPlaceholder('输入表达式，Enter 计算')
    await input.fill('sin(90)+2^8')
    await input.press('Enter')
    await expect(page.getByText(/^= 257$/).first()).toBeVisible()
    await expect(page.getByText('sin(90)+2^8').last()).toBeVisible()
    await input.fill('1/0')
    await input.press('Enter')
    await expect(page.getByText('结果无效（除零或溢出）')).toBeVisible()

    await page.reload()
    await clickSidebarTool(page, '计算器')
    await expect(page.getByText('sin(90)+2^8').last()).toBeVisible()
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
