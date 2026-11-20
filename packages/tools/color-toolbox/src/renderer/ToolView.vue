<script setup lang="ts">
/**
 * 颜色工具箱（color-toolbox）：HEX/RGB/HSL 互转 + 色阶/配色方案 + WCAG 对比度。
 * 三态：空态（默认主色 + 示例色引导）/ 加载态（无长任务，同步计算豁免）/ 报错态（结构化错误码 + 中文文案）。
 */
import { computed, onUnmounted, ref } from 'vue'
import { ArrowLeftRight, Copy, Dices } from '@lucide/vue'
import { NButton, NInput, NSelect } from 'naive-ui'
import { toStructuredError, type StructuredError } from '@lumin/shared'

import {
  DEFAULT_COLOR,
  contrastRatio,
  formatColor,
  generateScale,
  harmonies,
  parseColor,
  parseHex,
  randomColor,
  rgbToHex,
  wcagVerdict,
  type ColorFormat,
  type Rgb,
  type WcagVerdict
} from '../color'
import { toolError, type ColorToolboxErrorCode } from '../errors'

const WHITE_RGB: Rgb = { r: 255, g: 255, b: 255 }

const FORMAT_OPTIONS: readonly { label: string; value: ColorFormat }[] = [
  { label: 'HEX', value: 'hex' },
  { label: 'RGB', value: 'rgb' },
  { label: 'HSL', value: 'hsl' }
]

const PRESETS: readonly { name: string; hex: string }[] = [
  { name: '蓝', hex: '#3B82F6' },
  { name: '红', hex: '#EF4444' },
  { name: '绿', hex: '#22C55E' },
  { name: '橙', hex: '#F59E0B' },
  { name: '紫', hex: '#8B5CF6' }
]

const format = ref<ColorFormat>('hex')
const main = ref<Rgb>(DEFAULT_COLOR)
const inputText = ref(formatColor(DEFAULT_COLOR, 'hex'))
const inputError = ref<StructuredError | null>(null)
const backgroundColor = ref('#FFFFFF')
const clipboardError = ref<StructuredError | null>(null)
const copied = ref('')

let copiedTimer: ReturnType<typeof setTimeout> | undefined

const hex = computed(() => rgbToHex(main.value))

const colorValues = computed<readonly { key: string; label: string; value: string }[]>(() => [
  { key: 'hex', label: 'HEX', value: rgbToHex(main.value) },
  { key: 'rgb', label: 'RGB', value: formatColor(main.value, 'rgb') },
  { key: 'hsl', label: 'HSL', value: formatColor(main.value, 'hsl') }
])

const scale = computed<Rgb[]>(() => generateScale(main.value))
const schemes = computed(() => harmonies(main.value))

const backgroundRgb = computed<Rgb>(() => parseHex(backgroundColor.value) ?? WHITE_RGB)
const contrast = computed(() => contrastRatio(main.value, backgroundRgb.value))
const normalVerdict = computed<WcagVerdict>(() => wcagVerdict(contrast.value, false))
const largeVerdict = computed<WcagVerdict>(() => wcagVerdict(contrast.value, true))

const contrastBadges = computed<readonly { label: string; pass: boolean }[]>(() => [
  { label: '正文 AA ≥4.5', pass: normalVerdict.value !== 'FAIL' },
  { label: '正文 AAA ≥7', pass: normalVerdict.value === 'AAA' },
  { label: '大字 AA ≥3', pass: largeVerdict.value !== 'FAIL' },
  { label: '大字 AAA ≥4.5', pass: largeVerdict.value === 'AAA' }
])

function presetRgb(value: string): Rgb {
  return parseHex(value) ?? DEFAULT_COLOR
}

function applyColor(rgb: Rgb): void {
  main.value = rgb
  inputText.value = formatColor(rgb, format.value)
  inputError.value = null
}

function onInput(value: string): void {
  inputText.value = value
  if (value.trim() === '') {
    inputError.value = null
    return
  }
  const parsed = parseColor(value, format.value)
  if (parsed === null) {
    inputError.value = toolError('CT_INVALID_COLOR', `无效的 ${format.value.toUpperCase()} 值`)
    return
  }
  inputError.value = null
  main.value = parsed
}

function onFormatChange(value: string | number): void {
  if (value !== 'hex' && value !== 'rgb' && value !== 'hsl') return
  format.value = value
  inputText.value = formatColor(main.value, value)
  inputError.value = null
}

function onPick(event: Event): void {
  const target = event.target
  if (!(target instanceof HTMLInputElement)) return
  const parsed = parseHex(target.value)
  if (parsed !== null) applyColor(parsed)
}

function onBackgroundPick(event: Event): void {
  const target = event.target
  if (!(target instanceof HTMLInputElement)) return
  if (parseHex(target.value) === null) return
  backgroundColor.value = target.value.toUpperCase()
}

function onRandom(): void {
  applyColor(randomColor())
}

