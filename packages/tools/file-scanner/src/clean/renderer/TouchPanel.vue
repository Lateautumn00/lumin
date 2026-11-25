<!-- 页签三：批量改文件时间（D5，仅修改/访问时间） -->
<script setup lang="ts">
// 作者：cuilanchao · 修改时间：2026-11-21
import { computed, ref } from 'vue'
import { NButton, NCheckbox, NDatePicker, NInput, NPopconfirm, NText } from 'naive-ui'
import { Clock, FolderOpen } from '@lucide/vue'
import { formatDateTime, parseExtensions } from '../tree'
import type { TouchResult } from '../schema'
import { touch } from './client'
import { useTask } from './use-task'
import TaskFeedback from './TaskFeedback.vue'
import PathLink from '@lumin/ui/PathLink.vue'

const props = defineProps<{ root: string }>()
const emit = defineEmits<{ 'update:root': [string] }>()

const recursive = ref(true)
const extensionsText = ref('')
const timeMs = ref(Date.now())
const result = ref<TouchResult | null>(null)

const { running, progress, error, errorDetail, notice, submit, cancel, fail } =
  useTask<TouchResult>((done) => {
    result.value = done
  })

const targetText = computed(() => formatDateTime(timeMs.value))
const canStart = computed(() => props.root !== '' && !running.value)

async function chooseDir(): Promise<void> {
  try {
    const picked = await window.lumin.pickDirectory('选择要修改文件时间的目录')
    if (picked === null) return
    emit('update:root', picked)
    result.value = null
  } catch (err) {
    fail(err)
  }
}

function run(dryRun: boolean): void {
  if (!canStart.value) return
  result.value = null
  void submit(() =>
    touch({
      root: props.root,
      recursive: recursive.value,
      extensions: parseExtensions(extensionsText.value),
      mtimeMs: timeMs.value,
      dryRun
    })
  )
}
</script>

<template>
  <div class="flex flex-col gap-3">
    <p class="text-sm text-[var(--lumin-color-text-secondary)]">
      批量把文件的时间统一设置为指定值。先预演确认命中范围，再应用。
    </p>

    <NText depth="3" class="text-xs">
      说明：Windows 的「创建时间」Node 无原生
      API，本工具只设置「修改时间」与「访问时间」，不修改创建时间。
    </NText>

    <div class="flex items-center gap-2">
      <NInput :value="root" placeholder="选择要处理的目录" readonly />
      <NButton :disabled="running" @click="chooseDir">
        <FolderOpen class="mr-1 h-3.5 w-3.5" />选择目录
      </NButton>
    </div>

    <div class="flex flex-wrap items-center gap-4">
      <NCheckbox :checked="recursive" :disabled="running" @update:checked="recursive = $event">
        包含子目录
      </NCheckbox>
      <div class="flex items-center gap-2">
        <NText depth="2" class="text-sm">扩展名过滤</NText>
        <NInput
          :value="extensionsText"
          placeholder="留空 = 全部文件，如 txt,md"
          :disabled="running"
          class="w-56"
          @update:value="(value) => (extensionsText = value)"
        />
      </div>
      <div class="flex items-center gap-2">
        <NText depth="2" class="text-sm">修改时间</NText>
        <NDatePicker
          type="datetime"
          :value="timeMs"
          :disabled="running"
          class="w-56"
          @update:value="(value) => (timeMs = typeof value === 'number' ? value : Date.now())"
        />
      </div>
    </div>

    <div class="flex flex-wrap items-center gap-2">
      <NButton :disabled="!canStart" @click="run(true)">
        <Clock class="mr-1 h-3.5 w-3.5" />预演
      </NButton>
      <NPopconfirm @positive-click="run(false)">
        <template #trigger>
          <NButton type="primary" :disabled="!canStart">应用</NButton>
        </template>
        确认把命中文件的修改时间设为 {{ targetText }}？
      </NPopconfirm>
    </div>

    <TaskFeedback
      :running="running"
      :progress="progress"
      :error="error"
      :error-detail="errorDetail"
      :notice="notice"
      @cancel="cancel"
      @retry="run(false)"
    />

    <div v-if="result !== null" class="flex flex-col gap-2 text-sm">
      <NText depth="2">
        命中 {{ result.total }} 个文件 · 已更新 {{ result.updated }} 个 · 失败
        {{ result.failures.length }} 个
      </NText>
      <NText v-if="result.total === 0" depth="3" class="text-xs">没有符合条件的文件</NText>
      <div v-if="result.sample.length > 0 && result.updated === 0" class="flex flex-col gap-1">
        <NText depth="3" class="text-xs">命中样例（前 20 条）</NText>
        <div v-for="path in result.sample" :key="path" class="text-xs">
          <PathLink :path="path" :reveal="false" />
        </div>
      </div>
      <div v-if="result.failures.length > 0" class="flex flex-col gap-1">
        <NText depth="3" class="text-xs">失败明细</NText>
        <div v-for="failure in result.failures.slice(0, 20)" :key="failure.path" class="text-xs">
          <PathLink :path="failure.path" :reveal="false" />（{{ failure.message }}）
        </div>
      </div>
    </div>
  </div>
</template>
