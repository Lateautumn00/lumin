<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { NButton, NText } from 'naive-ui'
import type { StructuredError } from '@lumin/shared'

const props = withDefaults(
  defineProps<{
    error: StructuredError
    /** 可重试码（spec §5）→ 显示 [重试] */
    retryable?: boolean
  }>(),
  { retryable: false }
)

const emit = defineEmits<{ retry: [] }>()

const detailOpen = ref(false)
const hasDetail = computed(() => (props.error.detail ?? '') !== '')

watch(
  () => props.error,
  () => {
    detailOpen.value = false
  }
)
</script>

<template>
  <div
    class="rounded-[var(--lumin-radius-md)] border border-[var(--lumin-color-danger)] px-4 py-3"
    role="alert"
  >
    <NText type="error" class="text-sm font-medium">{{ error.message }}</NText>
    <p class="mt-1 text-xs text-[var(--lumin-color-text-secondary)]">错误码：{{ error.code }}</p>
    <div v-if="hasDetail" class="mt-2">
      <NButton size="small" quaternary @click="detailOpen = !detailOpen">
        {{ detailOpen ? '收起详情' : '查看详情' }}
      </NButton>
      <p
        v-if="detailOpen"
        class="mt-1 max-h-40 overflow-auto font-mono text-xs break-all whitespace-pre-wrap text-[var(--lumin-color-text-secondary)]"
      >
        {{ error.detail }}
      </p>
    </div>
    <div class="mt-3 flex flex-wrap gap-2">
      <NButton v-if="retryable" size="small" type="primary" @click="emit('retry')">重试</NButton>
      <slot name="actions" />
    </div>
  </div>
</template>
