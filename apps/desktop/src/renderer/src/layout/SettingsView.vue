<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { NButton, NInputNumber, NRadio, NRadioGroup, NText } from 'naive-ui'
import { toStructuredError } from '@lumin/shared'
import { useSettingsStore } from '../stores/settings'
import { useThemeStore } from '../stores/theme'
import type { ThemeMode } from '../theme/theme'
import { t } from '../i18n/zh-CN'

const store = useSettingsStore()
const themeStore = useThemeStore()
const saving = ref(false)
const status = ref('')
const themeSaving = ref(false)
const themeError = ref('')

onMounted(() => {
  void store.load()
})

async function save(): Promise<void> {
  saving.value = true
  status.value = ''
  try {
    await store.save()
    status.value = t('shell.settings.saved')
  } catch {
    status.value = t('shell.settings.saveFailed')
  } finally {
    saving.value = false
  }
}

function isThemeMode(value: unknown): value is ThemeMode {
  return value === 'system' || value === 'light' || value === 'dark'
}

async function changeTheme(value: ThemeMode): Promise<void> {
  themeSaving.value = true
  themeError.value = ''
  try {
    await themeStore.setMode(value)
  } catch (err) {
    themeError.value = toStructuredError(err).message
  } finally {
    themeSaving.value = false
  }
}

function onThemeChange(value: string | number | boolean): void {
  if (isThemeMode(value)) void changeTheme(value)
}
</script>

<template>
  <div class="mx-auto flex w-full max-w-3xl flex-col gap-6">
    <header class="flex flex-col gap-1">
      <p
        class="text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--lumin-color-text-tertiary)]"
      >
        LUMIN
      </p>
      <h1 class="text-2xl font-semibold tracking-tight">{{ t('shell.settings.title') }}</h1>
      <p class="text-sm text-[var(--lumin-color-text-secondary)]">
        {{ t('shell.settings.subtitle') }}
      </p>
    </header>

    <section
      class="rounded-[var(--lumin-radius-lg)] border border-[var(--lumin-color-border)] bg-[var(--lumin-color-surface)] p-5 shadow-[var(--lumin-shadow-sm)] sm:p-6"
    >
      <h2 class="text-sm font-semibold">{{ t('shell.settings.section.performance') }}</h2>
      <div class="mt-4 flex flex-wrap items-center gap-3">
        <span class="text-sm text-[var(--lumin-color-text)]">
          {{ t('shell.settings.concurrency') }}
        </span>
        <NInputNumber v-model:value="store.taskConcurrency" :min="1" :max="8" class="w-28" />
        <NButton type="primary" :loading="saving" @click="save">
          {{ t('shell.settings.save') }}
        </NButton>
        <NText v-if="status" depth="3" class="text-xs">{{ status }}</NText>
      </div>
      <p class="mt-2 text-xs text-[var(--lumin-color-text-secondary)]">
        {{ t('shell.settings.concurrencyHint') }}
      </p>
    </section>

    <section
      class="rounded-[var(--lumin-radius-lg)] border border-[var(--lumin-color-border)] bg-[var(--lumin-color-surface)] p-5 shadow-[var(--lumin-shadow-sm)] sm:p-6"
    >
      <h2 class="text-sm font-semibold">{{ t('shell.settings.section.appearance') }}</h2>
      <div class="mt-4 flex flex-col gap-2">
        <span class="text-sm text-[var(--lumin-color-text)]">{{ t('shell.settings.theme') }}</span>
        <NRadioGroup :value="themeStore.mode" :disabled="themeSaving" @update:value="onThemeChange">
          <NRadio value="system">{{ t('shell.settings.themeSystem') }}</NRadio>
          <NRadio value="light">{{ t('shell.settings.themeLight') }}</NRadio>
          <NRadio value="dark">{{ t('shell.settings.themeDark') }}</NRadio>
        </NRadioGroup>
        <p class="text-xs text-[var(--lumin-color-text-secondary)]">
          {{ t('shell.settings.themeHint') }}
        </p>
        <NText v-if="themeError" type="error" class="text-xs">
          {{ t('shell.settings.themeSaveFailed') }}：{{ themeError }}
        </NText>
      </div>
    </section>
  </div>
</template>
