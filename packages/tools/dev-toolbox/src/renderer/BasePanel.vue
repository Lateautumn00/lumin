<script setup lang="ts">
// 进制与位运算（M60）：区 A 进制互转（2/8/10/16 → 四读数卡）+ 区 B 64 位无符号位运算
// 作者：cuilanchao · 修改时间：2026-11-23
import { computed, ref, watch } from 'vue'
import { NAlert, NInput, NRadio, NRadioGroup, NTag, NText } from 'naive-ui'
import { toStructuredError, type StructuredError } from '@lumin/shared'
import {
  bitWidth,
  bitwise,
  convertBase,
  groupDigits,
  parseBitInput,
  type BitwiseOp,
  type Radix
} from '../base'

interface ConvertCards {
  bin: string
  oct: string
  dec: string
  hex: string
  bitWidth: number
}

interface BitCards {
  bin: string
  oct: string
  dec: string
  hex: string
}

/* ---------- 区 A 进制互转 ---------- */

const radixInput = ref('')
const radix = ref<Radix>(10)
const convertCards = ref<ConvertCards | null>(null)
const convertError = ref<StructuredError | null>(null)

watch(
  [radixInput, radix],
  () => {
    const raw = radixInput.value.trim()
    if (raw === '') {
      convertCards.value = null
      convertError.value = null
      return
    }
    try {
      const converted = convertBase(raw, radix.value)
      convertCards.value = {
        bin: groupDigits(converted.unsigned, 2),
        oct: groupDigits(converted.unsigned, 8),
        dec: converted.signed.toString(10),
        hex: groupDigits(converted.unsigned, 16),
        bitWidth: bitWidth(converted.unsigned)
      }
      convertError.value = null
    } catch (err) {
      // 报错时保留上一有效读数
      convertError.value = toStructuredError(err)
    }
  },
  { immediate: true }
)

const convertCardList = computed(() => {
  const cards = convertCards.value
  if (cards === null) return []
  return [
    { key: 'convert-bin', label: 'BIN', value: cards.bin },
    { key: 'convert-oct', label: 'OCT', value: cards.oct },
    { key: 'convert-dec', label: 'DEC', value: cards.dec },
    { key: 'convert-hex', label: 'HEX', value: cards.hex }
  ]
})

function onRadixChange(value: string | number): void {
  if (value === 2 || value === 8 || value === 10 || value === 16) radix.value = value
}

/* ---------- 区 B 位运算 ---------- */

const opA = ref('0')
const opB = ref('0')
const op = ref<BitwiseOp>('and')
const bitCards = ref<BitCards | null>(null)
const bitError = ref<StructuredError | null>(null)

watch(
  [opA, opB, op],
  () => {
    const needB = op.value !== 'not'
    if (opA.value.trim() === '' || (needB && opB.value.trim() === '')) {
      bitCards.value = null
      bitError.value = null
      return
    }
    try {
      const a = parseBitInput(opA.value, 'A')
      const b = needB ? parseBitInput(opB.value, 'B') : 0n
      const result = bitwise(a, op.value, b)
      bitCards.value = {
        bin: groupDigits(result, 2),
        oct: groupDigits(result, 8),
        dec: result.toString(10),
        hex: groupDigits(result, 16)
      }
      bitError.value = null
    } catch (err) {
      // 报错时保留上一有效结果
      bitError.value = toStructuredError(err)
    }
  },
  { immediate: true }
)

const bitCardList = computed(() => {
  const cards = bitCards.value
  if (cards === null) return []
  return [
    { key: 'bit-bin', label: 'BIN', value: cards.bin },
    { key: 'bit-oct', label: 'OCT', value: cards.oct },
    { key: 'bit-dec', label: 'DEC', value: cards.dec },
    { key: 'bit-hex', label: 'HEX', value: cards.hex }
  ]
})

function onOpChange(value: string | number): void {
  if (value === 'and' || value === 'or' || value === 'xor' || value === 'not') op.value = value
}
</script>

