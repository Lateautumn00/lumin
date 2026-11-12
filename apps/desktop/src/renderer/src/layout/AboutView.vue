<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { NButton, NSpace, NTable, NText } from 'naive-ui'
import { toStructuredError } from '@lumin/shared'
import type { AppInfo } from '@lumin/plugin-api'
import { t } from '../i18n/zh-CN'

const info = ref<AppInfo | null>(null)
const logError = ref('')

onMounted(() => {
  void window.lumin
    .getAppInfo()
    .then((value) => {
      info.value = value
    })
    .catch(() => undefined)
})

async function openLogDir(): Promise<void> {
  logError.value = ''
  try {
    await window.lumin.openLogDir()
  } catch (err) {
    logError.value = toStructuredError(err).message
  }
}
</script>

<template>
  <div class="flex max-w-md flex-col gap-4">
    <h1 class="text-base font-semibold">{{ t('shell.about.title') }}</h1>
    <NTable v-if="info" :bordered="false" size="small">
      <tbody>
        <tr>
          <td class="w-28 text-[var(--lumin-color-text-secondary)]">应用版本</td>
          <td>{{ info.appVersion }}</td>
        </tr>
        <tr>
          <td class="text-[var(--lumin-color-text-secondary)]">Electron</td>
          <td>{{ info.electronVersion }}</td>
        </tr>
        <tr>
          <td class="text-[var(--lumin-color-text-secondary)]">Chrome</td>
          <td>{{ info.chromeVersion }}</td>
        </tr>
        <tr>
          <td class="text-[var(--lumin-color-text-secondary)]">Node</td>
          <td>{{ info.nodeVersion }}</td>
        </tr>
        <tr>
          <td class="text-[var(--lumin-color-text-secondary)]">平台</td>
          <td>{{ info.platform }}</td>
        </tr>
        <tr>
          <td class="text-[var(--lumin-color-text-secondary)]">语言</td>
          <td>{{ info.locale }}</td>
        </tr>
      </tbody>
    </NTable>
    <NSpace align="center">
      <NButton size="small" @click="openLogDir">{{ t('shell.about.openLog') }}</NButton>
      <NText v-if="logError" type="error" class="text-xs">
        {{ t('shell.about.logFailed') }}：{{ logError }}
      </NText>
    </NSpace>
  </div>
</template>
