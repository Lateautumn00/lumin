<script setup lang="ts">
/**
 * @file 选中日详情面板（公历/农历/节假日/黄历/当日纪念日）
 * @author cuilanchao
 * @date 2026-11-23
 */
import { computed } from 'vue'
import { NTag } from 'naive-ui'

import type { DayInfo, HuangJi } from '../lunar'
import type { HolidayInfo } from '../holidays'
import type { Anniversary } from '../anniversaries'

export interface DayAnniversary {
  anniversary: Anniversary
  countdown: string
}

const props = defineProps<{
  info: DayInfo
  huangJi: HuangJi
  holiday: HolidayInfo | null
  anniversaries: DayAnniversary[]
}>()

const basics = computed<{ label: string; value: string }[]>(() => [
  { label: '公历', value: props.info.solar },
  // 闰月前缀已含在 lunarText（如 闰四月初一），无需再补（闰）
  { label: '农历', value: props.info.lunarText },
  { label: '星期', value: props.info.week },
  { label: '干支', value: `${props.info.ganzhi}日` },
  { label: '生肖', value: props.info.shengXiao },
  { label: '星座', value: props.info.xingZuo }
])

const meta = computed<string>(() => {
  const parts: string[] = [
    `${props.huangJi.zhiXing}位`,
    `${props.huangJi.tianShen}·${props.huangJi.tianShenLuck}`
  ]
  parts.push(`冲${props.huangJi.chong} 煞${props.huangJi.sha}`)
  return parts.join('　')
})
</script>

<template>
  <section
    class="flex flex-col gap-3 rounded-[var(--lumin-radius-md)] border border-[var(--lumin-color-border)] bg-[var(--lumin-color-surface)] p-3"
    aria-label="当日详情"
  >
    <header class="flex flex-wrap items-center gap-2">
      <h2 class="text-sm font-semibold">{{ info.solar }}</h2>
      <span class="text-sm text-[var(--lumin-color-text-secondary)]">{{ info.week }}</span>
      <NTag v-if="info.jieqi" size="small" type="primary" :bordered="false">
        {{ info.jieqi }}
      </NTag>
      <NTag v-if="holiday" size="small" :type="holiday.off ? 'error' : 'warning'" :bordered="false">
        {{ holiday.off ? holiday.name : `${holiday.name}·调休上班` }}
      </NTag>
    </header>

    <dl class="grid grid-cols-2 gap-x-3 gap-y-1.5 text-sm">
      <div v-for="row in basics" :key="row.label" class="flex items-baseline gap-1.5">
        <dt class="shrink-0 text-xs text-[var(--lumin-color-text-secondary)]">{{ row.label }}</dt>
        <dd class="min-w-0 truncate">{{ row.value }}</dd>
      </div>
      <div v-if="info.festivals.length > 0" class="col-span-2 flex items-baseline gap-1.5">
        <dt class="shrink-0 text-xs text-[var(--lumin-color-text-secondary)]">节日</dt>
        <dd class="min-w-0 truncate text-[var(--lumin-color-danger)]">
          {{ info.festivals.join('、') }}
        </dd>
      </div>
    </dl>

    <div class="flex flex-col gap-2 border-t border-[var(--lumin-color-border)] pt-2">
      <h3 class="text-sm font-semibold">黄历</h3>
      <div class="flex flex-col gap-1.5">
        <div class="flex items-start gap-2">
          <span
            class="w-5 shrink-0 rounded-[var(--lumin-radius-xs)] bg-[var(--lumin-color-success)] text-center text-xs font-semibold text-[var(--lumin-color-brand-contrast)]"
          >
            宜
          </span>
          <div class="flex min-w-0 flex-wrap gap-1">
            <NTag
              v-for="item in huangJi.yi"
              :key="item"
              size="small"
              type="success"
              :bordered="false"
            >
              {{ item }}
            </NTag>
          </div>
        </div>
        <div class="flex items-start gap-2">
          <span
            class="w-5 shrink-0 rounded-[var(--lumin-radius-xs)] bg-[var(--lumin-color-danger)] text-center text-xs font-semibold text-[var(--lumin-color-brand-contrast)]"
          >
            忌
          </span>
          <div class="flex min-w-0 flex-wrap gap-1">
            <NTag
              v-for="item in huangJi.ji"
              :key="item"
              size="small"
              type="error"
              :bordered="false"
            >
              {{ item }}
            </NTag>
          </div>
        </div>
      </div>
      <p class="text-xs text-[var(--lumin-color-text-secondary)]">{{ meta }}</p>
      <p class="text-xs text-[var(--lumin-color-text-secondary)]">
        吉神：{{ huangJi.jiShen.join('、') }}
      </p>
      <p class="text-xs text-[var(--lumin-color-text-secondary)]">
        凶煞：{{ huangJi.xiongSha.join('、') }}
      </p>
    </div>

    <div class="flex flex-col gap-1.5 border-t border-[var(--lumin-color-border)] pt-2">
      <h3 class="text-sm font-semibold">当日纪念日</h3>
      <p v-if="anniversaries.length === 0" class="text-sm text-[var(--lumin-color-text-secondary)]">
        这一天没有纪念日，可在「纪念日管理」中添加。
      </p>
      <div
        v-for="item in anniversaries"
        :key="item.anniversary.id"
        class="flex items-center justify-between gap-2 text-sm"
      >
        <span class="min-w-0 truncate">{{ item.anniversary.name }}</span>
        <span class="shrink-0 text-xs text-[var(--lumin-color-primary)]">
          {{ item.countdown }}
        </span>
      </div>
    </div>
  </section>
</template>
