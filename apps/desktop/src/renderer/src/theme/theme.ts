/**
 * @file 主题模式解析与生效（纯函数，供壳与测试复用）
 * @author cuilanchao
 * @date 2026-11-19
 * @description 三值模式（system/light/dark）→ 解析为 light/dark，并写入 html[data-theme]
 */
export type ThemeMode = 'system' | 'light' | 'dark'
export type ResolvedTheme = 'light' | 'dark'

export const THEME_MODE_KEY = 'shell.theme.mode'
export const DEFAULT_THEME_MODE: ThemeMode = 'system'

/** 仅接受三值，其余（含 undefined/数字/非法字符串）一律回落 system */
export function parseThemeMode(value: unknown): ThemeMode {
  return value === 'light' || value === 'dark' || value === 'system' ? value : DEFAULT_THEME_MODE
}

/** system 模式按系统偏好解析；显式 light/dark 忽略系统偏好 */
export function resolveTheme(mode: ThemeMode, systemDark: boolean): ResolvedTheme {
  if (mode === 'light') return 'light'
  if (mode === 'dark') return 'dark'
  return systemDark ? 'dark' : 'light'
}

/** 写 data-theme；tokens 由 main.css 的 `:root[data-theme='dark']` 覆盖 */
export function applyThemeAttribute(
  el: { dataset: Record<string, string | undefined> },
  resolved: ResolvedTheme
): void {
  el.dataset['theme'] = resolved
}
