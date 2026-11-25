/**
 * @file text-toolbox（文本工具箱）e2e 冒烟：真实 Electron 驱动页面交互
 * @author cuilanchao
 * @date 2026-11-23
 * @description 覆盖：页面加载与空态、JSON 格式化成功 + 非法 JSON 报错、Base64 编解码往返与交换、
 *              正则匹配列表与替换预览、CSV/JSON 互转、拼音转换、URL 编解码往返、SQL 美化/压缩幂等
 *              （纯 renderer 工具，零 IPC）。
 */
import path from 'node:path'
import { test, expect, _electron as electron, type ElectronApplication } from '@playwright/test'
import { clickSidebarTool } from './sidebar'
import type { LuminBridge } from '@lumin/plugin-api'

declare global {
  interface Window {
    lumin: LuminBridge
  }
}

const appDir = path.resolve(__dirname, '..')

async function launch(): Promise<{
  app: ElectronApplication
  page: Awaited<ReturnType<ElectronApplication['firstWindow']>>
}> {
  const app = await electron.launch({ args: ['.'], cwd: appDir })
  const page = await app.firstWindow()
  return { app, page }
}

/** 等待壳渲染层就绪（window.lumin 暴露完成后才可安全操作） */
async function ensureReady(
  page: Awaited<ReturnType<ElectronApplication['firstWindow']>>
): Promise<void> {
  await page.waitForLoadState('domcontentloaded')
  await page.waitForFunction(() => typeof window.lumin !== 'undefined')
}

