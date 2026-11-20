<script setup lang="ts">
/**
 * 密码生成器（password-generator）：强随机密码（熵/强度） / UUID v4 / 随机字符串与整数。
 * 三态：空态（各页签均自动生成首批结果）/ 加载态（全同步纯函数，豁免）/
 * 报错态（结构化错误码 + 中文文案，各页签独立展示）。
 */
import { computed, onUnmounted, ref, watch } from 'vue'
import { Check, Copy, Dices, RefreshCw } from '@lucide/vue'
import { NButton, NCheckbox, NInput, NInputNumber, NSelect, NTabPane, NTabs, NText } from 'naive-ui'
import type { StructuredError } from '@lumin/shared'

import {
  PASSWORD_LENGTH_MAX,
  PASSWORD_LENGTH_MIN,
  RANDOM_STRING_LENGTH_MAX,
  RANDOM_STRING_LENGTH_MIN,
  RANDOM_STRING_POOLS,
  generatePassword,
  generateRandomInt,
  generateRandomString,
  generateUuidV4,
  poolOf,
  strengthOf,
  type PasswordResult,
  type RandomPoolId,
  type StrengthLevel
} from '../password'
import { toolError } from '../errors'

const activeTab = ref('password')
const copiedLabel = ref('')
const clipboardError = ref<StructuredError | null>(null)

let copiedTimer: ReturnType<typeof setTimeout> | undefined

const STRENGTH_COLOR: Record<StrengthLevel, string> = {
  weak: 'var(--lumin-color-error)',
  medium: 'var(--lumin-color-warning)',
  strong: 'var(--lumin-color-primary)',
  'very-strong': 'var(--lumin-color-success)'
}

/* ---------- Tab1 密码 ---------- */

const passwordLength = ref<number | null>(16)
const useLowercase = ref(true)
const useUppercase = ref(true)
const useDigits = ref(true)
const useSymbols = ref(false)
const excludeAmbiguous = ref(false)
const excludeChars = ref('')

const passwordResult = ref<PasswordResult | null>(null)
const passwordError = ref<StructuredError | null>(null)

const passwordStrength = computed(() =>
  passwordResult.value === null ? null : strengthOf(passwordResult.value.entropyBits)
)

const strengthPercent = computed(() => {
  const bits = passwordResult.value?.entropyBits ?? 0
  return Math.min(100, Math.max(4, bits))
})

function regeneratePassword(): void {
  const length = passwordLength.value
  if (length === null) {
    passwordResult.value = null
    passwordError.value = toolError('PG_INVALID_OPTIONS', '请输入密码长度')
    return
  }
  const result = generatePassword({
    length,
    lowercase: useLowercase.value,
    uppercase: useUppercase.value,
    digits: useDigits.value,
    symbols: useSymbols.value,
    excludeAmbiguous: excludeAmbiguous.value,
    excludeChars: excludeChars.value
  })
  if (!result.ok) {
    passwordResult.value = null
    passwordError.value = toolError('PG_INVALID_OPTIONS', result.message)
    return
  }
  passwordError.value = null
  passwordResult.value = result.value
}

watch(
  [
    passwordLength,
    useLowercase,
    useUppercase,
    useDigits,
    useSymbols,
    excludeAmbiguous,
    excludeChars
  ],
  regeneratePassword,
  { immediate: true }
)

/* ---------- Tab2 UUID ---------- */

const uuidCount = ref<number | null>(1)
const uuidList = ref<string[]>([])
const uuidError = ref<StructuredError | null>(null)

function regenerateUuids(): void {
  const count = uuidCount.value
  if (count === null || !Number.isInteger(count) || count < 1 || count > 50) {
    uuidList.value = []
    uuidError.value = toolError('PG_INVALID_OPTIONS', 'UUID 数量需为 1–50 的整数')
    return
  }
  uuidError.value = null
  uuidList.value = Array.from({ length: count }, () => generateUuidV4())
}

watch(uuidCount, regenerateUuids, { immediate: true })

/* ---------- Tab3 随机字符串 / 整数 ---------- */

const randomPoolId = ref<RandomPoolId>('alphanumeric')
const randomLength = ref<number | null>(32)
const randomCount = ref<number | null>(5)
const randomStrings = ref<string[]>([])
const randomStringsError = ref<StructuredError | null>(null)

const POOL_OPTIONS = RANDOM_STRING_POOLS.map((item) => ({ label: item.label, value: item.id }))

