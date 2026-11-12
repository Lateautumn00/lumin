<script setup lang="ts">
import { NConfigProvider, type GlobalThemeOverrides } from 'naive-ui'

const themeOverrides: GlobalThemeOverrides = {
  common: {
    primaryColor: 'var(--lumin-color-primary)',
    primaryColorHover: 'var(--lumin-color-primary-hover)',
    primaryColorPressed: 'var(--lumin-color-primary)',
    borderRadius: 'var(--lumin-radius-md)',
    fontSize: 'var(--lumin-font-size-md)',
    fontFamily: "'Segoe UI', 'Microsoft YaHei', system-ui, sans-serif"
  }
}
</script>

<template>
  <NConfigProvider :theme-overrides="themeOverrides" class="h-full">
    <router-view />
  </NConfigProvider>
</template>
