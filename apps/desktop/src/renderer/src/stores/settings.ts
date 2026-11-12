import { defineStore } from 'pinia'
import { ref } from 'vue'

export const useSettingsStore = defineStore('settings', () => {
  const taskConcurrency = ref<number | null>(2)

  async function load(): Promise<void> {
    taskConcurrency.value = await window.lumin.settings.get<number | null>(
      'shell.taskConcurrency',
      2
    )
  }

  async function save(): Promise<void> {
    const raw = taskConcurrency.value
    const value =
      typeof raw === 'number' && Number.isFinite(raw)
        ? Math.min(8, Math.max(1, Math.floor(raw)))
        : 2
    taskConcurrency.value = value
    await window.lumin.settings.set('shell.taskConcurrency', value)
  }

  return { taskConcurrency, load, save }
})
