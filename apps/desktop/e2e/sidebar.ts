import type { Page } from '@playwright/test'

/**
 * 点击侧边栏工具入口。
 * 侧边栏按分类手风琴折叠（默认全部折叠、展开一个即收起其他），
 * 因此先点开目标工具所在分类的分类头，再点击工具链接。
 */
export async function clickSidebarTool(page: Page, name: string): Promise<void> {
  const link = page.locator('nav a').filter({ hasText: new RegExp(`^${escapeRegExp(name)}$`) })
  await link.waitFor({ state: 'attached' })
  if (!(await link.isVisible())) {
    // 按文本定位所属分类（文本匹配不受 display:none 影响），点它的分类头
    const section = page.locator('nav section').filter({ hasText: name })
    await section.locator('button').first().click()
  }
  await link.click()
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
