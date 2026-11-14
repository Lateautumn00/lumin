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
  }>(),
  { accept: '', hint: '拖拽文件到此处，或点击选择', disabled: false }
)

const emit = defineEmits<{
  /** 校验通过并解析出磁盘绝对路径 */
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
  const file = event.dataTransfer?.files[0]
  if (file !== undefined) acceptFile(file)
}

function onChange(event: Event): void {
  const target = event.target as HTMLInputElement
  const file = target.files?.[0]
  target.value = ''
  if (file !== undefined) acceptFile(file)
}
</script>

<template>
  <div
    class="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-[var(--lumin-radius-lg)] border-2 border-dashed px-6 py-8 text-center transition-colors"
    :class="
      disabled
        ? 'cursor-not-allowed border-[var(--lumin-color-border)] opacity-60'
        : dragging
          ? 'border-[var(--lumin-color-primary)]'
          : 'border-[var(--lumin-color-border)] hover:border-[var(--lumin-color-primary)]'
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
    <FileUp
      :size="28"
      class="text-[var(--lumin-color-text-secondary)]"
      :class="dragging ? 'text-[var(--lumin-color-primary)]' : ''"
      aria-hidden="true"
    />
    <p class="text-sm text-[var(--lumin-color-text-secondary)]">{{ hint }}</p>
    <p v-if="accept !== ''" class="text-xs text-[var(--lumin-color-text-secondary)]">
      支持 {{ accept }}
    </p>
    <input
      ref="input"
      type="file"
      class="hidden"
      :accept="accept"
      :disabled="disabled"
      @change="onChange"
    />
  </div>
</template>
