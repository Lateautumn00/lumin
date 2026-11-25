<script setup lang="ts">
import { NButton, NText } from 'naive-ui'
import { FolderOpen, RotateCcw } from '@lucide/vue'
import PathLink from '@lumin/ui/PathLink.vue'

defineProps<{
  title: string
  paths: string[]
  resetLabel: string
}>()

const emit = defineEmits<{ open: []; reset: [] }>()
</script>

<template>
  <div class="rounded-[var(--lumin-radius-md)] border border-[var(--lumin-color-border)] px-4 py-3">
    <NText type="success" class="text-sm font-medium">{{ title }}</NText>
    <ul class="mt-1 max-h-40 overflow-auto">
      <li
        v-for="path in paths"
        :key="path"
        class="text-xs break-all text-[var(--lumin-color-text-secondary)]"
      >
        <PathLink :path="path" />
      </li>
    </ul>
    <div class="mt-3 flex gap-2">
      <NButton size="small" type="primary" @click="emit('open')">
        <template #icon><FolderOpen :size="14" /></template>
        打开文件夹
      </NButton>
      <NButton size="small" @click="emit('reset')">
        <template #icon><RotateCcw :size="14" /></template>
        {{ resetLabel }}
      </NButton>
    </div>
  </div>
</template>