test.describe('text-toolbox（文本工具箱）冒烟', () => {
  test('页面加载 + JSON 空态与格式化成功', async () => {
    const { app, page } = await launch()
    await ensureReady(page)
    try {
      await clickSidebarTool(page, '文本工具箱')
      await expect(page.getByRole('heading', { name: '文本工具箱' })).toBeVisible()

      await page.getByPlaceholder('粘贴 JSON 文本').fill('{"name":"Lumin","tags":["工具"],"v":1}')
      await page.getByRole('button', { name: '格式化', exact: true }).click()
      await expect(page.getByPlaceholder('格式化结果')).toHaveValue(
        '{\n  "name": "Lumin",\n  "tags": [\n    "工具"\n  ],\n  "v": 1\n}'
      )
      await expect(page.getByText(/输入 \d+ 字节 → 输出 \d+ 字节/)).toBeVisible()
    } finally {
      await app.close()
    }
  })

  test('非法 JSON 显示结构化错误（码 → 中文文案 + 行列详情）', async () => {
    const { app, page } = await launch()
    await ensureReady(page)
    try {
      await clickSidebarTool(page, '文本工具箱')
      await page.getByPlaceholder('粘贴 JSON 文本').fill('{\n  "a": 1,\n}')
      await page.getByRole('button', { name: '压缩', exact: true }).click()
      await expect(page.getByText('JSON 格式不正确', { exact: false })).toBeVisible()
      await expect(page.getByText(/第 3 行第 1 列/).first()).toBeVisible()
    } finally {
      await app.close()
    }
  })

  test('Base64 编码 → 交换 → 解码往返（UTF-8 中文）', async () => {
    const { app, page } = await launch()
    await ensureReady(page)
    try {
      await clickSidebarTool(page, '文本工具箱')
      await page.locator('.n-tabs-tab[data-name="codec"]').click()
      await page.getByPlaceholder('粘贴要编码或解码的文本').fill('你好 Lumin')
      await page.getByRole('button', { name: '编码', exact: true }).click()
      await expect(page.getByPlaceholder('处理结果')).toHaveValue('5L2g5aW9IEx1bWlu')

      await page.getByRole('button', { name: '交换', exact: true }).click()
      await expect(page.getByPlaceholder('粘贴要编码或解码的文本')).toHaveValue('5L2g5aW9IEx1bWlu')
      await page.getByRole('button', { name: '解码', exact: true }).click()
      await expect(page.getByPlaceholder('处理结果')).toHaveValue('你好 Lumin')
    } finally {
      await app.close()
    }
  })

  test('正则匹配列表 + 替换预览（$1 分组）', async () => {
    const { app, page } = await launch()
    await ensureReady(page)
    try {
      await clickSidebarTool(page, '文本工具箱')
      await page.locator('.n-tabs-tab[data-name="regex"]').click()
      await expect(
        page.getByText('输入模式与测试文本后点击「测试匹配」', { exact: false })
      ).toBeVisible()

      await page.getByPlaceholder('如 (\\d+)').fill('(\\d+)')
      await page.getByPlaceholder('测试文本').fill('订单 A-1024，订单 B-2048')
      await page.getByRole('button', { name: '测试匹配', exact: true }).click()
      await expect(page.getByText(/匹配 2 处/).first()).toBeVisible()

      await page.getByPlaceholder('替换为（支持 $1–$9 / $&）').fill('<$1>')
      await page.getByRole('button', { name: '替换预览', exact: true }).click()
      await expect(page.getByText('替换结果（2 处）')).toBeVisible()
      await expect(page.locator('textarea[readonly]').last()).toHaveValue(
        '订单 A-<1024>，订单 B-<2048>'
      )
    } finally {
      await app.close()
    }
  })

  test('CSV → JSON 转换（引号与表头）', async () => {
    const { app, page } = await launch()
    await ensureReady(page)
    try {
      await clickSidebarTool(page, '文本工具箱')
      await page.locator('.n-tabs-tab[data-name="csv"]').click()
      const input = page.getByPlaceholder('粘贴 CSV 文本（支持引号包裹与字段内换行）')
      await input.fill('name,desc\n张三,"a,b"')
      await page.getByRole('button', { name: '转换', exact: true }).click()
      await expect(page.getByPlaceholder('转换结果')).toHaveValue(
        JSON.stringify([{ name: '张三', desc: 'a,b' }], null, 2)
      )
    } finally {
      await app.close()
    }
  })

  test('JSON → CSV 转换与列数不一致报错', async () => {
    const { app, page } = await launch()
    await ensureReady(page)
    try {
      await clickSidebarTool(page, '文本工具箱')
      await page.locator('.n-tabs-tab[data-name="csv"]').click()
      await page.locator('select[aria-label="转换方向"]').selectOption('json2csv')
      const input = page.getByPlaceholder('粘贴 JSON 对象数组，如 [{"name":"张三"}]')
      await input.fill('[{"name":"张三","age":42},{"name":"李四"}]')
      await page.getByRole('button', { name: '转换', exact: true }).click()
      // textarea 的 value 按 HTML 规范把 CRLF 归一为 LF，故这里断言 LF
      await expect(page.getByPlaceholder('转换结果')).toHaveValue('name,age\n张三,42\n李四,')

      await page.locator('select[aria-label="转换方向"]').selectOption('csv2json')
      // 方向切换后 placeholder 随之变化，需重新定位输入框
      const csvInput = page.getByPlaceholder('粘贴 CSV 文本（支持引号包裹与字段内换行）')
      await csvInput.fill('a,b\n1')
      await page.getByRole('button', { name: '转换', exact: true }).click()
      await expect(page.getByText('CSV/JSON 数据格式不正确', { exact: false })).toBeVisible()
      await expect(page.getByText(/第 2 行：列数 1 与表头 2 不一致/).first()).toBeVisible()
    } finally {
      await app.close()
    }
  })

  test('拼音转换（带声调与首字母）', async () => {
    const { app, page } = await launch()
    await ensureReady(page)
    try {
      await clickSidebarTool(page, '文本工具箱')
      await page.locator('.n-tabs-tab[data-name="pinyin"]').click()
      const input = page.getByPlaceholder('粘贴要注音的汉字文本，如：重庆 你好')
      const output = page.getByPlaceholder('注音结果')
      await input.fill('重庆 你好 Lumin 2026')
      await page.getByRole('button', { name: '转换', exact: true }).click()
      await expect(output).toHaveValue('chóng qìng nǐ hǎo Lumin 2026')

      await page.locator('select[aria-label="拼音模式"]').selectOption('initial')
      await page.getByRole('button', { name: '转换', exact: true }).click()
      await expect(output).toHaveValue('cq nh Lumin 2026')
    } finally {
      await app.close()
    }
  })

  test('URL 编码：中文与空格编码 → 解码往返一致', async () => {
    const { app, page } = await launch()
    await ensureReady(page)
    try {
      await clickSidebarTool(page, '文本工具箱')
      await page.locator('.n-tabs-tab[data-name="url"]').click()
      const input = page.getByPlaceholder('粘贴要编码或解码的源文本')
      const output = page.getByPlaceholder('处理结果')
      await input.fill('你好 Lumin 2026')
      await page.getByRole('button', { name: '编码', exact: true }).click()
      await expect(output).toHaveValue('%E4%BD%A0%E5%A5%BD%20Lumin%202026')

      await input.fill(await output.inputValue())
      await page.getByRole('button', { name: '解码', exact: true }).click()
      await expect(output).toHaveValue('你好 Lumin 2026')
    } finally {
      await app.close()
    }
  })

  test('SQL 美化换行大写且保留字符串注释，压缩幂等', async () => {
    const { app, page } = await launch()
    await ensureReady(page)
    try {
      await clickSidebarTool(page, '文本工具箱')
      await page.locator('.n-tabs-tab[data-name="sql"]').click()
      const input = page.getByPlaceholder('粘贴 SQL 语句')
      const output = page.getByPlaceholder('格式化结果')
      await input.fill("select id, name from users where status = 'active' -- 状态\nand age > 18")
      await page.getByRole('button', { name: '美化', exact: true }).click()
      await expect(output).toHaveValue(
        "SELECT id, name\nFROM users\nWHERE status = 'active' -- 状态\n  AND age > 18"
      )

      // 对美化结果再压缩：折叠换行缩进，字符串与注释原样；再压缩一次结果不变（幂等）
      await input.fill(await output.inputValue())
      await page.getByRole('button', { name: '压缩', exact: true }).click()
      const minified = await output.inputValue()
      expect(minified).toBe(
        "SELECT id, name FROM users WHERE status = 'active' -- 状态\nAND age > 18"
      )
      await input.fill(minified)
      await page.getByRole('button', { name: '压缩', exact: true }).click()
      await expect(output).toHaveValue(minified)
    } finally {
      await app.close()
    }
  })

  test('M77 并入页签标签可见（编辑 / 对比）', async () => {
    const { app, page } = await launch()
    await ensureReady(page)
    try {
      await clickSidebarTool(page, '文本工具箱')
      for (const [name, label] of [
        ['editor', '编辑'],
        ['diff', '对比']
      ] as const) {
        const tab = page.locator(`.n-tabs-tab[data-name="${name}"]`)
        await tab.scrollIntoViewIfNeeded()
        await expect(tab).toHaveText(label)
        expect(await tab.evaluate((el) => el.getBoundingClientRect().width)).toBeGreaterThan(0)
      }
    } finally {
      await app.close()
    }
  })
})
