<script setup lang="ts">
import { nextTick, ref, watch } from 'vue'
import { NConfigProvider, darkTheme, type GlobalThemeOverrides } from 'naive-ui'
import { useThemeStore } from './stores/theme'
import { buildThemeOverrides } from './theme/naive'

const themeStore = useThemeStore()

/** naive-ui 主题取 tokens 解析值：其内部对颜色做 rgba 运算，无法解析 var()（R4 单源：值仍来自 main.css） */
function cssToken(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim()
}

const themeOverrides = ref<GlobalThemeOverrides>(buildThemeOverrides(cssToken))

// 主题切换后 tokens 已换值：待 DOM 属性生效再重算，Naive 才能拿到新计算值
watch(
  () => themeStore.resolved,
  async () => {
    await nextTick()
    themeOverrides.value = buildThemeOverrides(cssToken)
  }
)
</script>

<template>
  <NConfigProvider
    :theme="themeStore.resolved === 'dark' ? darkTheme : null"
    :theme-overrides="themeOverrides"
    class="h-full"
  >
    <router-view />
  </NConfigProvider>
</template>
