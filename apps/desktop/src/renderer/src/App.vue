<script setup lang="ts">
import { NConfigProvider, type GlobalThemeOverrides } from 'naive-ui'

/** naive-ui 主题取 tokens 解析值：其内部对颜色做 rgba 运算，无法解析 var()（R4 单源：值仍来自 main.css） */
function cssToken(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim()
}

const themeOverrides: GlobalThemeOverrides = {
  common: {
    primaryColor: cssToken('--lumin-color-primary'),
    primaryColorHover: cssToken('--lumin-color-primary-hover'),
    primaryColorPressed: cssToken('--lumin-color-primary'),
    borderRadius: cssToken('--lumin-radius-md'),
    fontSize: cssToken('--lumin-font-size-md'),
    fontFamily: "'Segoe UI', 'Microsoft YaHei', system-ui, sans-serif"
  }
}
</script>

<template>
  <NConfigProvider :theme-overrides="themeOverrides" class="h-full">
    <router-view />
  </NConfigProvider>
</template>