<template>
  <div class="flex flex-col gap-4">
    <!-- 区 A 进制互转 -->
    <div
      class="flex flex-col gap-3 rounded-[var(--lumin-radius-md)] border border-[var(--lumin-color-border)] p-3"
      data-testid="radix-convert"
    >
      <div class="flex flex-wrap items-end gap-3">
        <div class="flex min-w-64 flex-1 flex-col gap-1">
          <NText depth="2" class="text-sm">输入值</NText>
          <NInput
            v-model:value="radixInput"
            placeholder="输入数值，如 255、0xFF、0b1010"
            aria-label="进制转换输入"
          />
        </div>
        <div class="flex flex-col gap-1">
          <NText depth="2" class="text-sm">当前进制</NText>
          <NRadioGroup :value="radix" size="small" @update:value="onRadixChange">
            <NRadio :value="2">2</NRadio>
            <NRadio :value="8">8</NRadio>
            <NRadio :value="10">10</NRadio>
            <NRadio :value="16">16</NRadio>
          </NRadioGroup>
        </div>
      </div>

      <NAlert v-if="convertError !== null" type="error" :bordered="false" title="无法转换">
        <span class="text-sm">{{ convertError.message }}（{{ convertError.code }}）</span>
        <p v-if="convertError.detail !== undefined" class="mt-1 break-all text-xs">
          {{ convertError.detail }}
        </p>
      </NAlert>

      <template v-if="convertCards !== null">
        <div class="grid gap-2 sm:grid-cols-2">
          <div
            v-for="card in convertCardList"
            :key="card.key"
            class="flex items-center gap-3 rounded-[var(--lumin-radius-md)] border border-[var(--lumin-color-border, #e0e0e6)] px-3 py-2"
          >
            <NText depth="2" class="w-10 shrink-0 text-xs">{{ card.label }}</NText>
            <NText class="flex-1 break-all font-mono text-sm">{{ card.value }}</NText>
          </div>
        </div>
        <div class="flex items-center gap-2">
          <NTag size="small" :bordered="false">最少 {{ convertCards.bitWidth }} 位</NTag>
        </div>
      </template>
      <NText v-else-if="convertError === null" depth="3" class="text-sm">
        输入数值后显示 BIN / OCT / DEC / HEX 读数；支持 0x / 0b / 0o 前缀（须与所选进制一致）、
        下划线与空格分组。
      </NText>

      <NText depth="3" class="text-xs">
        范围：非负整数 ≤ 2^63-1（十进制可为负，绝对值 ≤ 63 位，负数按 64 位补码视图展示）；
        十六进制大写，BIN / OCT / HEX 每 4 位空格分组，十进制不分组。
      </NText>
    </div>

    <!-- 区 B 位运算（64 位无符号口径） -->
    <div
      class="flex flex-col gap-3 rounded-[var(--lumin-radius-md)] border border-[var(--lumin-color-border)] p-3"
      data-testid="bitwise-ops"
    >
      <div class="flex flex-wrap items-center gap-3">
        <NText depth="2" class="text-sm font-medium">位运算</NText>
        <NRadioGroup :value="op" size="small" @update:value="onOpChange">
          <NRadio value="and">AND</NRadio>
          <NRadio value="or">OR</NRadio>
          <NRadio value="xor">XOR</NRadio>
          <NRadio value="not">NOT</NRadio>
        </NRadioGroup>
      </div>

      <div class="flex flex-wrap items-end gap-3">
        <div class="flex w-56 flex-col gap-1">
          <NText depth="2" class="text-sm">A（十进制）</NText>
          <NInput v-model:value="opA" placeholder="A：十进制整数" aria-label="位运算 A" />
        </div>
        <div v-if="op !== 'not'" class="flex w-56 flex-col gap-1">
          <NText depth="2" class="text-sm">B（十进制）</NText>
          <NInput v-model:value="opB" placeholder="B：十进制整数" aria-label="位运算 B" />
        </div>
      </div>

      <NAlert v-if="bitError !== null" type="error" :bordered="false" title="运算失败">
        <span class="text-sm">{{ bitError.message }}（{{ bitError.code }}）</span>
        <p v-if="bitError.detail !== undefined" class="mt-1 break-all text-xs">
          {{ bitError.detail }}
        </p>
      </NAlert>

      <div v-if="bitCards !== null" class="grid gap-2 sm:grid-cols-2">
        <div
          v-for="card in bitCardList"
          :key="card.key"
          class="flex items-center gap-3 rounded-[var(--lumin-radius-md)] border border-[var(--lumin-color-border, #e0e0e6)] px-3 py-2"
        >
          <NText depth="2" class="w-10 shrink-0 text-xs">{{ card.label }}</NText>
          <NText class="flex-1 break-all font-mono text-sm">{{ card.value }}</NText>
        </div>
      </div>
      <NText v-else-if="bitError === null" depth="3" class="text-sm">
        填写 A / B 后显示四进制结果；NOT 为单目运算（自动隐藏 B）。
      </NText>

      <NText depth="3" class="text-xs">
        输入为十进制非负整数（0 ~ 2^64-1）；运算与结果全程按 64 位无符号 BigInt.asUintN(64, …)
        口径，避免负号困扰。
      </NText>
    </div>
  </div>
</template>
