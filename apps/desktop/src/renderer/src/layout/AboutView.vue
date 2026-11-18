<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { NButton, NModal, NSpace, NTable, NText } from 'naive-ui'
import { toStructuredError } from '@lumin/shared'
import type { AppInfo } from '@lumin/plugin-api'
import { t } from '../i18n/zh-CN'

type UpdateState =
  'idle' | 'checking' | 'dev-mode' | 'latest' | 'downloading' | 'downloaded' | 'error'

const info = ref<AppInfo | null>(null)
const logError = ref('')
const updateState = ref<UpdateState>('idle')
const updatePercent = ref(0)
const updateVersion = ref('')
const updateError = ref('')
/** 使用声明弹窗（R8 三重呈现 #3：通用合规声明，不含任何工具名） */
const statementVisible = ref(false)
let offUpdate: (() => void) | null = null

onMounted(() => {
  void window.lumin
    .getAppInfo()
    .then((value) => {
      info.value = value
    })
    .catch(() => undefined)
  offUpdate = window.lumin.onUpdateEvent((event) => {
    switch (event.kind) {
      case 'checking':
        updateState.value = 'checking'
        break
      case 'available':
        updateState.value = 'downloading'
        updateVersion.value = event.version
        updatePercent.value = 0
        break
      case 'not-available':
        updateState.value = 'latest'
        break
      case 'downloading':
        updateState.value = 'downloading'
        updatePercent.value = event.percent
        break
      case 'downloaded':
        updateState.value = 'downloaded'
        updateVersion.value = event.version
        break
      case 'error':
        updateState.value = 'error'
        updateError.value = event.error.message
        break
    }
  })
})

onUnmounted(() => {
  offUpdate?.()
  offUpdate = null
})

const updateHint = computed(() => {
  switch (updateState.value) {
    case 'checking':
      return t('shell.about.updateChecking')
    case 'dev-mode':
      return t('shell.about.updateDevMode')
    case 'latest':
      return t('shell.about.updateLatest')
    case 'downloading':
      return `${t('shell.about.updateDownloading')} ${Math.round(updatePercent.value)}%`
    case 'downloaded':
      return updateVersion.value === ''
        ? t('shell.about.updateDownloaded')
        : `${t('shell.about.updateDownloaded')}（${updateVersion.value}）`
    case 'error':
      return updateError.value === ''
        ? t('shell.about.updateFailed')
        : `${t('shell.about.updateFailed')}：${updateError.value}`
    default:
      return ''
  }
})

const updateHintType = computed(() => {
  if (updateState.value === 'error') return 'error'
  if (updateState.value === 'downloaded' || updateState.value === 'latest') return 'success'
  return 'default'
})

async function checkUpdate(): Promise<void> {
  updateState.value = 'checking'
  updateError.value = ''
  try {
    const result = await window.lumin.invoke<{
      checked: boolean
      reason?: 'dev-mode' | 'check-failed'
    }>('lumin:update:check')
    if (!result.checked) {
      updateState.value = result.reason === 'dev-mode' ? 'dev-mode' : 'error'
      if (result.reason !== 'dev-mode') updateError.value = ''
    }
  } catch (err) {
    updateState.value = 'error'
    updateError.value = toStructuredError(err).message
  }
}

async function installUpdate(): Promise<void> {
  updateError.value = ''
  try {
    await window.lumin.invoke('lumin:update:install')
  } catch (err) {
    updateState.value = 'error'
    updateError.value = toStructuredError(err).message
  }
}

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
      <NButton size="small" quaternary @click="statementVisible = true">
        {{ t('shell.about.statement') }}
      </NButton>
      <NText v-if="logError" type="error" class="text-xs">
        {{ t('shell.about.logFailed') }}：{{ logError }}
      </NText>
    </NSpace>
    <NSpace align="center">
      <NButton
        size="small"
        :loading="updateState === 'checking'"
        :disabled="updateState === 'downloading'"
        @click="checkUpdate"
      >
        {{ t('shell.about.checkUpdate') }}
      </NButton>
      <NButton
        v-if="updateState === 'downloaded'"
        size="small"
        type="primary"
        @click="installUpdate"
      >
        {{ t('shell.about.installNow') }}
      </NButton>
      <NText v-if="updateHint" :type="updateHintType" class="text-xs">
        {{ updateHint }}
      </NText>
    </NSpace>

    <NModal v-model:show="statementVisible" preset="card" :title="t('shell.about.statement.title')" class="max-w-lg">
      <p class="text-sm leading-relaxed text-[var(--lumin-color-text-secondary)]">
        {{ t('shell.about.statement.body') }}
      </p>
    </NModal>
  </div>
</template>
