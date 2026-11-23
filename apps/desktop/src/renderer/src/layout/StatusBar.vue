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
    class="flex h-8 shrink-0 items-center justify-between gap-3 border-t border-[var(--lumin-color-border)] bg-[var(--lumin-color-surface)] px-4 text-[11px] text-[var(--lumin-color-text-tertiary)]"
  >
    <span class="flex min-w-0 items-center gap-1.5">
      <span
        class="h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--lumin-color-success)]"
        aria-hidden="true"
      />
      <span class="truncate">{{ t('shell.status.offline') }}</span>
    </span>
    <span v-if="info" class="shrink-0 truncate tabular-nums">
      v{{ info.appVersion }} · Electron {{ info.electronVersion }}
    </span>
  </footer>
</template>
