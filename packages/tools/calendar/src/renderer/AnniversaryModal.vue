<script setup lang="ts">
/**
 * @file 纪念日管理弹窗（列表 + 新增表单；空态引导 + 主操作）
 * @author cuilanchao
 * @date 2026-11-23
 */
import { ref, watch } from 'vue'
import {
  NButton,
  NEmpty,
  NInput,
  NInputNumber,
  NModal,
  NRadio,
  NRadioGroup,
  NSwitch,
  NTag
} from 'naive-ui'
import { Plus, Trash2 } from '@lucide/vue'

import type { Anniversary } from '../anniversaries'

const props = defineProps<{
  show: boolean
  list: Anniversary[]
  /** 倒数文案格式化（由宿主注入，弹窗不直接依赖农历库） */
  countdown: (item: Anniversary) => string
}>()

const emit = defineEmits<{
  'update:show': [value: boolean]
  confirm: [list: Anniversary[]]
}>()

const draft = ref<Anniversary[]>([])
const name = ref('')
const type = ref<Anniversary['type']>('solar')
const month = ref<number | null>(new Date().getMonth() + 1)
const day = ref<number | null>(new Date().getDate())
const leap = ref(false)
const startYear = ref<number | null>(null)
const formError = ref('')
const formRef = ref<HTMLElement | null>(null)

function focusForm(): void {
  formRef.value?.scrollIntoView({ block: 'nearest' })
}

watch(
  () => props.show,
  (show) => {
    if (!show) return
    draft.value = [...props.list]
    name.value = ''
    type.value = 'solar'
    month.value = new Date().getMonth() + 1
    day.value = new Date().getDate()
    leap.value = false
    startYear.value = null
    formError.value = ''
  }
)

function close(): void {
  emit('update:show', false)
}

function confirm(): void {
  emit('confirm', [...draft.value])
  close()
}

const SOLAR_SHORT_MONTHS = [4, 6, 9, 11]

/** 表单校验：拒绝 2/30、4/31、农历十三月/三十以上等非法日期 */
function validate(): string {
  const trimmed = name.value.trim()
  if (trimmed === '') return '请输入纪念日名称'
  const m = month.value
  const d = day.value
  if (m === null || m < 1 || m > 12) return '月份需在 1-12 之间'
  if (d === null || d < 1) return '日期需在 1-31 之间'
  if (type.value === 'solar') {
    if (m === 2 && d > 29) return '公历 2 月没有 30/31 日'
    if (SOLAR_SHORT_MONTHS.includes(m) && d > 30) return '该月没有 31 日'
    if (d > 31) return '日期需在 1-31 之间'
  } else if (d > 30) {
    return '农历每月最多 30 天'
  }
  return ''
}

function add(): void {
  const message = validate()
  formError.value = message
  if (message !== '') return
  const item: Anniversary = {
    id: crypto.randomUUID(),
    name: name.value.trim(),
    type: type.value,
    month: month.value ?? 1,
    day: day.value ?? 1,
    leap: type.value === 'lunar' && leap.value
  }
  if (startYear.value !== null && startYear.value >= 1900 && startYear.value <= 2100) {
    item.startYear = startYear.value
  }
  draft.value = [...draft.value, item]
  name.value = ''
  formError.value = ''
}

function remove(id: string): void {
  draft.value = draft.value.filter((item) => item.id !== id)
}
</script>

