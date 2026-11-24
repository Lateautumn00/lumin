<script setup lang="ts">
/**
 * 实用工具 · 中文信息：数据脱敏、身份证校验、金额大写三卡片区（spec M60）。
 * 三态：空态（三卡各自引导文案）/ 加载态（同步纯函数计算，同 IP 页签豁免）/
 * 报错态（MT_ID_*、MT_AMOUNT_INVALID、MT_CLIPBOARD_FAILED → 中文 + 错误码，复制失败可重试）。
 * 纯 renderer 零 IPC、零依赖；复制走 navigator.clipboard，成功 1.2s 内按钮显示「已复制」。
 */
import { computed, onUnmounted, ref } from 'vue'
import { NAlert, NButton, NInput, NTag, NText } from 'naive-ui'
import { Coins, Copy, IdCard, ShieldCheck } from '@lucide/vue'
import { toStructuredError, type StructuredError } from '@lumin/shared'

import { errorMessage, toolError } from '../errors'
import {
  amountToChinese,
  maskEmail,
  maskIdCard,
  maskName,
  maskPhone,
  validateIdCard
} from '../chinese-info'

/* ---------- 卡 1：数据脱敏 ---------- */

interface MaskRow {
  key: string
  label: string
  value: string | null
}

const maskInput = ref('')
const copyError = ref<StructuredError | null>(null)
const copiedKey = ref('')
let copiedTimer: ReturnType<typeof setTimeout> | undefined

const maskReady = computed(() => maskInput.value.trim() !== '')

const maskRows = computed<MaskRow[]>(() => [
  { key: 'phone', label: '手机', value: maskPhone(maskInput.value) },
  { key: 'id-card', label: '身份证', value: maskIdCard(maskInput.value) },
  { key: 'email', label: '邮箱', value: maskEmail(maskInput.value) },
  { key: 'name', label: '姓名', value: maskName(maskInput.value) }
])

/* ---------- 卡 2：身份证 ---------- */

const idInput = ref('')

const idResult = computed(() =>
  idInput.value.trim() === '' ? null : validateIdCard(idInput.value)
)

/* ---------- 卡 3：金额大写 ---------- */

const amountInput = ref('')

const amountResult = computed(() =>
  amountInput.value.trim() === '' ? null : amountToChinese(amountInput.value)
)

/* ---------- 复制 ---------- */

async function copyText(key: string, text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text)
    copiedKey.value = key
    if (copiedTimer !== undefined) clearTimeout(copiedTimer)
    copiedTimer = setTimeout(() => {
      copiedKey.value = ''
    }, 1200)
  } catch (err) {
    copyError.value = toolError('MT_CLIPBOARD_FAILED', toStructuredError(err).message)
  }
}

function copyMask(row: MaskRow): void {
  if (row.value === null) return
  void copyText(`mask-${row.key}`, row.value)
}

function copyAmount(): void {
  const result = amountResult.value
  if (result === null || !result.ok) return
  void copyText('amount', result.value)
}

onUnmounted(() => {
  if (copiedTimer !== undefined) clearTimeout(copiedTimer)
})
</script>

