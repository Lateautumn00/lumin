<script setup lang="ts">
import { ref } from 'vue'
import { FileUp } from '@lucide/vue'
import type { LuminBridge } from '@lumin/plugin-api'
import { matchesAccept } from './accept'

/** 壳注入的唯一通道（类型来自 plugin-api；本包不依赖其运行时） */
const bridge: LuminBridge = window.lumin

const props = withDefaults(
  defineProps<{
    /** 文件选择器 accept（如 `.doc,.docx`），同时用于拖拽校验 */
    accept?: string
    hint?: string
    disabled?: boolean
    /** 多选（如合并模式）；select 逐文件循环 emit，消费方自行收集 */
    multiple?: boolean
  }>(),
  { accept: '', hint: '拖拽文件到此处，或点击选择', disabled: false, multiple: false }
)

const emit = defineEmits<{
  /** 校验通过并解析出磁盘绝对路径（multiple 下逐文件循环 emit） */
  select: [payload: { file: File; path: string }]
  /** 类型不符或无法解析路径 */
  invalid: [reason: string]
}>()

const dragging = ref(false)
const input = ref<HTMLInputElement | null>(null)

function openPicker(): void {
  if (!props.disabled) input.value?.click()
}

function onKeydown(event: KeyboardEvent): void {
  if (event.key === 'Enter' || event.key === ' ') {
    event.preventDefault()
    openPicker()
  }
}

function acceptFile(file: File): void {
  if (!matchesAccept(file.name, props.accept)) {
    emit('invalid', `不支持的文件类型：${file.name}`)
    return
  }
  const path = bridge.getPathForFile(file)
  if (path === '') {
    emit('invalid', '无法获取文件路径，请重新选择')
    return
  }
  emit('select', { file, path })
}

function onDrop(event: DragEvent): void {
  dragging.value = false
  if (props.disabled) return
  const dropped = Array.from(event.dataTransfer?.files ?? [])
  const files = props.multiple ? dropped : dropped.slice(0, 1)
  for (const file of files) acceptFile(file)
}

function onChange(event: Event): void {
  const target = event.target as HTMLInputElement
  // 先快照再清空：value='' 会同步清空 files 列表
  const selected = Array.from(target.files ?? [])
  target.value = ''
  const files = props.multiple ? selected : selected.slice(0, 1)
  for (const file of files) acceptFile(file)
}
</script>

<template>
  <div
    class="group relative flex cursor-pointer flex-col items-center justify-center gap-3 rounded-[var(--lumin-radius-lg)] border-2 border-dashed px-6 py-10 text-center transition-all duration-200 sm:px-8 sm:py-12"
    :class="
      disabled
        ? 'cursor-not-allowed border-[var(--lumin-color-border)] opacity-60'
        : dragging
          ? 'border-[var(--lumin-color-primary)] bg-[var(--lumin-color-primary-soft)] shadow-[var(--lumin-shadow-md)]'
          : 'border-[var(--lumin-color-border)] hover:border-[var(--lumin-color-primary)] hover:bg-[var(--lumin-color-surface-hover)] hover:shadow-[var(--lumin-shadow-sm)]'
    "
    role="button"
    tabindex="0"
    :aria-disabled="disabled"
    :aria-label="hint"
    @click="openPicker"
    @keydown="onKeydown"
    @dragover.prevent="!disabled && (dragging = true)"
    @dragleave.self="dragging = false"
    @drop.prevent="onDrop"
  >
    <span
      class="flex h-12 w-12 items-center justify-center rounded-full bg-[var(--lumin-color-surface-muted)] text-[var(--lumin-color-text-secondary)] transition-colors"
      :class="
        disabled
          ? ''
          : dragging
            ? 'bg-[var(--lumin-color-surface)] text-[var(--lumin-color-primary)]'
            : 'group-hover:text-[var(--lumin-color-primary)]'
      "
      aria-hidden="true"
    >
      <FileUp :size="24" />
    </span>
    <p class="text-sm font-medium text-[var(--lumin-color-text)]">{{ hint }}</p>
    <p v-if="accept !== ''" class="text-xs text-[var(--lumin-color-text-secondary)]">
      支持 {{ accept }}
    </p>
    <input
      ref="input"
      type="file"
      class="hidden"
      :accept="accept"
      :multiple="multiple"
      :disabled="disabled"
      @change="onChange"
    />
  </div>
</template>
