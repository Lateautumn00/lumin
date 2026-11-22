<script setup lang="ts">
/**
 * 颜色工具箱（color-toolbox）：HEX/RGB/HSL 互转 + 色阶/配色方案 + WCAG 对比度。
 * 三态：空态（默认主色 + 示例色引导）/ 加载态（无长任务，同步计算豁免）/ 报错态（结构化错误码 + 中文文案）。
 */
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { ArrowLeftRight, Copy, Dices, Image, Pipette } from '@lucide/vue'
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
import { extractPalette, paletteText, type PaletteResult } from '../palette'
import { mapPointToPixel } from '../picker'
import type { CaptureDisplayResult } from '../schema'
import {
  VISION_DEFICIENCIES,
  simulateColor,
  type VisionDeficiencyId
} from '../vision'
import { captureDisplay } from './client'

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

/** 色觉模拟：正常（关闭）+ 8 类色觉缺陷 */
type VisionOption = VisionDeficiencyId | 'none'

const VISION_OPTIONS: readonly { label: string; value: VisionOption }[] = [
  { label: '正常（不模拟）', value: 'none' },
  ...VISION_DEFICIENCIES.map((item) => ({ label: item.name, value: item.id }))
]

/** 图片调色板：单张图片大小上限 20MB（spec §2.7） */
const MAX_PALETTE_IMAGE_BYTES = 20 * 1024 * 1024
/** 图片调色板：统计前的最长边下采样尺寸（控制内存与耗时） */
const MAX_PALETTE_EDGE = 480
/** 图片调色板：返回颜色数上限 */
const MAX_PALETTE_COLORS = 8

interface PaletteState {
  readonly fileName: string
  readonly previewUrl: string
  readonly result: PaletteResult
}

const format = ref<ColorFormat>('hex')
const main = ref<Rgb>(DEFAULT_COLOR)
const inputText = ref(formatColor(DEFAULT_COLOR, 'hex'))
const inputError = ref<StructuredError | null>(null)
const backgroundColor = ref('#FFFFFF')
const clipboardError = ref<StructuredError | null>(null)
const capturing = ref(false)
const picker = ref<CaptureDisplayResult | null>(null)
const pickerError = ref<StructuredError | null>(null)
const palette = ref<PaletteState | null>(null)
const paletteLoading = ref(false)
const paletteError = ref<StructuredError | null>(null)
const paletteInput = ref<HTMLInputElement | null>(null)
const vision = ref<VisionOption>('none')
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

/** 按当前色觉模拟选项转换颜色；`none` 时原样返回 */
function simulateOrOriginal(rgb: Rgb): Rgb {
  return vision.value === 'none' ? rgb : simulateColor(rgb, vision.value)
}

const visionLabel = computed(
  () => VISION_OPTIONS.find((item) => item.value === vision.value)?.label ?? '正常（不模拟）'
)
const simulatedMain = computed<Rgb>(() => simulateOrOriginal(main.value))
const simulatedBackground = computed<Rgb>(() => simulateOrOriginal(backgroundRgb.value))
const simulatedSchemes = computed(() =>
  schemes.value.map((scheme) => ({
    ...scheme,
    colors: scheme.colors.map((color) => simulateOrOriginal(color))
  }))
)
const simulatedValues = computed<readonly { key: string; label: string; value: string }[]>(() => [
  { key: 'hex', label: 'HEX', value: rgbToHex(simulatedMain.value) },
  { key: 'rgb', label: 'RGB', value: formatColor(simulatedMain.value, 'rgb') },
  { key: 'hsl', label: 'HSL', value: formatColor(simulatedMain.value, 'hsl') }
])

const contrast = computed(() =>
  contrastRatio(simulatedMain.value, simulatedBackground.value)
)
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

function isVisionOption(value: string): value is VisionOption {
  return VISION_OPTIONS.some((item) => item.value === value)
}

function onVisionChange(event: Event): void {
  const target = event.target
  if (!(target instanceof HTMLSelectElement)) return
  if (isVisionOption(target.value)) vision.value = target.value
}

function resetVision(): void {
  vision.value = 'none'
}