<template>
  <div class="flex flex-col gap-3">
    <NText depth="3" class="text-sm">
      数据脱敏、身份证校验与金额大写，全部本地计算，不联网、不落盘。
    </NText>

    <NAlert v-if="copyError !== null" type="error" :bordered="false" role="alert">
      {{ errorMessage(copyError.code) }}（{{ copyError.code }}）
      <span v-if="copyError.detail !== undefined" class="ml-1 text-xs opacity-80">
        {{ copyError.detail }}
      </span>
    </NAlert>

    <!-- 卡 1：数据脱敏 -->
    <section
      class="flex flex-col gap-2 rounded-[var(--lumin-radius-md)] border border-[var(--lumin-color-border, #e0e0e6)] p-3"
    >
      <div class="flex items-center gap-2">
        <ShieldCheck class="h-4 w-4" aria-hidden="true" />
        <h2 class="text-sm font-semibold">数据脱敏</h2>
      </div>
      <NInput
        v-model:value="maskInput"
        placeholder="输入手机号、身份证号、邮箱或姓名"
        aria-label="脱敏输入"
        clearable
      />
      <div v-if="maskReady" class="flex flex-col gap-1">
        <div
          v-for="row in maskRows"
          :key="row.key"
          class="flex items-center gap-3"
        >
          <NText depth="2" class="w-14 shrink-0 text-xs">{{ row.label }}</NText>
          <NText class="flex-1 break-all font-mono text-sm">
            {{ row.value ?? '未命中' }}
          </NText>
          <NButton size="tiny" :disabled="row.value === null" @click="copyMask(row)">
            <Copy class="mr-1 h-3.5 w-3.5" />
            {{ copiedKey === `mask-${row.key}` ? '已复制' : '复制' }}
          </NButton>
        </div>
      </div>
      <NText v-else depth="3" class="text-sm">
        输入要脱敏的内容后，按手机 / 身份证 / 邮箱 / 姓名四条规则逐行显示结果；未命中显示「未命中」。
      </NText>
    </section>

    <!-- 卡 2：身份证 -->
    <section
      class="flex flex-col gap-2 rounded-[var(--lumin-radius-md)] border border-[var(--lumin-color-border, #e0e0e6)] p-3"
    >
      <div class="flex items-center gap-2">
        <IdCard class="h-4 w-4" aria-hidden="true" />
        <h2 class="text-sm font-semibold">身份证</h2>
      </div>
      <NInput
        v-model:value="idInput"
        placeholder="输入 18 位身份证号（自动去空格、大写 X）"
        aria-label="身份证输入"
        clearable
      />
      <div v-if="idResult !== null" class="flex flex-wrap items-center gap-x-4 gap-y-1">
        <NTag
          :type="idResult.ok ? 'success' : 'error'"
          :bordered="false"
          data-testid="idcard-badge"
        >
          {{ idResult.ok ? '通过' : '失败' }}
        </NTag>
        <template v-if="idResult.ok">
          <div class="flex items-center gap-2">
            <NText depth="2" class="text-xs">出生日期</NText>
            <NText class="font-mono text-sm">{{ idResult.value.birthDate }}</NText>
          </div>
          <div class="flex items-center gap-2">
            <NText depth="2" class="text-xs">性别</NText>
            <NText class="text-sm">{{ idResult.value.gender }}</NText>
          </div>
        </template>
        <template v-else>
          <NText type="error" class="text-sm">
            {{ errorMessage(idResult.error.code) }}（{{ idResult.error.code }}）
          </NText>
          <NText v-if="idResult.error.detail !== undefined" depth="3" class="text-xs">
            {{ idResult.error.detail }}
          </NText>
        </template>
      </div>
      <NText v-else depth="3" class="text-sm">
        输入 18 位身份证号后校验 GB 11643 校验位，并显示出生日期与性别（顺序码奇男偶女）；15
        位旧版暂不支持。
      </NText>
    </section>

    <!-- 卡 3：金额大写 -->
    <section
      class="flex flex-col gap-2 rounded-[var(--lumin-radius-md)] border border-[var(--lumin-color-border, #e0e0e6)] p-3"
    >
      <div class="flex items-center gap-2">
        <Coins class="h-4 w-4" aria-hidden="true" />
        <h2 class="text-sm font-semibold">金额大写</h2>
      </div>
      <NInput
        v-model:value="amountInput"
        placeholder="输入金额，如 1,234.56"
        aria-label="金额输入"
        clearable
      />
      <template v-if="amountResult !== null && amountResult.ok">
        <div class="flex items-center gap-3">
          <NText depth="2" class="w-8 shrink-0 text-xs">小写</NText>
          <NText class="flex-1 break-all font-mono text-sm">{{ amountInput }}</NText>
        </div>
        <div class="flex items-center gap-3">
          <NText depth="2" class="w-8 shrink-0 text-xs">大写</NText>
          <NText data-testid="amount-chinese" class="flex-1 break-all text-sm">
            {{ amountResult.value }}
          </NText>
          <NButton size="tiny" @click="copyAmount">
            <Copy class="mr-1 h-3.5 w-3.5" />
            {{ copiedKey === 'amount' ? '已复制' : '复制' }}
          </NButton>
        </div>
      </template>
      <div v-else-if="amountResult !== null" role="alert" class="flex flex-col gap-1">
        <NText type="error" class="text-sm">
          {{ errorMessage(amountResult.error.code) }}（{{ amountResult.error.code }}）
        </NText>
        <NText v-if="amountResult.error.detail !== undefined" depth="3" class="text-xs">
          {{ amountResult.error.detail }}
        </NText>
      </div>
      <NText v-else depth="3" class="text-sm">
        输入金额后显示小写 / 大写两行对照；支持负号、千分位与最多两位小数，整数部分不超过 16
        位。
      </NText>
    </section>
  </div>
</template>