function onSwapContrast(): void {
  const previous = backgroundRgb.value
  backgroundColor.value = rgbToHex(main.value)
  applyColor(previous)
}

function flashCopied(key: string): void {
  copied.value = key
  if (copiedTimer !== undefined) clearTimeout(copiedTimer)
  copiedTimer = setTimeout(() => {
    copied.value = ''
  }, 1200)
}

async function copy(key: string, value: string): Promise<void> {
  clipboardError.value = null
  try {
    await navigator.clipboard.writeText(value)
    flashCopied(key)
  } catch (err) {
    const code: ColorToolboxErrorCode = 'CT_CLIPBOARD_FAILED'
    clipboardError.value = toolError(code, toStructuredError(err).message)
  }
}

function copyScale(): void {
  void copy('scale', scale.value.map((color) => rgbToHex(color)).join(', '))
}

function badgeClass(pass: boolean): string {
  const base = 'rounded-[var(--lumin-radius-md)] border px-2 py-0.5 text-xs'
  return pass
    ? `${base} border-[var(--lumin-color-success)] text-[var(--lumin-color-success)]`
    : `${base} border-[var(--lumin-color-error)] text-[var(--lumin-color-error)]`
}

function swatchClass(): string {
  return 'rounded-[var(--lumin-radius-md)] border border-[var(--lumin-color-border)]'
}

onUnmounted(() => {
  if (copiedTimer !== undefined) clearTimeout(copiedTimer)
})
</script>