<template>
  <NModal
    :show="props.show"
    preset="card"
    title="纪念日管理"
    class="max-w-lg"
    @update:show="(value: boolean) => emit('update:show', value)"
  >
    <div class="flex flex-col gap-3">
      <!-- 空态：引导 + 主操作（表单即主操作） -->
      <div
        v-if="draft.length === 0"
        class="rounded-[var(--lumin-radius-md)] border border-dashed border-[var(--lumin-color-border-strong)] p-3"
      >
        <NEmpty description="还没有纪念日，添加一个开始记录重要日子">
          <template #extra>
            <NButton size="small" type="primary" @click="focusForm">
              <Plus class="mr-1 h-3.5 w-3.5" />在下方添加
            </NButton>
          </template>
        </NEmpty>
      </div>

      <ul v-else class="flex max-h-64 flex-col gap-1.5 overflow-y-auto" aria-label="纪念日列表">
        <li
          v-for="item in draft"
          :key="item.id"
          class="flex items-center gap-2 rounded-[var(--lumin-radius-sm)] border border-[var(--lumin-color-border)] px-2.5 py-1.5"
        >
          <NTag size="tiny" :bordered="false">{{ item.type === 'solar' ? '公历' : '农历' }}</NTag>
          <span class="min-w-0 flex-1 truncate text-sm" :title="item.name">{{ item.name }}</span>
          <span class="shrink-0 text-xs text-[var(--lumin-color-text-secondary)]">
            {{ item.month }}/{{ item.day }}
            <template v-if="item.type === 'lunar' && item.leap">（闰）</template>
          </span>
          <span class="w-24 shrink-0 text-right text-xs text-[var(--lumin-color-primary)]">
            {{ countdown(item) }}
          </span>
          <NButton
            size="tiny"
            quaternary
            :aria-label="`删除 ${item.name}`"
            @click="remove(item.id)"
          >
            <Trash2 class="h-3.5 w-3.5" />
          </NButton>
        </li>
      </ul>

      <div
        ref="formRef"
        class="flex flex-col gap-2 border-t border-[var(--lumin-color-border)] pt-3"
      >
        <div class="flex items-center gap-3">
          <NInput
            v-model:value="name"
            placeholder="名称，如：结婚纪念日"
            aria-label="纪念日名称"
            class="flex-1"
            @keydown.enter="add"
          />
        </div>
        <div class="flex flex-wrap items-end gap-3">
          <div class="flex flex-col gap-1">
            <span class="text-xs text-[var(--lumin-color-text-secondary)]">历法</span>
            <NRadioGroup v-model:value="type" size="small" aria-label="历法类型">
              <NRadio value="solar">公历</NRadio>
              <NRadio value="lunar">农历</NRadio>
            </NRadioGroup>
          </div>
          <div class="flex flex-col gap-1">
            <span class="text-xs text-[var(--lumin-color-text-secondary)]">月</span>
            <NInputNumber
              v-model:value="month"
              :min="1"
              :max="12"
              aria-label="月份"
              size="small"
              class="w-20"
            />
          </div>
          <div class="flex flex-col gap-1">
            <span class="text-xs text-[var(--lumin-color-text-secondary)]">日</span>
            <NInputNumber
              v-model:value="day"
              :min="1"
              :max="31"
              aria-label="日期"
              size="small"
              class="w-20"
            />
          </div>
          <div class="flex flex-col gap-1">
            <span class="text-xs text-[var(--lumin-color-text-secondary)]">起始年（可选）</span>
            <NInputNumber
              v-model:value="startYear"
              :min="1900"
              :max="2100"
              placeholder="用于周年"
              aria-label="起始年份"
              size="small"
              class="w-28"
            />
          </div>
          <div
            v-if="type === 'lunar'"
            class="flex items-center gap-1.5 pb-1"
            title="该年无此闰月时按普通月计算"
          >
            <NSwitch v-model:value="leap" size="small" aria-label="闰月" />
            <span class="text-xs text-[var(--lumin-color-text-secondary)]">闰月</span>
          </div>
        </div>
        <p v-if="formError !== ''" role="alert" class="text-sm text-[var(--lumin-color-error)]">
          {{ formError }}
        </p>
        <div class="flex justify-end gap-2">
          <NButton size="small" @click="close">取消</NButton>
          <NButton size="small" type="primary" @click="add">
            <Plus class="mr-1 h-3.5 w-3.5" />添加
          </NButton>
          <NButton size="small" type="primary" ghost @click="confirm">完成</NButton>
        </div>
      </div>
    </div>
  </NModal>
</template>