function simulatedHex(rgb: Rgb): string {
  return rgbToHex(simulateOrOriginal(rgb))
}

const displayOptions = computed<readonly { label: string; value: string }[]>(() =>
  picker.value === null
    ? []
    : picker.value.displays.map((item) => ({ label: item.label, value: item.id }))
)

async function openPicker(displayId?: string): Promise<void> {
  if (capturing.value) return
  pickerError.value = null
  capturing.value = true
  try {
    picker.value = await captureDisplay(displayId === undefined ? {} : { displayId })
  } catch (err) {
    pickerError.value = toolError('CT_CAPTURE_FAILED', toStructuredError(err).message)
  } finally {
    capturing.value = false
  }
}

function closePicker(): void {
  picker.value = null
  pickerError.value = null
}

function onPickerKeydown(event: KeyboardEvent): void {
  if (event.key === 'Escape' && picker.value !== null) closePicker()
}

function onDisplayChange(value: string | number): void {
  if (typeof value !== 'string') return
  void openPicker(value)
}

function onPickerClick(event: MouseEvent): void {
  const current = picker.value
  const target = event.currentTarget
  if (current === null || !(target instanceof HTMLImageElement)) return
  const rect = target.getBoundingClientRect()
  const pixel = mapPointToPixel(
    { x: event.clientX, y: event.clientY },
    { left: rect.left, top: rect.top, width: rect.width, height: rect.height },
    { width: current.width, height: current.height }
  )
  if (pixel === null) return
  const canvas = document.createElement('canvas')
  canvas.width = 1
  canvas.height = 1
  const context = canvas.getContext('2d')
  if (context === null) {
    pickerError.value = toolError('CT_CAPTURE_FAILED', '无法读取截图像素')
    return
  }
  context.drawImage(target, pixel.x, pixel.y, 1, 1, 0, 0, 1, 1)
  const data = context.getImageData(0, 0, 1, 1).data
  applyColor({ r: data[0] ?? 0, g: data[1] ?? 0, b: data[2] ?? 0 })
  closePicker()
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

function releasePalette(): void {
  if (palette.value !== null) URL.revokeObjectURL(palette.value.previewUrl)
  palette.value = null
}

function pickPaletteImage(): void {
  if (paletteLoading.value) return
  paletteInput.value?.click()
}

async function analyzeImageFile(file: File): Promise<PaletteState> {
  const previewUrl = URL.createObjectURL(file)
  try {
    const bitmap = await createImageBitmap(file)
    try {
      const scaleFactor = Math.min(
        1,
        MAX_PALETTE_EDGE / Math.max(bitmap.width, bitmap.height, 1)
      )
      const width = Math.max(1, Math.round(bitmap.width * scaleFactor))
      const height = Math.max(1, Math.round(bitmap.height * scaleFactor))
      const canvas = document.createElement('canvas')
      canvas.width = width
      canvas.height = height
      const context = canvas.getContext('2d', { willReadFrequently: true })
      if (context === null) throw new Error('canvas 上下文不可用')
      context.drawImage(bitmap, 0, 0, width, height)
      const result = extractPalette(context.getImageData(0, 0, width, height).data, {
        maxColors: MAX_PALETTE_COLORS
      })
      return { fileName: file.name, previewUrl, result }
    } finally {
      bitmap.close()
    }
  } catch (err) {
    URL.revokeObjectURL(previewUrl)
    throw err
  }
}

async function onPaletteFileChange(event: Event): Promise<void> {
  const target = event.target
  if (!(target instanceof HTMLInputElement)) return
  const file = target.files?.[0]
  target.value = ''
  if (file === undefined) return
  paletteError.value = null
  if (!file.type.startsWith('image/')) {
    paletteError.value = toolError('CT_PALETTE_FAILED', '请选择图片文件')
    return
  }
  if (file.size > MAX_PALETTE_IMAGE_BYTES) {
    paletteError.value = toolError('CT_PALETTE_FAILED', '图片超过 20MB，请压缩后再试')
    return
  }
  paletteLoading.value = true
  try {
    const next = await analyzeImageFile(file)
    releasePalette()
    palette.value = next
  } catch (err) {
    paletteError.value = toolError('CT_PALETTE_FAILED', toStructuredError(err).message)
  } finally {
    paletteLoading.value = false
  }
}

function copyPalette(): void {
  if (palette.value === null) return
  void copy('palette', paletteText(palette.value.result.colors))
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

onMounted(() => {
  window.addEventListener('keydown', onPickerKeydown)
})

onUnmounted(() => {
  window.removeEventListener('keydown', onPickerKeydown)
  releasePalette()
  if (copiedTimer !== undefined) clearTimeout(copiedTimer)
})
</script>

<template>
  <div class="flex max-w-4xl flex-col gap-4">
    <header class="flex flex-col gap-1">
      <h2 class="text-lg font-semibold text-[var(--lumin-color-text)]">颜色工具箱</h2>
      <p class="text-sm text-[var(--lumin-color-text-secondary)]">
        HEX / RGB / HSL 互转、色阶与配色方案、图片调色板、色觉缺陷模拟、WCAG 对比度检测，全程本地计算
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
        <NButton
          :loading="capturing"
          title="截取屏幕后点选颜色（支持应用窗口外的任意位置）"
          @click="openPicker()"
        >
          <template #icon><Pipette :size="16" /></template>
          吸管取色
        </NButton>
      </div>

      <p v-if="inputError !== null" role="alert" class="text-sm text-[var(--lumin-color-error)]">
        {{ inputError.message }}
        <span class="ml-2 text-xs opacity-70">{{ inputError.code }}</span>
      </p>
      <p
        v-else-if="pickerError !== null"
        role="alert"
        class="text-sm text-[var(--lumin-color-error)]"
      >
        {{ pickerError.message }}
        <span class="ml-2 text-xs opacity-70">{{ pickerError.code }}</span>
      </p>
      <p v-else class="text-xs text-[var(--lumin-color-text-secondary)]">
        输入格式随右侧切换：HEX（#3B82F6）/ RGB（rgb(59, 130, 246)）/ HSL（hsl(217, 91%, 60%)）；
        吸管取色可截取整屏，支持吸取应用窗口外的颜色
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
      class="flex flex-col gap-3 rounded-[var(--lumin-radius-md)] border border-[var(--lumin-color-border)] bg-[var(--lumin-color-surface)] p-4"
    >
      <div class="flex flex-wrap items-center gap-2">
        <h3 class="text-sm font-semibold text-[var(--lumin-color-text)]">图片调色板</h3>
        <span class="text-xs text-[var(--lumin-color-text-secondary)]">
          统计主色及占比，点击色块设为主色
        </span>
        <NButton size="small" class="ml-auto" :loading="paletteLoading" @click="pickPaletteImage">
          <template #icon><Image :size="14" /></template>
          {{ palette === null ? '选择图片' : '换一张' }}
        </NButton>
        <NButton v-if="palette !== null" size="small" quaternary @click="copyPalette">
          {{ copied === 'palette' ? '已复制' : '复制整组' }}
        </NButton>
        <input
          ref="paletteInput"
          type="file"
          accept="image/*"
          class="hidden"
          aria-label="选择图片"
          @change="onPaletteFileChange"
        />
      </div>

      <p v-if="paletteError !== null" role="alert" class="text-sm text-[var(--lumin-color-error)]">
        {{ paletteError.message }}
        <span class="ml-2 text-xs opacity-70">{{ paletteError.code }}</span>
      </p>

      <div v-if="palette !== null" class="flex flex-col gap-3 sm:flex-row">
        <div class="flex flex-col items-center gap-1 sm:w-40">
          <img
            :src="palette.previewUrl"
            alt="已选择的图片预览"
            class="max-h-40 w-full rounded-[var(--lumin-radius-md)] border border-[var(--lumin-color-border)] object-contain"
          />
          <span class="w-full truncate text-center text-xs text-[var(--lumin-color-text-secondary)]">
            {{ palette.fileName }}
          </span>
          <span class="text-xs text-[var(--lumin-color-text-secondary)]">
            共 {{ palette.result.totalPixels }} 个像素
          </span>
        </div>
        <div class="flex min-w-0 flex-1 flex-col gap-2">
          <p
            v-if="palette.result.colors.length === 0"
            class="text-xs text-[var(--lumin-color-text-secondary)]"
          >
            图片中没有可统计的不透明像素，请换一张不透明的图片
          </p>
          <div v-else class="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <button
              v-for="color in palette.result.colors"
              :key="color.hex"
              type="button"
              :aria-label="`调色板 ${color.hex}`"
              :title="`${color.hex} · ${color.percent}%`"
              class="flex flex-col items-stretch gap-1"
              @click="applyColor(color.rgb)"
            >
              <span
                :class="swatchClass()"
                class="h-10 w-full"
                :style="{ backgroundColor: color.hex }"
              />
              <span class="font-mono text-xs text-[var(--lumin-color-text)]">{{ color.hex }}</span>
              <span class="text-xs text-[var(--lumin-color-text-secondary)]">
                {{ color.percent }}%
              </span>
            </button>
          </div>
        </div>
      </div>

      <p
        v-if="palette === null && paletteError === null"
        class="text-xs text-[var(--lumin-color-text-secondary)]"
      >
        支持 PNG / JPEG / WebP 等常见格式，单张 ≤20MB；仅本地解析，不上传
      </p>
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
      <p class="text-xs text-[var(--lumin-color-text-secondary)]">
        以上为原始色值，复制不受色觉模拟影响；模拟仅改变下方预览。
      </p>
    </section>

    <section
      class="flex flex-col gap-3 rounded-[var(--lumin-radius-md)] border border-[var(--lumin-color-border)] bg-[var(--lumin-color-surface)] p-4"
    >
      <div class="flex flex-wrap items-center gap-2">
        <h3 class="text-sm font-semibold text-[var(--lumin-color-text)]">色觉模拟</h3>
        <span class="text-xs text-[var(--lumin-color-text-secondary)]">
          切换缺陷查看近似色，不影响主色与复制值
        </span>
        <select
          :value="vision"
          aria-label="色觉缺陷模拟"
          class="ml-auto h-8 rounded-[var(--lumin-radius-md)] border border-[var(--lumin-color-border)] bg-[var(--lumin-color-surface)] px-2 text-sm text-[var(--lumin-color-text)]"
          @change="onVisionChange"
        >
          <option v-for="option in VISION_OPTIONS" :key="option.value" :value="option.value">
            {{ option.label }}
          </option>
        </select>
        <NButton size="small" :disabled="vision === 'none'" @click="resetVision">还原</NButton>
      </div>

      <p v-if="vision === 'none'" class="text-xs text-[var(--lumin-color-text-secondary)]">
        选择一种色觉缺陷后，主色、配色方案与对比度将按模拟后的近似色显示；对比度徽标同步变化。
      </p>

      <div v-else class="flex flex-col gap-3">
        <div class="grid gap-3 sm:grid-cols-2">
          <div
            class="flex flex-col gap-2 rounded-[var(--lumin-radius-md)] border border-[var(--lumin-color-border)] p-3"
          >
            <span class="text-sm font-medium text-[var(--lumin-color-text)]">
              主色 · {{ visionLabel }}
            </span>
            <div class="flex gap-2">
              <span
                :class="swatchClass()"
                class="h-10 flex-1"
                :style="{ backgroundColor: hex }"
                title="原始颜色"
              />
              <span
                :class="swatchClass()"
                class="h-10 flex-1"
                :style="{ backgroundColor: rgbToHex(simulatedMain) }"
                title="模拟颜色"
              />
            </div>
            <p class="text-xs text-[var(--lumin-color-text-secondary)]">
              原 {{ hex }} → 模拟 {{ rgbToHex(simulatedMain) }}
            </p>
            <div class="grid gap-1 font-mono text-xs text-[var(--lumin-color-text)]">
              <span v-for="item in simulatedValues" :key="item.key">
                {{ item.label }} {{ item.value }}
              </span>
            </div>
          </div>

          <div
            v-for="(scheme, index) in simulatedSchemes"
            :key="scheme.id"
            class="flex flex-col gap-2 rounded-[var(--lumin-radius-md)] border border-[var(--lumin-color-border)] p-3"
          >
            <span class="text-sm font-medium text-[var(--lumin-color-text)]">
              {{ scheme.name }} · 模拟
            </span>
            <div class="flex gap-2">
              <span
                v-for="(color, colorIndex) in scheme.colors"
                :key="colorIndex"
                :class="swatchClass()"
                class="h-10 flex-1"
                :style="{ backgroundColor: rgbToHex(color) }"
                :title="rgbToHex(color)"
              />
            </div>
            <p class="text-xs text-[var(--lumin-color-text-secondary)]">
              原 {{ schemes[index]?.colors.map((color) => rgbToHex(color)).join(' · ') }}
            </p>
            <p class="text-xs text-[var(--lumin-color-text-secondary)]">
              模拟 {{ scheme.colors.map((color) => rgbToHex(color)).join(' · ') }}
            </p>
          </div>
        </div>
        <p class="text-xs text-[var(--lumin-color-text-secondary)]">
          以上为 {{ visionLabel }} 下的近似色值；点击任意色块设为主色时仍使用原始颜色。
        </p>
      </div>
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
              :title="`${rgbToHex(color)}${vision === 'none' ? '' : ` → ${rgbToHex(simulateOrOriginal(color))}`}`"
              :class="swatchClass()"
              class="h-10 flex-1"
              :style="{ backgroundColor: simulatedHex(color) }"
              @click="applyColor(color)"
            />
          </div>
          <p class="text-xs text-[var(--lumin-color-text-secondary)]">
            原 {{ scheme.colors.map((color) => rgbToHex(color)).join(' · ') }}
          </p>
          <p
            v-if="vision !== 'none'"
            class="text-xs text-[var(--lumin-color-text-secondary)]"
          >
            模拟 {{ scheme.colors.map((color) => simulatedHex(color)).join(' · ') }}
          </p>
        </div>
      </div>
    </section>

    <section
      class="flex flex-col gap-3 rounded-[var(--lumin-radius-md)] border border-[var(--lumin-color-border)] bg-[var(--lumin-color-surface)] p-4"
    >
      <div class="flex flex-wrap items-center gap-3">
        <h3 class="text-sm font-semibold text-[var(--lumin-color-text)]">对比度</h3>
        <span
          v-if="vision !== 'none'"
          class="text-xs text-[var(--lumin-color-text-secondary)]"
        >
          按{{ visionLabel }}模拟色计算
        </span>
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
        :style="{
          backgroundColor: rgbToHex(simulatedBackground),
          color: rgbToHex(simulatedMain)
        }"
      >
        <p class="text-sm">示例正文：Lumin 颜色工具箱</p>
        <p class="text-2xl font-semibold">大字示例 Sample</p>
      </div>
    </section>

    <div
      v-if="picker !== null"
      role="dialog"
      aria-modal="true"
      aria-label="屏幕取色"
      class="fixed inset-0 z-50 flex flex-col gap-3 bg-[var(--lumin-color-surface)] p-4"
    >
      <div class="flex flex-wrap items-center gap-3">
        <p class="text-sm text-[var(--lumin-color-text)]">点击图片任意位置取色，Esc 取消</p>
        <div v-if="picker.displays.length > 1" class="w-48">
          <NSelect
            :value="picker.displayId"
            :options="[...displayOptions]"
            :disabled="capturing"
            aria-label="选择显示器"
            @update:value="onDisplayChange"
          />
        </div>
        <NButton size="small" class="ml-auto" :disabled="capturing" @click="closePicker">
          取消
        </NButton>
      </div>

      <p v-if="pickerError !== null" role="alert" class="text-sm text-[var(--lumin-color-error)]">
        {{ pickerError.message }}
        <span class="ml-2 text-xs opacity-70">{{ pickerError.code }}</span>
      </p>

      <div class="flex min-h-0 flex-1 items-center justify-center">
        <img
          :src="picker.dataUrl"
          alt="屏幕截图，点击任意位置取色"
          draggable="false"
          class="max-h-full max-w-full cursor-crosshair select-none object-contain"
          @click="onPickerClick"
        />
      </div>
    </div>
  </div>
</template>