<template>
  <div class="flex max-w-4xl flex-col gap-4">
    <header class="flex flex-col gap-1">
      <h2 class="text-lg font-semibold text-[var(--lumin-color-text)]">颜色工具箱</h2>
      <p class="text-sm text-[var(--lumin-color-text-secondary)]">
        HEX / RGB / HSL 互转、色阶与配色方案、WCAG 对比度检测，全程本地计算
      </p>
    </header>

    <section
      class="flex flex-col gap-3 rounded-[var(--lumin-radius-md)] border border-[var(--lumin-color-border)] bg-[var(--lumin-color-surface)] p-4"
    >
      <div class="flex flex-wrap items-end gap-3">
        <label class="flex flex-col gap-1 text-xs text-[var(--lumin-color-text-secondary)]">
          取色器
          <input
            type="color"
            :value="hex"
            aria-label="取色器"
            class="h-10 w-16 cursor-pointer rounded-[var(--lumin-radius-md)] border border-[var(--lumin-color-border)] bg-transparent"
            @input="onPick"
          />
        </label>
        <div class="w-24">
          <NSelect
            :value="format"
            :options="[...FORMAT_OPTIONS]"
            aria-label="输入格式"
            @update:value="onFormatChange"
          />
        </div>
        <div class="min-w-0 flex-1">
          <NInput
            :value="inputText"
            :placeholder="formatColor(main, format)"
            aria-label="颜色值"
            @update:value="onInput"
          />
        </div>
        <NButton @click="onRandom">
          <template #icon><Dices :size="16" /></template>
          随机
        </NButton>
      </div>

      <p v-if="inputError !== null" role="alert" class="text-sm text-[var(--lumin-color-error)]">
        {{ inputError.message }}
        <span class="ml-2 text-xs opacity-70">{{ inputError.code }}</span>
      </p>
      <p v-else class="text-xs text-[var(--lumin-color-text-secondary)]">
        输入格式随右侧切换：HEX（#3B82F6）/ RGB（rgb(59, 130, 246)）/ HSL（hsl(217, 91%, 60%)）
      </p>

      <div class="flex flex-wrap items-center gap-2">
        <span class="text-xs text-[var(--lumin-color-text-secondary)]">示例</span>
        <button
          v-for="preset in PRESETS"
          :key="preset.hex"
          type="button"
          :aria-label="`示例颜色 ${preset.name}`"
          :title="`${preset.name} ${preset.hex}`"
          class="h-6 w-6 rounded-full border border-[var(--lumin-color-border)]"
          :style="{ backgroundColor: preset.hex }"
          @click="applyColor(presetRgb(preset.hex))"
        />
      </div>
    </section>

    <section
      class="flex flex-col gap-2 rounded-[var(--lumin-radius-md)] border border-[var(--lumin-color-border)] bg-[var(--lumin-color-surface)] p-4"
    >
      <h3 class="text-sm font-semibold text-[var(--lumin-color-text)]">颜色值</h3>
      <div class="grid gap-2 sm:grid-cols-3">
        <div
          v-for="item in colorValues"
          :key="item.key"
          class="flex items-center gap-2 rounded-[var(--lumin-radius-md)] border border-[var(--lumin-color-border)] px-3 py-2"
        >
          <div class="flex min-w-0 flex-1 flex-col">
            <span class="text-xs text-[var(--lumin-color-text-secondary)]">{{ item.label }}</span>
            <span class="truncate font-mono text-sm text-[var(--lumin-color-text)]">
              {{ item.value }}
            </span>
          </div>
          <NButton size="small" quaternary @click="copy(item.key, item.value)">
            <template #icon><Copy :size="14" /></template>
            {{ copied === item.key ? '已复制' : '复制' }}
          </NButton>
        </div>
      </div>
      <p
        v-if="clipboardError !== null"
        role="alert"
        class="text-sm text-[var(--lumin-color-error)]"
      >
        {{ clipboardError.message }}
        <span class="ml-2 text-xs opacity-70">{{ clipboardError.code }}</span>
      </p>
    </section>

    <section
      class="flex flex-col gap-3 rounded-[var(--lumin-radius-md)] border border-[var(--lumin-color-border)] bg-[var(--lumin-color-surface)] p-4"
    >
      <div class="flex items-center gap-2">
        <h3 class="text-sm font-semibold text-[var(--lumin-color-text)]">色阶</h3>
        <span class="text-xs text-[var(--lumin-color-text-secondary)]">点击色块设为主色</span>
        <NButton size="tiny" quaternary class="ml-auto" @click="copyScale">
          {{ copied === 'scale' ? '已复制' : '复制整组' }}
        </NButton>
      </div>
      <div class="grid grid-cols-5 gap-2 sm:grid-cols-10">
        <button
          v-for="(color, index) in scale"
          :key="index"
          type="button"
          :aria-label="`色阶 ${rgbToHex(color)}`"
          :title="rgbToHex(color)"
          class="flex flex-col items-center gap-1"
          @click="applyColor(color)"
        >
          <span
            :class="swatchClass()"
            class="h-10 w-full"
            :style="{ backgroundColor: rgbToHex(color) }"
          />
          <span class="text-xs text-[var(--lumin-color-text-secondary)]">{{
            rgbToHex(color)
          }}</span>
        </button>
      </div>
    </section>

    <section
      class="flex flex-col gap-3 rounded-[var(--lumin-radius-md)] border border-[var(--lumin-color-border)] bg-[var(--lumin-color-surface)] p-4"
    >
      <div class="flex items-center gap-2">
        <h3 class="text-sm font-semibold text-[var(--lumin-color-text)]">配色方案</h3>
        <span class="text-xs text-[var(--lumin-color-text-secondary)]">点击色块设为主色</span>
      </div>
      <div class="grid gap-3 sm:grid-cols-2">
        <div
          v-for="scheme in schemes"
          :key="scheme.id"
          class="flex flex-col gap-2 rounded-[var(--lumin-radius-md)] border border-[var(--lumin-color-border)] p-3"
        >
          <span class="text-sm font-medium text-[var(--lumin-color-text)]">{{ scheme.name }}</span>
          <div class="flex gap-2">
            <button
              v-for="(color, index) in scheme.colors"
              :key="index"
              type="button"
              :aria-label="`${scheme.name} ${rgbToHex(color)}`"
              :title="rgbToHex(color)"
              :class="swatchClass()"
              class="h-10 flex-1"
              :style="{ backgroundColor: rgbToHex(color) }"
              @click="applyColor(color)"
            />
          </div>
          <p class="text-xs text-[var(--lumin-color-text-secondary)]">
            {{ scheme.colors.map((color) => rgbToHex(color)).join(' · ') }}
          </p>
        </div>
      </div>
    </section>

    <section
      class="flex flex-col gap-3 rounded-[var(--lumin-radius-md)] border border-[var(--lumin-color-border)] bg-[var(--lumin-color-surface)] p-4"
    >
      <div class="flex flex-wrap items-center gap-3">
        <h3 class="text-sm font-semibold text-[var(--lumin-color-text)]">对比度</h3>
        <label class="flex items-center gap-2 text-xs text-[var(--lumin-color-text-secondary)]">
          背景色
          <input
            type="color"
            :value="backgroundColor"
            aria-label="背景色"
            class="h-8 w-12 cursor-pointer rounded-[var(--lumin-radius-md)] border border-[var(--lumin-color-border)] bg-transparent"
            @input="onBackgroundPick"
          />
        </label>
        <NButton size="small" quaternary aria-label="交换前景背景颜色" @click="onSwapContrast">
          <template #icon><ArrowLeftRight :size="14" /></template>
          交换
        </NButton>
        <span class="ml-auto text-lg font-semibold tabular-nums text-[var(--lumin-color-text)]">
          {{ contrast.toFixed(2) }} : 1
        </span>
      </div>

      <div class="flex flex-wrap gap-2">
        <span v-for="badge in contrastBadges" :key="badge.label" :class="badgeClass(badge.pass)">
          {{ badge.label }} {{ badge.pass ? '通过' : '未通过' }}
        </span>
      </div>

      <div
        class="flex flex-col gap-1 rounded-[var(--lumin-radius-md)] border border-[var(--lumin-color-border)] p-4"
        :style="{ backgroundColor: backgroundColor, color: hex }"
      >
        <p class="text-sm">示例正文：Lumin 颜色工具箱</p>
        <p class="text-2xl font-semibold">大字示例 Sample</p>
      </div>
    </section>
  </div>
</template>
