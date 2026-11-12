<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { NButton, NInputNumber, NText } from 'naive-ui'
import { useSettingsStore } from '../stores/settings'
import { t } from '../i18n/zh-CN'

const store = useSettingsStore()
const saving = ref(false)
const status = ref('')

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
</script>

<template>
  <div class="flex max-w-md flex-col gap-4">
    <h1 class="text-base font-semibold">{{ t('shell.settings.title') }}</h1>
    <div class="flex items-center gap-3">
      <span class="text-sm">{{ t('shell.settings.concurrency') }}</span>
      <NInputNumber v-model:value="store.taskConcurrency" :min="1" :max="8" class="w-32" />
      <NButton type="primary" :loading="saving" @click="save">{{
        t('shell.settings.save')
      }}</NButton>
      <NText v-if="status" depth="3" class="text-xs">{{ status }}</NText>
    </div>
  </div>
</template>
