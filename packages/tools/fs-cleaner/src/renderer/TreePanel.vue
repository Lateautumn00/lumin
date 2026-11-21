<!-- 页签一：目录树导出（D3） -->
<script setup lang="ts">
// 作者：cuilanchao · 修改时间：2026-11-21
import { computed, ref } from 'vue'
import { NButton, NInput, NInputNumber, NText } from 'naive-ui'
import { Copy, FolderOpen, Search } from '@lucide/vue'
import { parsePatterns } from '../tree'
import type { TreeResult } from '../schema'
import { tree } from './client'
import { useTask } from './use-task'
import TaskFeedback from './TaskFeedback.vue'

const props = defineProps<{ root: string; depth: number; excludeText: string }>()

const emit = defineEmits<{
  'update:root': [string]
  'update:depth': [number]
  'update:excludeText': [string]
}>()

const output = ref<TreeResult | null>(null)
const copyNotice = ref('')

const { running, progress, error, errorDetail, notice, submit, cancel, fail } =
  useTask<TreeResult>((result) => {
    output.value = result
  })

const summary = computed(() => {
  const done = output.value
  if (done === null) return ''
  const seconds = (done.elapsedMs / 1000).toFixed(1)
  const truncated = done.truncated ? ' · 已截断' : ''
  return `${done.dirs} 个目录 · ${done.files} 个文件 · 耗时 ${seconds}s${truncated}`
})

async function chooseDir(): Promise<void> {
  try {
    const picked = await window.lumin.pickDirectory('选择要导出的目录')
    if (picked === null) return
    emit('update:root', picked)
    output.value = null
    copyNotice.value = ''
  } catch (err) {
    fail(err)
  }
}

function start(): void {
  if (props.root === '' || running.value) return
  output.value = null
  copyNotice.value = ''
  void submit(() =>
    tree({ root: props.root, maxDepth: props.depth, exclude: parsePatterns(props.excludeText) })
  )
}

async function copyText(): Promise<void> {
  const text = output.value?.text ?? ''
  if (text === '') return
  try {
    await navigator.clipboard.writeText(text)
    copyNotice.value = '已复制到剪贴板'
  } catch {
    copyNotice.value = '复制失败，请手动选择文本复制'
  }
}
</script>

<template>
  <div class="flex flex-col gap-3">
    <p class="text-sm text-[var(--lumin-color-text-secondary)]">
      递归生成目录树文本，可限制展开层数并按名称/通配符排除（如 node_modules、*.log）。
    </p>

    <div class="flex items-center gap-2">
      <NInput :value="root" placeholder="选择要导出的目录" readonly />
      <NButton :disabled="running" @click="chooseDir">
        <FolderOpen class="mr-1 h-3.5 w-3.5" />选择目录
      </NButton>
    </div>

    <div class="flex flex-wrap items-center gap-4">
      <div class="flex items-center gap-2">
        <NText depth="2" class="text-sm">最大深度</NText>
        <NInputNumber
          :value="depth"
          :min="1"
          :max="10"
          :disabled="running"
          class="w-24"
          @update:value="(value) => emit('update:depth', value ?? 1)"
        />
      </div>
      <div class="flex min-w-64 flex-1 flex-col gap-1">
        <NText depth="2" class="text-sm">排除规则（一行一条，支持 * 通配）</NText>
        <NInput
          :value="excludeText"
          type="textarea"
          placeholder="node_modules&#10;*.log"
          :autosize="{ minRows: 2, maxRows: 4 }"
          :disabled="running"
          @update:value="(value) => emit('update:excludeText', value)"
        />
      </div>
    </div>

    <div class="flex flex-wrap items-center gap-2">
      <NButton type="primary" :disabled="running || root === ''" @click="start">
        <Search class="mr-1 h-3.5 w-3.5" />生成目录树
      </NButton>
      <NButton :disabled="output === null || running" @click="copyText">
        <Copy class="mr-1 h-3.5 w-3.5" />复制
      </NButton>
      <NText v-if="copyNotice" depth="3" class="text-xs">{{ copyNotice }}</NText>
    </div>

    <TaskFeedback
      :running="running"
      :progress="progress"
      :error="error"
      :error-detail="errorDetail"
      :notice="notice"
      @cancel="cancel"
      @retry="start"
    />

    <div v-if="output === null && !running && error === null" class="text-sm text-[var(--lumin-color-text-secondary)]">
      选择目录后点击「生成目录树」，结果可一键复制。
    </div>

    <div v-if="output !== null" class="flex flex-col gap-2">
      <NText depth="3" class="text-xs">{{ summary }}</NText>
      <pre
        class="max-h-96 overflow-auto rounded-[var(--lumin-radius-md)] bg-[var(--lumin-color-surface)] p-3 text-xs leading-relaxed"
        >{{ output.text }}</pre
      >
    </div>
  </div>
</template>
