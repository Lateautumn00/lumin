<script setup lang="ts">
/**
 * @file LifeTab.vue 生活计算页签（M79 由独立工具 life-calculator 并入计算器）
 * @author cuilanchao
 * @date 2026-11-25
 * @description 房贷（等额本息/等额本金）/ 工资个税 / 百分比与折扣；
 *              三态：空态（默认参数实时出结果）/ 加载态（全同步纯函数，豁免）/
 *              报错态（结构化错误码 + 中文文案，各子页签独立展示）。
 */
import { computed, onUnmounted, ref } from 'vue'
import { Check, Copy } from '@lucide/vue'
import { NButton, NInputNumber, NRadioButton, NRadioGroup, NTabPane, NTabs, NText } from 'naive-ui'
import type { StructuredError } from '@lumin/shared'

import {
  MORTGAGE_RATE_MAX,
  MORTGAGE_YEARS_MAX,
  MORTGAGE_YEARS_MIN,
  calcMortgage,
  type LoanMethod
} from '../life/mortgage'
import { TAX_MONTHLY_THRESHOLD, calcSalaryTax } from '../life/tax'
import { applyPercentChange, discountPrice, originalPrice, percentChange } from '../life/percent'
import { toolError } from '../life/errors'

const activeTab = ref('mortgage')
const copiedLabel = ref('')
const clipboardError = ref<StructuredError | null>(null)

let copiedTimer: ReturnType<typeof setTimeout> | undefined

const moneyFormatter = new Intl.NumberFormat('zh-CN', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2
})

function money(value: number): string {
  return moneyFormatter.format(value)
}

function percentText(value: number): string {
  return `${value.toFixed(2)}%`
}

/* ---------- Tab1 房贷 ---------- */

const loanMethodOptions: ReadonlyArray<{ value: LoanMethod; label: string }> = [
  { value: 'equal-payment', label: '等额本息' },
  { value: 'equal-principal', label: '等额本金' }
]

const mortgageMethod = ref<LoanMethod>('equal-payment')
const mortgagePrincipal = ref<number | null>(1000000)
const mortgageRate = ref<number | null>(4.9)
const mortgageYears = ref<number | null>(30)

const mortgageOutcome = computed(() =>
  calcMortgage({
    principal: mortgagePrincipal.value ?? Number.NaN,
    annualRate: mortgageRate.value ?? Number.NaN,
    years: mortgageYears.value ?? Number.NaN,
    method: mortgageMethod.value
  })
)

const mortgageResult = computed(() =>
  mortgageOutcome.value.ok ? mortgageOutcome.value.value : null
)
const mortgageError = computed(() =>
  mortgageOutcome.value.ok ? null : mortgageOutcome.value.message
)

const mortgageCards = computed(() => {
  const result = mortgageResult.value
  if (result === null) return []
  return [
    {
      metric: 'payment',
      label: result.method === 'equal-payment' ? '每月月供' : '首月还款',
      value: `${money(result.monthlyPayment)} 元`
    },
    { metric: 'interest', label: '支付利息', value: `${money(result.totalInterest)} 元` },
    { metric: 'total', label: '还款总额', value: `${money(result.totalPayment)} 元` },
    { metric: 'months', label: '还款期数', value: `${result.months} 期` }
  ]
})

const mortgagePreview = computed(() => mortgageResult.value?.schedule.slice(0, 12) ?? [])

const mortgageCopyText = computed(() => {
  const result = mortgageResult.value
  if (result === null) return ''
  const headline = result.method === 'equal-payment' ? '每月月供' : '首月还款'
  return `${headline} ${money(result.monthlyPayment)} 元；支付利息 ${money(result.totalInterest)} 元；还款总额 ${money(result.totalPayment)} 元；共 ${result.months} 期`
})

/* ---------- Tab2 个税 ---------- */

const taxGross = ref<number | null>(10000)
const taxInsurance = ref<number | null>(1000)
const taxSpecial = ref<number | null>(0)

const taxOutcome = computed(() =>
  calcSalaryTax({
    grossSalary: taxGross.value ?? Number.NaN,
    socialInsurance: taxInsurance.value ?? Number.NaN,
    specialDeduction: taxSpecial.value ?? Number.NaN
  })
)

