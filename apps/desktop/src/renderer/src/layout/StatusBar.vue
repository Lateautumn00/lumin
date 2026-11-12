<script setup lang="ts">
import { onMounted, ref } from 'vue'
import type { AppInfo } from '@lumin/plugin-api'
import { t } from '../i18n/zh-CN'

const info = ref<AppInfo | null>(null)

onMounted(() => {
  void window.lumin
    .getAppInfo()
    .then((value) => {
      info.value = value
    })
    .catch(() => undefined)
})
</script>

<template>
  <footer
    class="flex h-8 shrink-0 items-center justify-between border-t border-[var(--lumin-color-border)] px-4 text-xs text-[var(--lumin-color-text-secondary)]"
  >
    <span>{{ t('shell.status.offline') }}</span>
    <span v-if="info">v{{ info.appVersion }} · Electron {{ info.electronVersion }}</span>
  </footer>
</template>