function regenerateRandomStrings(): void {
  const length = randomLength.value
  const count = randomCount.value
  if (length === null || count === null || !Number.isInteger(count) || count < 1 || count > 20) {
    randomStrings.value = []
    randomStringsError.value = toolError('PG_INVALID_OPTIONS', '数量需为 1–20 的整数')
    return
  }
  const pool = poolOf(randomPoolId.value)
  const values: string[] = []
  for (let i = 0; i < count; i += 1) {
    const result = generateRandomString(length, pool)
    if (!result.ok) {
      randomStrings.value = []
      randomStringsError.value = toolError('PG_INVALID_OPTIONS', result.message)
      return
    }
    values.push(result.value)
  }
  randomStringsError.value = null
  randomStrings.value = values
}

watch([randomPoolId, randomLength, randomCount], regenerateRandomStrings, { immediate: true })

const randomIntMin = ref<number | null>(1)
const randomIntMax = ref<number | null>(100)
const randomIntResults = ref<number[]>([])
const randomIntError = ref<StructuredError | null>(null)

const randomIntValue = computed(() => randomIntResults.value[0] ?? null)

function regenerateRandomInt(): void {
  const min = randomIntMin.value
  const max = randomIntMax.value
  if (min === null || max === null) {
    randomIntResults.value = []
    randomIntError.value = toolError('PG_INVALID_OPTIONS', '请填写最大值与最小值')
    return
  }
  const result = generateRandomInt(min, max)
  if (!result.ok) {
    randomIntResults.value = []
    randomIntError.value = toolError('PG_INVALID_OPTIONS', result.message)
    return
  }
  randomIntError.value = null
  randomIntResults.value = [result.value]
}

watch([randomIntMin, randomIntMax], regenerateRandomInt, { immediate: true })

/* ---------- 通用 ---------- */

function onPoolChange(value: string | number): void {
  const matched = RANDOM_STRING_POOLS.find((item) => item.id === value)
  if (matched !== undefined) randomPoolId.value = matched.id
}

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
    clipboardError.value = toolError('PG_CLIPBOARD_FAILED')
  }
}

function copyUuidAll(): void {
  void copyText(uuidList.value.join('\n'), 'uuid-all')
}

function copyRandomStringsAll(): void {
  void copyText(randomStrings.value.join('\n'), 'random-all')
}

onUnmounted(() => {
  if (copiedTimer !== undefined) clearTimeout(copiedTimer)
})
</script>

