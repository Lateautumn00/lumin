/**
 * @file 主题状态：模式读取/持久化 + 系统深浅色监听 + html[data-theme] 应用
 * @author cuilanchao
 * @date 2026-11-19
 * @description 持久化走既有 settings 通道（键 shell.theme.mode），无新增 IPC
 */
import { defineStore } from 'pinia'
import { ref } from 'vue'
import {
  DEFAULT_THEME_MODE,
  THEME_MODE_KEY,
  applyThemeAttribute,
  parseThemeMode,
  resolveTheme,
  type ResolvedTheme,
  type ThemeMode
} from '../theme/theme'

const DARK_QUERY = '(prefers-color-scheme: dark)'

export const useThemeStore = defineStore('theme', () => {
  const mode = ref<ThemeMode>(DEFAULT_THEME_MODE)
  const resolved = ref<ResolvedTheme>('light')
  let systemDark = false

  function apply(): void {
    resolved.value = resolveTheme(mode.value, systemDark)
    applyThemeAttribute(document.documentElement, resolved.value)
  }

  function onSystemChange(event: { matches: boolean }): void {
    systemDark = event.matches
    if (mode.value === 'system') apply()
  }

  async function load(): Promise<void> {
    try {
      const stored = await window.lumin.settings.get<unknown>(THEME_MODE_KEY, DEFAULT_THEME_MODE)
      mode.value = parseThemeMode(stored)
    } catch {
      mode.value = DEFAULT_THEME_MODE
    }
    const media = window.matchMedia(DARK_QUERY)
    systemDark = media.matches
    media.addEventListener('change', onSystemChange)
    apply()
  }

  /** 选中即持久化；写入失败回滚到切换前模式并向上抛（设置页展示） */
  async function setMode(next: ThemeMode): Promise<void> {
    const previous = mode.value
    mode.value = next
    apply()
    try {
      await window.lumin.settings.set(THEME_MODE_KEY, next)
    } catch (err) {
      mode.value = previous
      apply()
      throw err
    }
  }

  return { mode, resolved, load, setMode }
})
