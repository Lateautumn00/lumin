<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { NButton, NModal, NTable, NText } from 'naive-ui'
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
  <div class="mx-auto flex w-full max-w-4xl flex-col gap-6">
    <header class="flex items-start gap-3">
      <span class="lumin-brand-mark mt-0.5 h-9 w-9 rounded-[var(--lumin-radius-md)]">
        <span class="text-base font-semibold">L</span>
      </span>
      <div class="flex min-w-0 flex-col gap-1">
        <p
          class="text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--lumin-color-text-tertiary)]"
        >
          LUMIN
        </p>
        <h1 class="text-2xl font-semibold tracking-tight">{{ t('shell.about.title') }}</h1>
        <p class="text-sm text-[var(--lumin-color-text-secondary)]">
          {{ t('shell.about.subtitle') }}
        </p>
      </div>
    </header>

    <div class="grid gap-4 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
      <section
        class="rounded-[var(--lumin-radius-lg)] border border-[var(--lumin-color-border)] bg-[var(--lumin-color-surface)] p-5 shadow-[var(--lumin-shadow-sm)]"
      >
        <h2 class="text-sm font-semibold">{{ t('shell.about.section.runtime') }}</h2>
        <NTable v-if="info" :bordered="false" size="small" class="mt-3">
          <tbody>
            <tr>
              <td class="w-28 text-[var(--lumin-color-text-secondary)]">应用版本</td>
              <td class="tabular-nums">{{ info.appVersion }}</td>
            </tr>
            <tr>
              <td class="text-[var(--lumin-color-text-secondary)]">Electron</td>
              <td class="tabular-nums">{{ info.electronVersion }}</td>
            </tr>
            <tr>
              <td class="text-[var(--lumin-color-text-secondary)]">Chrome</td>
              <td class="tabular-nums">{{ info.chromeVersion }}</td>
            </tr>
            <tr>
              <td class="text-[var(--lumin-color-text-secondary)]">Node</td>
              <td class="tabular-nums">{{ info.nodeVersion }}</td>
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
      </section>

      <div class="flex flex-col gap-4">
        <section
          class="rounded-[var(--lumin-radius-lg)] border border-[var(--lumin-color-border)] bg-[var(--lumin-color-surface)] p-5 shadow-[var(--lumin-shadow-sm)]"
        >
          <h2 class="text-sm font-semibold">{{ t('shell.about.section.update') }}</h2>
          <div class="mt-3 flex flex-wrap items-center gap-2">
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
          </div>
          <NText v-if="updateHint" :type="updateHintType" class="mt-2 block text-xs">
            {{ updateHint }}
          </NText>
        </section>

        <section
          class="rounded-[var(--lumin-radius-lg)] border border-[var(--lumin-color-border)] bg-[var(--lumin-color-surface)] p-5 shadow-[var(--lumin-shadow-sm)]"
        >
          <h2 class="text-sm font-semibold">{{ t('shell.about.section.support') }}</h2>
          <div class="mt-3 flex flex-wrap items-center gap-2">
            <NButton size="small" @click="openLogDir">{{ t('shell.about.openLog') }}</NButton>
            <NButton size="small" quaternary @click="statementVisible = true">
              {{ t('shell.about.statement') }}
            </NButton>
          </div>
          <NText v-if="logError" type="error" class="mt-2 block text-xs">
            {{ t('shell.about.logFailed') }}：{{ logError }}
          </NText>
        </section>
      </div>
    </div>

    <NModal
      v-model:show="statementVisible"
      preset="card"
      :title="t('shell.about.statement.title')"
      class="max-w-lg"
    >
      <p class="text-sm leading-relaxed text-[var(--lumin-color-text-secondary)]">
        {{ t('shell.about.statement.body') }}
      </p>
    </NModal>
  </div>
</template>