const taxResult = computed(() => (taxOutcome.value.ok ? taxOutcome.value.value : null))
const taxError = computed(() => (taxOutcome.value.ok ? null : taxOutcome.value.message))

const taxCards = computed(() => {
  const result = taxResult.value
  if (result === null) return []
  return [
    { metric: 'taxable', label: '应纳税所得额', value: `${money(result.taxableIncome)} 元` },
    { metric: 'tax', label: '应缴个税', value: `${money(result.tax)} 元` },
    { metric: 'net', label: '税后收入', value: `${money(result.netSalary)} 元` },
    { metric: 'rate', label: '实际税负率', value: percentText(result.effectiveRate) }
  ]
})

const taxCopyText = computed(() => {
  const result = taxResult.value
  if (result === null) return ''
  return `应纳税所得额 ${money(result.taxableIncome)} 元；应缴个税 ${money(result.tax)} 元；税后收入 ${money(result.netSalary)} 元`
})

/* ---------- Tab3 百分比 ---------- */

const percentBase = ref<number | null>(100)
const percentDelta = ref<number | null>(20)

const applyOutcome = computed(() =>
  applyPercentChange(percentBase.value ?? Number.NaN, percentDelta.value ?? Number.NaN)
)
const applyValue = computed(() => (applyOutcome.value.ok ? applyOutcome.value.value : null))
const applyError = computed(() => (applyOutcome.value.ok ? null : applyOutcome.value.message))

const changeFrom = ref<number | null>(100)
const changeTo = ref<number | null>(120)

const changeOutcome = computed(() =>
  percentChange(changeFrom.value ?? Number.NaN, changeTo.value ?? Number.NaN)
)
const changeValue = computed(() => (changeOutcome.value.ok ? changeOutcome.value.value : null))
const changeError = computed(() => (changeOutcome.value.ok ? null : changeOutcome.value.message))

const discountOriginal = ref<number | null>(199)
const discountOff = ref<number | null>(20)

const discountOutcome = computed(() =>
  discountPrice(discountOriginal.value ?? Number.NaN, discountOff.value ?? Number.NaN)
)
const discountValue = computed(() =>
  discountOutcome.value.ok ? discountOutcome.value.value : null
)
const discountError = computed(() =>
  discountOutcome.value.ok ? null : discountOutcome.value.message
)

const reverseDiscounted = ref<number | null>(159.2)
const reverseOff = ref<number | null>(20)

const reverseOutcome = computed(() =>
  originalPrice(reverseDiscounted.value ?? Number.NaN, reverseOff.value ?? Number.NaN)
)
const reverseValue = computed(() => (reverseOutcome.value.ok ? reverseOutcome.value.value : null))
const reverseError = computed(() => (reverseOutcome.value.ok ? null : reverseOutcome.value.message))

/* ---------- 通用 ---------- */

async function copyText(text: string, label: string): Promise<void> {
  if (text === '') return
  clipboardError.value = null
  try {
    await navigator.clipboard.writeText(text)
    copiedLabel.value = label
    if (copiedTimer !== undefined) clearTimeout(copiedTimer)
    copiedTimer = setTimeout(() => {
      if (copiedLabel.value === label) copiedLabel.value = ''
    }, 1200)
  } catch {
    clipboardError.value = toolError('LC_CLIPBOARD_FAILED')
  }
}

function onMethodChange(value: string | number | boolean): void {
  const matched = loanMethodOptions.find((option) => option.value === value)
  if (matched !== undefined) mortgageMethod.value = matched.value
}

onUnmounted(() => {
  if (copiedTimer !== undefined) clearTimeout(copiedTimer)
})
</script>

