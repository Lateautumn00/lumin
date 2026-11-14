<script setup lang="ts">
import { computed } from 'vue'
import { NButton, NProgress, NSpin } from 'naive-ui'

const props = withDefaults(
  defineProps<{
    /** 阶段/字节说明（如「正在转换…」「12.4 MB / 358.8 MB」） */
    message?: string
    current?: number
    total?: number
    /** 显式百分比（0-100）；优先于 current/total 推导 */
    percent?: number
    cancellable?: boolean
    cancelText?: string
  }>(),
  {
    message: '',
    current: undefined,
    total: undefined,
    percent: undefined,
    cancellable: true,
    cancelText: '取消'
  }
)

const emit = defineEmits<{ cancel: [] }>()

/** 可推导出百分比时返回 0-100，否则 null（不确定进度） */
const percentValue = computed<number | null>(() => {
  if (props.percent !== undefined) return Math.min(100, Math.max(0, props.percent))
  if (props.total !== undefined && props.total > 0 && props.current !== undefined) {
    return Math.min(100, Math.max(0, Math.round((props.current / props.total) * 100)))
  }
  return null
})
</script>

<template>
  <div class="flex items-center gap-3">
    <NSpin v-if="percentValue === null" size="small" />
    <div v-else class="min-w-32 flex-1">
      <NProgress
        type="line"
        :percentage="percentValue"
        :height="6"
        :show-indicator="false"
        :processing="percentValue < 100"
      />
    </div>
    <span class="text-sm text-[var(--lumin-color-text-secondary)]">
      {{ message }}<template v-if="percentValue !== null"> · {{ percentValue }}%</template>
    </span>
    <NButton v-if="cancellable" size="small" type="error" ghost @click="emit('cancel')">
      {{ cancelText }}
    </NButton>
  </div>
</template>