<template>
  <div class="flex max-w-4xl flex-col gap-4">
    <div>
      <h1 class="text-base font-semibold">密码生成器</h1>
      <p class="mt-1 text-sm text-[var(--lumin-color-text-secondary)]">
        本地生成强随机密码、UUID v4 与随机字符串/整数（系统加密随机源，不联网、不存储）
      </p>
    </div>

    <!-- 页签仅作切换器，内容用 v-if 渲染；标签必须走 #tab 插槽（与 text-toolbox 同范式） -->
    <NTabs v-model:value="activeTab" type="line">
      <NTabPane name="password">
        <template #tab>密码</template>
      </NTabPane>
      <NTabPane name="uuid">
        <template #tab>UUID</template>
      </NTabPane>
      <NTabPane name="random">
        <template #tab>随机</template>
      </NTabPane>
    </NTabs>

    <div
      v-if="clipboardError !== null"
      role="alert"
      class="text-sm text-[var(--lumin-color-error)]"
    >
      {{ clipboardError.message }}（{{ clipboardError.code }}）
    </div>

    <!-- 密码生成 -->
    <div v-if="activeTab === 'password'" class="flex flex-col gap-4">
      <div class="flex flex-wrap items-end gap-4">
        <div class="flex w-40 flex-col gap-1">
          <NText depth="2" class="text-sm">密码长度</NText>
          <NInputNumber
            v-model:value="passwordLength"
            :min="PASSWORD_LENGTH_MIN"
            :max="PASSWORD_LENGTH_MAX"
            :step="1"
            placeholder="密码长度"
            aria-label="密码长度"
          />
        </div>
        <div class="flex flex-col gap-2">
          <NText depth="2" class="text-sm">字符集</NText>
          <div class="flex flex-wrap items-center gap-4">
            <NCheckbox v-model:checked="useLowercase">小写 a-z</NCheckbox>
            <NCheckbox v-model:checked="useUppercase">大写 A-Z</NCheckbox>
            <NCheckbox v-model:checked="useDigits">数字 0-9</NCheckbox>
            <NCheckbox v-model:checked="useSymbols">符号</NCheckbox>
          </div>
        </div>
      </div>

      <div class="flex flex-wrap items-center gap-4">
        <NCheckbox v-model:checked="excludeAmbiguous">排除易混淆字符（0 O o I l 1）</NCheckbox>
        <div class="flex min-w-64 flex-1 flex-col gap-1">
          <NText depth="2" class="text-sm">额外排除的字符（可选）</NText>
          <NInput
            v-model:value="excludeChars"
            placeholder="额外排除的字符（可选）"
            aria-label="额外排除的字符"
          />
        </div>
      </div>

      <div
        v-if="passwordError !== null"
        role="alert"
        class="text-sm text-[var(--lumin-color-error)]"
      >
        {{ passwordError.message }}（{{ passwordError.code }}）
      </div>

      <div
        v-if="passwordResult !== null"
        class="flex flex-col gap-3 rounded-[var(--lumin-radius-md)] bg-[var(--lumin-color-surface)] p-4"
      >
        <div data-password class="select-all break-all font-mono text-base">
          {{ passwordResult.password }}
        </div>
        <div class="flex items-center gap-3">
          <div class="h-2 flex-1 overflow-hidden rounded-full bg-[var(--lumin-color-border)]">
            <div
              class="h-full rounded-full"
              :style="{
                width: `${strengthPercent}%`,
                backgroundColor:
                  passwordStrength === null ? 'transparent' : STRENGTH_COLOR[passwordStrength.level]
              }"
            ></div>
          </div>
          <span
            v-if="passwordStrength !== null"
            data-strength
            class="text-sm font-medium"
            :style="{ color: STRENGTH_COLOR[passwordStrength.level] }"
          >
            强度：{{ passwordStrength.label }}
          </span>
        </div>
        <div class="flex flex-wrap items-center justify-between gap-3">
          <span class="text-xs text-[var(--lumin-color-text-secondary)]">
            熵 {{ passwordResult.entropyBits.toFixed(1) }} bits · 字符池
            {{ passwordResult.poolSize }} 个
          </span>
          <div class="flex items-center gap-2">
            <NButton size="small" @click="regeneratePassword">
              <template #icon>
                <RefreshCw :size="14" />
              </template>
              重新生成
            </NButton>
            <NButton
              size="small"
              type="primary"
              @click="copyText(passwordResult.password, 'password')"
            >
              <template #icon>
                <Check v-if="copiedLabel === 'password'" :size="14" />
                <Copy v-else :size="14" />
              </template>
              {{ copiedLabel === 'password' ? '已复制' : '复制' }}
            </NButton>
          </div>
        </div>
      </div>
    </div>

    <!-- UUID v4 -->
    <div v-else-if="activeTab === 'uuid'" class="flex flex-col gap-4">
      <div class="flex flex-wrap items-end gap-3">
        <div class="flex w-44 flex-col gap-1">
          <NText depth="2" class="text-sm">生成数量</NText>
          <NInputNumber
            v-model:value="uuidCount"
            :min="1"
            :max="50"
            :step="1"
            placeholder="数量（1–50）"
            aria-label="UUID 生成数量"
          />
        </div>
        <NButton type="primary" @click="regenerateUuids">
          <template #icon>
            <RefreshCw :size="14" />
          </template>
          生成
        </NButton>
        <NButton :disabled="uuidList.length === 0" @click="copyUuidAll">
          <template #icon>
            <Check v-if="copiedLabel === 'uuid-all'" :size="14" />
            <Copy v-else :size="14" />
          </template>
          {{ copiedLabel === 'uuid-all' ? '已复制全部' : '复制全部' }}
        </NButton>
      </div>

      <div v-if="uuidError !== null" role="alert" class="text-sm text-[var(--lumin-color-error)]">
        {{ uuidError.message }}（{{ uuidError.code }}）
      </div>

      <ul v-if="uuidList.length > 0" class="flex flex-col gap-2">
        <li
          v-for="(uuid, index) in uuidList"
          :key="`${uuid}-${index}`"
          data-uuid-item
          class="flex items-center justify-between gap-3 rounded-[var(--lumin-radius-md)] bg-[var(--lumin-color-surface)] px-3 py-2"
        >
          <span class="select-all break-all font-mono text-sm">{{ uuid }}</span>
          <NButton size="tiny" @click="copyText(uuid, `uuid-${index}`)">
            <template #icon>
              <Check v-if="copiedLabel === `uuid-${index}`" :size="12" />
              <Copy v-else :size="12" />
            </template>
            {{ copiedLabel === `uuid-${index}` ? '已复制' : '复制' }}
          </NButton>
        </li>
      </ul>
    </div>

    <!-- 随机字符串 / 整数 -->
    <div v-else class="flex flex-col gap-5">
      <section class="flex flex-col gap-3">
        <h2 class="text-sm font-semibold">随机字符串</h2>
        <div class="flex flex-wrap items-end gap-3">
          <div class="flex w-40 flex-col gap-1">
            <NText depth="2" class="text-sm">字符集</NText>
            <NSelect
              :value="randomPoolId"
              :options="POOL_OPTIONS"
              aria-label="随机字符串字符集"
              @update:value="onPoolChange"
            />
          </div>
          <div class="flex w-36 flex-col gap-1">
            <NText depth="2" class="text-sm">长度</NText>
            <NInputNumber
              v-model:value="randomLength"
              :min="RANDOM_STRING_LENGTH_MIN"
              :max="RANDOM_STRING_LENGTH_MAX"
              :step="1"
              placeholder="字符串长度"
              aria-label="随机字符串长度"
            />
          </div>
          <div class="flex w-36 flex-col gap-1">
            <NText depth="2" class="text-sm">数量</NText>
            <NInputNumber
              v-model:value="randomCount"
              :min="1"
              :max="20"
              :step="1"
              placeholder="生成数量（1–20）"
              aria-label="随机字符串数量"
            />
          </div>
          <NButton type="primary" @click="regenerateRandomStrings">
            <template #icon>
              <Dices :size="14" />
            </template>
            生成
          </NButton>
          <NButton :disabled="randomStrings.length === 0" @click="copyRandomStringsAll">
            <template #icon>
              <Check v-if="copiedLabel === 'random-all'" :size="14" />
              <Copy v-else :size="14" />
            </template>
            {{ copiedLabel === 'random-all' ? '已复制全部' : '复制全部' }}
          </NButton>
        </div>

        <div
          v-if="randomStringsError !== null"
          role="alert"
          class="text-sm text-[var(--lumin-color-error)]"
        >
          {{ randomStringsError.message }}（{{ randomStringsError.code }}）
        </div>

        <ul v-if="randomStrings.length > 0" class="flex flex-col gap-2">
          <li
            v-for="(text, index) in randomStrings"
            :key="`${text}-${index}`"
            data-random-string
            class="flex items-center justify-between gap-3 rounded-[var(--lumin-radius-md)] bg-[var(--lumin-color-surface)] px-3 py-2"
          >
            <span class="select-all break-all font-mono text-sm">{{ text }}</span>
            <NButton size="tiny" @click="copyText(text, `random-${index}`)">
              <template #icon>
                <Check v-if="copiedLabel === `random-${index}`" :size="12" />
                <Copy v-else :size="12" />
              </template>
              {{ copiedLabel === `random-${index}` ? '已复制' : '复制' }}
            </NButton>
          </li>
        </ul>
      </section>

      <section class="flex flex-col gap-3">
        <h2 class="text-sm font-semibold">随机整数</h2>
        <div class="flex flex-wrap items-end gap-3">
          <div class="flex w-36 flex-col gap-1">
            <NText depth="2" class="text-sm">最小值</NText>
            <NInputNumber
              v-model:value="randomIntMin"
              :step="1"
              placeholder="最小值"
              aria-label="随机整数最小值"
            />
          </div>
          <div class="flex w-36 flex-col gap-1">
            <NText depth="2" class="text-sm">最大值</NText>
            <NInputNumber
              v-model:value="randomIntMax"
              :step="1"
              placeholder="最大值"
              aria-label="随机整数最大值"
            />
          </div>
          <NButton type="primary" @click="regenerateRandomInt">
            <template #icon>
              <Dices :size="14" />
            </template>
            生成随机数
          </NButton>
        </div>

        <div
          v-if="randomIntError !== null"
          role="alert"
          class="text-sm text-[var(--lumin-color-error)]"
        >
          {{ randomIntError.message }}（{{ randomIntError.code }}）
        </div>

        <div
          v-if="randomIntValue !== null"
          class="flex items-center gap-3 rounded-[var(--lumin-radius-md)] bg-[var(--lumin-color-surface)] px-3 py-2"
        >
          <span data-random-int class="select-all font-mono text-lg">{{ randomIntValue }}</span>
          <NButton size="small" @click="copyText(String(randomIntValue), 'int')">
            <template #icon>
              <Check v-if="copiedLabel === 'int'" :size="14" />
              <Copy v-else :size="14" />
            </template>
            {{ copiedLabel === 'int' ? '已复制' : '复制' }}
          </NButton>
        </div>
      </section>
    </div>
  </div>
</template>