<template>
  <div class="flex max-w-5xl flex-col gap-4">
    <!-- 页签仅作切换器，内容用 v-if 渲染；标签必须走 #tab 插槽（与 text-toolbox 同范式） -->
    <NTabs v-model:value="activeTab" type="line">
      <NTabPane name="mortgage">
        <template #tab>房贷</template>
      </NTabPane>
      <NTabPane name="tax">
        <template #tab>个税</template>
      </NTabPane>
      <NTabPane name="percent">
        <template #tab>百分比</template>
      </NTabPane>
    </NTabs>

    <div
      v-if="clipboardError !== null"
      role="alert"
      class="text-sm text-[var(--lumin-color-error)]"
    >
      {{ clipboardError.message }}（{{ clipboardError.code }}）
    </div>

    <!-- 房贷 -->
    <div v-if="activeTab === 'mortgage'" class="flex flex-col gap-4">
      <div class="flex flex-wrap items-end gap-4">
        <div class="flex flex-col gap-1">
          <NText depth="2" class="text-sm">还款方式</NText>
          <NRadioGroup :value="mortgageMethod" @update:value="onMethodChange">
            <NRadioButton
              v-for="option in loanMethodOptions"
              :key="option.value"
              :value="option.value"
              :label="option.label"
            />
          </NRadioGroup>
        </div>
        <div class="flex w-52 flex-col gap-1">
          <NText depth="2" class="text-sm">贷款本金（元）</NText>
          <NInputNumber
            v-model:value="mortgagePrincipal"
            :min="0"
            :step="10000"
            placeholder="贷款本金（元）"
            aria-label="贷款本金"
          />
        </div>
        <div class="flex w-44 flex-col gap-1">
          <NText depth="2" class="text-sm">年利率（%）</NText>
          <NInputNumber
            v-model:value="mortgageRate"
            :min="0"
            :max="MORTGAGE_RATE_MAX"
            :step="0.05"
            placeholder="年利率（%）"
            aria-label="年利率"
          />
        </div>
        <div class="flex w-44 flex-col gap-1">
          <NText depth="2" class="text-sm">贷款年限（年）</NText>
          <NInputNumber
            v-model:value="mortgageYears"
            :min="MORTGAGE_YEARS_MIN"
            :max="MORTGAGE_YEARS_MAX"
            :step="1"
            placeholder="贷款年限（年）"
            aria-label="贷款年限"
          />
        </div>
      </div>

      <div
        v-if="mortgageError !== null"
        role="alert"
        class="text-sm text-[var(--lumin-color-error)]"
      >
        {{ mortgageError }}（LC_MORTGAGE_INVALID）
      </div>

      <div v-if="mortgageResult !== null" class="flex flex-col gap-4">
        <div class="grid grid-cols-2 gap-3 md:grid-cols-4">
          <div
            v-for="card in mortgageCards"
            :key="card.metric"
            :data-mortgage-metric="card.metric"
            class="flex flex-col gap-1 rounded-[var(--lumin-radius-md)] bg-[var(--lumin-color-surface)] p-3"
          >
            <span class="text-xs text-[var(--lumin-color-text-secondary)]">{{ card.label }}</span>
            <span class="font-mono text-base font-semibold">{{ card.value }}</span>
          </div>
        </div>

        <div class="flex flex-wrap items-center justify-between gap-3">
          <span class="text-xs text-[var(--lumin-color-text-secondary)]">
            还款计划共 {{ mortgageResult.months }} 期，下表展示前 {{ mortgagePreview.length }} 期
          </span>
          <NButton size="small" @click="copyText(mortgageCopyText, 'mortgage')">
            <template #icon>
              <Check v-if="copiedLabel === 'mortgage'" :size="14" />
              <Copy v-else :size="14" />
            </template>
            {{ copiedLabel === 'mortgage' ? '已复制' : '复制结果' }}
          </NButton>
        </div>

        <div
          class="overflow-x-auto rounded-[var(--lumin-radius-md)] border border-[var(--lumin-color-border)]"
        >
          <table class="w-full min-w-[560px] text-right text-sm">
            <thead class="bg-[var(--lumin-color-surface)] text-[var(--lumin-color-text-secondary)]">
              <tr>
                <th class="px-3 py-2 text-left font-medium">期数</th>
                <th class="px-3 py-2 font-medium">月供</th>
                <th class="px-3 py-2 font-medium">本金</th>
                <th class="px-3 py-2 font-medium">利息</th>
                <th class="px-3 py-2 font-medium">剩余本金</th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="row in mortgagePreview"
                :key="row.month"
                data-mortgage-row
                class="border-t border-[var(--lumin-color-border)]"
              >
                <td class="px-3 py-1.5 text-left font-mono">{{ row.month }}</td>
                <td class="px-3 py-1.5 font-mono">{{ money(row.payment) }}</td>
                <td class="px-3 py-1.5 font-mono">{{ money(row.principalPart) }}</td>
                <td class="px-3 py-1.5 font-mono">{{ money(row.interestPart) }}</td>
                <td class="px-3 py-1.5 font-mono">{{ money(row.remaining) }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>

    <!-- 个税 -->
    <div v-else-if="activeTab === 'tax'" class="flex flex-col gap-4">
      <div class="flex flex-wrap items-end gap-4">
        <div class="flex w-52 flex-col gap-1">
          <NText depth="2" class="text-sm">税前月薪（元）</NText>
          <NInputNumber
            v-model:value="taxGross"
            :min="0"
            :step="1000"
            placeholder="税前月薪（元）"
            aria-label="税前月薪"
          />
        </div>
        <div class="flex w-52 flex-col gap-1">
          <NText depth="2" class="text-sm">五险一金（元）</NText>
          <NInputNumber
            v-model:value="taxInsurance"
            :min="0"
            :step="100"
            placeholder="五险一金（元）"
            aria-label="五险一金"
          />
        </div>
        <div class="flex w-52 flex-col gap-1">
          <NText depth="2" class="text-sm">专项附加扣除（元）</NText>
          <NInputNumber
            v-model:value="taxSpecial"
            :min="0"
            :step="100"
            placeholder="专项附加扣除（元）"
            aria-label="专项附加扣除"
          />
        </div>
      </div>

      <p class="text-xs text-[var(--lumin-color-text-secondary)]">
        月度口径：应纳税所得额 = 税前月薪 − 五险一金 − 专项附加扣除 − 起征点
        {{ TAX_MONTHLY_THRESHOLD }} 元；不含年终奖与年度汇算清缴。
      </p>

      <div v-if="taxError !== null" role="alert" class="text-sm text-[var(--lumin-color-error)]">
        {{ taxError }}（LC_TAX_INVALID）
      </div>

      <div v-if="taxResult !== null" class="flex flex-col gap-4">
        <div class="grid grid-cols-2 gap-3 md:grid-cols-4">
          <div
            v-for="card in taxCards"
            :key="card.metric"
            :data-tax-metric="card.metric"
            class="flex flex-col gap-1 rounded-[var(--lumin-radius-md)] bg-[var(--lumin-color-surface)] p-3"
          >
            <span class="text-xs text-[var(--lumin-color-text-secondary)]">{{ card.label }}</span>
            <span class="font-mono text-base font-semibold">{{ card.value }}</span>
          </div>
        </div>

        <div class="flex flex-wrap items-center justify-between gap-3">
          <span class="text-xs text-[var(--lumin-color-text-secondary)]">
            适用税率档位 {{ percentText(taxResult.bracketRate) }}
          </span>
          <NButton size="small" @click="copyText(taxCopyText, 'tax')">
            <template #icon>
              <Check v-if="copiedLabel === 'tax'" :size="14" />
              <Copy v-else :size="14" />
            </template>
            {{ copiedLabel === 'tax' ? '已复制' : '复制结果' }}
          </NButton>
        </div>
      </div>
    </div>

    <!-- 百分比 / 折扣 -->
    <div v-else class="flex flex-col gap-5">
      <section class="flex flex-col gap-3">
        <h2 class="text-sm font-semibold">按百分比增减</h2>
        <div class="flex flex-wrap items-end gap-4">
          <div class="flex w-44 flex-col gap-1">
            <NText depth="2" class="text-sm">基数</NText>
            <NInputNumber v-model:value="percentBase" placeholder="基数" aria-label="基数" />
          </div>
          <div class="flex w-44 flex-col gap-1">
            <NText depth="2" class="text-sm">百分比（%）</NText>
            <NInputNumber
              v-model:value="percentDelta"
              :step="1"
              placeholder="百分比（%）"
              aria-label="增减百分比"
            />
          </div>
          <div class="flex min-w-40 flex-col gap-1">
            <NText depth="2" class="text-sm">结果</NText>
            <span data-percent-apply class="font-mono text-base font-semibold">
              {{ applyValue === null ? '—' : `${money(applyValue)}` }}
            </span>
          </div>
        </div>
        <div
          v-if="applyError !== null"
          role="alert"
          class="text-sm text-[var(--lumin-color-error)]"
        >
          {{ applyError }}（LC_PERCENT_INVALID）
        </div>
      </section>

      <section class="flex flex-col gap-3">
        <h2 class="text-sm font-semibold">变化率</h2>
        <div class="flex flex-wrap items-end gap-4">
          <div class="flex w-44 flex-col gap-1">
            <NText depth="2" class="text-sm">原值</NText>
            <NInputNumber v-model:value="changeFrom" placeholder="原值" aria-label="原值" />
          </div>
          <div class="flex w-44 flex-col gap-1">
            <NText depth="2" class="text-sm">新值</NText>
            <NInputNumber v-model:value="changeTo" placeholder="新值" aria-label="新值" />
          </div>
          <div class="flex min-w-40 flex-col gap-1">
            <NText depth="2" class="text-sm">变化率</NText>
            <span data-percent-rate class="font-mono text-base font-semibold">
              {{ changeValue === null ? '—' : percentText(changeValue) }}
            </span>
          </div>
        </div>
        <div
          v-if="changeError !== null"
          role="alert"
          class="text-sm text-[var(--lumin-color-error)]"
        >
          {{ changeError }}（LC_PERCENT_INVALID）
        </div>
      </section>

      <section class="flex flex-col gap-3">
        <h2 class="text-sm font-semibold">折扣</h2>
        <div class="flex flex-wrap items-end gap-4">
          <div class="flex w-44 flex-col gap-1">
            <NText depth="2" class="text-sm">原价</NText>
            <NInputNumber v-model:value="discountOriginal" placeholder="原价" aria-label="原价" />
          </div>
          <div class="flex w-44 flex-col gap-1">
            <NText depth="2" class="text-sm">折扣力度（%）</NText>
            <NInputNumber
              v-model:value="discountOff"
              :min="0"
              :max="100"
              placeholder="折扣力度（%）"
              aria-label="折扣力度"
            />
          </div>
          <div class="flex min-w-40 flex-col gap-1">
            <NText depth="2" class="text-sm">折后价</NText>
            <span data-percent-discount class="font-mono text-base font-semibold">
              {{ discountValue === null ? '—' : money(discountValue) }}
            </span>
          </div>
        </div>
        <div
          v-if="discountError !== null"
          role="alert"
          class="text-sm text-[var(--lumin-color-error)]"
        >
          {{ discountError }}（LC_PERCENT_INVALID）
        </div>

        <div class="flex flex-wrap items-end gap-4">
          <div class="flex w-44 flex-col gap-1">
            <NText depth="2" class="text-sm">折后价反推原价</NText>
            <NInputNumber
              v-model:value="reverseDiscounted"
              placeholder="折后价"
              aria-label="折后价"
            />
          </div>
          <div class="flex w-44 flex-col gap-1">
            <NText depth="2" class="text-sm">折扣力度（%）</NText>
            <NInputNumber
              v-model:value="reverseOff"
              :min="0"
              :max="99.99"
              placeholder="反推折扣力度（%）"
              aria-label="反推折扣力度"
            />
          </div>
          <div class="flex min-w-40 flex-col gap-1">
            <NText depth="2" class="text-sm">原价</NText>
            <span data-percent-original class="font-mono text-base font-semibold">
              {{ reverseValue === null ? '—' : money(reverseValue) }}
            </span>
          </div>
        </div>
        <div
          v-if="reverseError !== null"
          role="alert"
          class="text-sm text-[var(--lumin-color-error)]"
        >
          {{ reverseError }}（LC_PERCENT_INVALID）
        </div>
      </section>
    </div>
  </div>
</template>
