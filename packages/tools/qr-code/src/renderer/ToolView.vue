<script setup lang="ts">
// 二维码工具主视图（M16：生成 / 识别两 Tab）
// 作者：cuilanchao · 修改时间：2026-11-19
// 三态强制（空态引导/加载/报错）、tokens、@lucide/vue（spec §3）
import { computed, onMounted, onUnmounted, reactive, ref, watch } from 'vue'
import {
  NAlert,
  NButton,
  NInput,
  NInputNumber,
  NRadioButton,
  NRadioGroup,
  NSelect,
  NSpace,
  NSwitch,
  NTabPane,
  NTabs,
  NText
} from 'naive-ui'
import { Copy, FolderOpen, RefreshCw, Save } from '@lucide/vue'
import { toStructuredError, type StructuredError } from '@lumin/shared'
import DropZone from '@lumin/ui/DropZone.vue'
import { buildQrContent } from '../payload'
import { isRetryable } from '../errors'
import {
  COLOR_RE,
  type ErrorCorrection,
  type QrContent,
  type QrFormat,
  type QrStyle,
  type VCardInput,
  type WifiInput
} from '../schema'
import { config, revealPath, saveOutputDir, saveQr } from './client'
import { dataUrlToBase64, toPngDataUrl, toSvg } from './generate'
import { decodeImageFile } from './decode'

/** Tab 标识 */
type TabId = 'generate' | 'decode'

/** 内容类型 */
type ContentType = 'text' | 'url' | 'wifi' | 'vcard'

/** 纠错级别选项 */
const ERROR_OPTIONS: Array<{ label: string; value: ErrorCorrection }> = [
  { label: 'L（约 7%）', value: 'L' },
  { label: 'M（约 15%）', value: 'M' },
  { label: 'Q（约 25%）', value: 'Q' },
  { label: 'H（约 30%）', value: 'H' }
]

/** 识别图片 accept 串（与 spec §3.2 一致） */
const IMAGE_ACCEPT = '.png,.jpg,.jpeg,.webp,.bmp,.gif'

const tab = ref<TabId>('generate')

// —— 生成：内容 ——
const contentType = ref<ContentType>('text')
const textValue = ref('')
const urlValue = ref('')
const wifi = reactive<WifiInput>({ ssid: '', password: '', encryption: 'WPA', hidden: false })
const vcard = reactive<Required<VCardInput>>({
  name: '',
  org: '',
  title: '',
  phone: '',
  email: '',
  url: '',
  address: ''
})

// —— 生成：样式与保存 ——
const errorCorrection = ref<ErrorCorrection>('M')
const qrSize = ref<number | null>(512)
const qrMargin = ref<number | null>(4)
const foreground = ref('#000000')
const background = ref('#ffffff')
const format = ref<QrFormat>('png')
const baseName = ref('qrcode')
const outputDir = ref('')
const previewUrl = ref('')
const previewError = ref('')
const saving = ref(false)
const savedPath = ref('')
const generateError = ref<StructuredError | null>(null)

// —— 识别 ——
const decoding = ref(false)
const decodeError = ref<StructuredError | null>(null)
const decoded = ref<{ text: string; name: string; width: number; height: number } | null>(null)
const pendingFile = ref<File | null>(null)
const copyHint = ref('')
const invalidHint = ref('')

/** 当前内容（未校验，交给 buildQrContent 判定） */
function currentContent(): QrContent {
  if (contentType.value === 'text') return { type: 'text', value: textValue.value }
  if (contentType.value === 'url') return { type: 'url', value: urlValue.value }
  if (contentType.value === 'wifi') return { type: 'wifi', wifi: { ...wifi } }
  return { type: 'vcard', vcard: { ...vcard } }
}

/** 用户是否已输入必填内容（空表单不显示红色校验） */
const hasInput = computed(() => {
  if (contentType.value === 'text') return textValue.value.trim() !== ''
  if (contentType.value === 'url') return urlValue.value.trim() !== ''
  if (contentType.value === 'wifi') return wifi.ssid.trim() !== ''
  return vcard.name.trim() !== ''
})

/** 内容校验错误（仅 hasInput 时展示） */
const contentError = computed<StructuredError | null>(() => {
  try {
    buildQrContent(currentContent())
    return null
  } catch (err) {
    return toStructuredError(err)
  }
})

/** 样式是否合法（颜色 #RRGGBB） */
const styleValid = computed(
  () => COLOR_RE.test(foreground.value) && COLOR_RE.test(background.value)
)

/** 可保存：内容合法 + 样式合法 + 目录已就绪 */
const canSave = computed(
  () =>
    hasInput.value &&
    contentError.value === null &&
    styleValid.value &&
    outputDir.value.trim() !== '' &&
    !saving.value
)

/** 表单签名：任一字段变化触发防抖预览 */
const signature = computed(() =>
  JSON.stringify({
    contentType: contentType.value,
    textValue: textValue.value,
    urlValue: urlValue.value,
    wifi,
    vcard,
    errorCorrection: errorCorrection.value,
    qrSize: qrSize.value,
    qrMargin: qrMargin.value,
    foreground: foreground.value,
    background: background.value
  })
)

/** 当前样式（数值空值回落默认，主进程 zod 兜底） */
function currentStyle(): QrStyle {
  return {
    errorCorrection: errorCorrection.value,
    size: qrSize.value ?? 512,
    margin: qrMargin.value ?? 4,
    foreground: foreground.value,
    background: background.value
  }
}

let previewTimer: number | undefined

/** 防抖 300ms 刷新预览（spec §3.1） */
function schedulePreview(): void {
  if (previewTimer !== undefined) window.clearTimeout(previewTimer)
  previewTimer = window.setTimeout(() => {
    void refreshPreview()
  }, 300)
}

/** 生成 PNG 预览（内容非法时清空并保留占位） */
async function refreshPreview(): Promise<void> {
  previewError.value = ''
  if (!hasInput.value || contentError.value !== null) {
    previewUrl.value = ''
    return
  }
  try {
    previewUrl.value = await toPngDataUrl(buildQrContent(currentContent()), currentStyle())
  } catch (err) {
    previewUrl.value = ''
    previewError.value = toStructuredError(err).message
  }
}

watch(signature, schedulePreview, { immediate: true })

/** 保存到输出目录（PNG base64 / SVG 文本） */
async function save(): Promise<void> {
  if (!canSave.value) return
  generateError.value = null
  savedPath.value = ''
  saving.value = true
  try {
    const style = currentStyle()
    const text = buildQrContent(currentContent())
    const data =
      format.value === 'png'
        ? dataUrlToBase64(await toPngDataUrl(text, style))
        : await toSvg(text, style)
    const result = await saveQr({
      outputDir: outputDir.value.trim(),
      baseName: baseName.value,
      format: format.value,
      data
    })
    savedPath.value = result.output
  } catch (err) {
    generateError.value = toStructuredError(err)
  } finally {
    saving.value = false
  }
}

/** 系统目录选择：选中回填并记忆，取消保持原值 */
async function chooseDir(): Promise<void> {
  try {
    const dir = await window.lumin.pickDirectory('选择输出目录')
    if (dir === null) return
    outputDir.value = dir
    await saveOutputDir(dir)
  } catch (err) {
    generateError.value = toStructuredError(err)
  }
}

/** DropZone 选择图片 → 识别 */
async function onSelect(payload: { file: File; path: string }): Promise<void> {
  pendingFile.value = payload.file
  await decodeFile(payload.file)
}

/** 识别单个文件（失败保留 File 供重试） */
async function decodeFile(file: File): Promise<void> {
  decoding.value = true
  decodeError.value = null
  decoded.value = null
  try {
    const result = await decodeImageFile(file)
    decoded.value = { ...result, name: file.name }
  } catch (err) {
    decodeError.value = toStructuredError(err)
  } finally {
    decoding.value = false
  }
}

/** 重试：对同一文件重新解码 */
function retryDecode(): void {
  const file = pendingFile.value
  if (file !== null) void decodeFile(file)
}

/** DropZone 拒绝非图片文件时的行内提示 */
function onInvalid(reason: string): void {
  invalidHint.value = reason
  window.setTimeout(() => {
    invalidHint.value = ''
  }, 3000)
}

/** 复制识别结果（clipboard 不可用时回退 execCommand） */
async function copyDecoded(): Promise<void> {
  const text = decoded.value?.text ?? ''
  if (text === '') return
  try {
    await navigator.clipboard.writeText(text)
    copyHint.value = '已复制'
  } catch {
    const area = document.createElement('textarea')
    area.value = text
    document.body.appendChild(area)
    area.select()
    const ok = document.execCommand('copy')
    area.remove()
    copyHint.value = ok ? '已复制' : '复制失败，请手动选择文本复制'
  }
  window.setTimeout(() => {
    copyHint.value = ''
  }, 2000)
}

/** 打开保存产物所在文件夹 */
function revealSaved(): void {
  if (savedPath.value !== '') void revealPath(savedPath.value)
}

onMounted(() => {
  void config()
    .then((result) => {
      outputDir.value = result.outputDir
    })
    .catch((err) => {
      generateError.value = toStructuredError(err)
    })
})

onUnmounted(() => {
  if (previewTimer !== undefined) window.clearTimeout(previewTimer)
})
</script>

<template>
  <div class="flex max-w-3xl flex-col gap-4">
    <div>
      <h1 class="text-base font-semibold">二维码工具</h1>
      <p class="mt-1 text-sm text-[var(--lumin-color-text-secondary)]">
        离线生成二维码，或从图片中识别内容
      </p>
    </div>

    <!-- 标签必须走 #tab 插槽：当前 naive-ui 构建下自闭合 pane 的 tab 文本不会渲染 -->
    <NTabs v-model:value="tab" type="line">
      <NTabPane name="generate">
        <template #tab>生成</template>
      </NTabPane>
      <NTabPane name="decode">
        <template #tab>识别</template>
      </NTabPane>
    </NTabs>

    <!-- —— 生成 —— -->
    <div v-if="tab === 'generate'" class="flex flex-col gap-4">
      <section class="flex flex-col gap-3 rounded-[var(--lumin-radius-lg)] border border-[var(--lumin-color-border)] p-4">
        <NRadioGroup v-model:value="contentType">
          <NSpace>
            <NRadioButton value="text">文本</NRadioButton>
            <NRadioButton value="url">网址</NRadioButton>
            <NRadioButton value="wifi">WiFi</NRadioButton>
            <NRadioButton value="vcard">名片</NRadioButton>
          </NSpace>
        </NRadioGroup>

        <NInput
          v-if="contentType === 'text'"
          v-model:value="textValue"
          type="textarea"
          :autosize="{ minRows: 3, maxRows: 6 }"
          placeholder="输入要生成二维码的文本（最多 2000 字）"
        />
        <NInput
          v-else-if="contentType === 'url'"
          v-model:value="urlValue"
          placeholder="https://example.com"
        />
        <div v-else-if="contentType === 'wifi'" class="flex flex-col gap-2">
          <NInput v-model:value="wifi.ssid" placeholder="WiFi 名称（SSID）" />
          <NInput
            v-model:value="wifi.password"
            type="password"
            show-password-on="click"
            :disabled="wifi.encryption === 'nopass'"
            placeholder="密码（无密码时无需填写）"
          />
          <div class="flex items-center gap-4">
            <NSelect
              v-model:value="wifi.encryption"
              class="w-40"
              :options="[
                { label: 'WPA/WPA2', value: 'WPA' },
                { label: 'WEP', value: 'WEP' },
                { label: '无密码', value: 'nopass' }
              ]"
            />
            <div class="flex items-center gap-2 text-sm">
              <NSwitch v-model:value="wifi.hidden" />
              <span>隐藏网络</span>
            </div>
          </div>
        </div>
        <div v-else class="flex flex-col gap-2">
          <NInput v-model:value="vcard.name" placeholder="姓名（必填）" />
          <div class="flex gap-2">
            <NInput v-model:value="vcard.org" placeholder="公司" />
            <NInput v-model:value="vcard.title" placeholder="职位" />
          </div>
          <div class="flex gap-2">
            <NInput v-model:value="vcard.phone" placeholder="电话" />
            <NInput v-model:value="vcard.email" placeholder="邮箱" />
          </div>
          <NInput v-model:value="vcard.url" placeholder="网址（http:// 或 https://）" />
          <NInput v-model:value="vcard.address" placeholder="地址" />
        </div>

        <p v-if="hasInput && contentError !== null" class="text-sm text-[var(--lumin-color-danger)]">
          {{ contentError.message }}
        </p>
      </section>

      <section class="grid grid-cols-2 gap-x-6 gap-y-3 rounded-[var(--lumin-radius-lg)] border border-[var(--lumin-color-border)] p-4">
        <div class="flex flex-col gap-1">
          <span class="text-xs text-[var(--lumin-color-text-secondary)]">纠错级别</span>
          <NSelect v-model:value="errorCorrection" :options="ERROR_OPTIONS" />
        </div>
        <div class="flex flex-col gap-1">
          <span class="text-xs text-[var(--lumin-color-text-secondary)]">导出格式</span>
          <NRadioGroup v-model:value="format">
            <NSpace>
              <NRadioButton value="png">PNG</NRadioButton>
              <NRadioButton value="svg">SVG</NRadioButton>
            </NSpace>
          </NRadioGroup>
        </div>
        <div class="flex flex-col gap-1">
          <span class="text-xs text-[var(--lumin-color-text-secondary)]">尺寸（px）</span>
          <NInputNumber v-model:value="qrSize" :min="128" :max="2048" :step="32" />
        </div>
        <div class="flex flex-col gap-1">
          <span class="text-xs text-[var(--lumin-color-text-secondary)]">边距（模块）</span>
          <NInputNumber v-model:value="qrMargin" :min="0" :max="10" />
        </div>
        <div class="flex flex-col gap-1">
          <span class="text-xs text-[var(--lumin-color-text-secondary)]">前景色</span>
          <NInput v-model:value="foreground" placeholder="#000000" />
        </div>
        <div class="flex flex-col gap-1">
          <span class="text-xs text-[var(--lumin-color-text-secondary)]">背景色</span>
          <NInput v-model:value="background" placeholder="#ffffff" />
        </div>
        <p v-if="!styleValid" class="col-span-2 text-sm text-[var(--lumin-color-danger)]">
          颜色须为 #RRGGBB 格式
        </p>
      </section>

      <section class="flex gap-4 rounded-[var(--lumin-radius-lg)] border border-[var(--lumin-color-border)] p-4">
        <div class="flex h-56 w-56 shrink-0 items-center justify-center rounded-[var(--lumin-radius-md)] border border-dashed border-[var(--lumin-color-border)]">
          <img
            v-if="previewUrl !== ''"
            :src="previewUrl"
            alt="二维码预览"
            class="h-52 w-52"
          />
          <p v-else class="px-4 text-center text-sm text-[var(--lumin-color-text-secondary)]">
            {{ previewError !== '' ? previewError : '输入内容后自动预览' }}
          </p>
        </div>
        <div class="flex flex-1 flex-col gap-2">
          <div class="flex flex-col gap-1">
            <span class="text-xs text-[var(--lumin-color-text-secondary)]">文件名</span>
            <NInput v-model:value="baseName" placeholder="qrcode" />
          </div>
          <div class="flex flex-col gap-1">
            <span class="text-xs text-[var(--lumin-color-text-secondary)]">输出目录</span>
            <div class="flex items-center gap-2">
              <NText depth="3" class="flex-1 break-all text-xs">
                {{ outputDir === '' ? '加载中…' : outputDir }}
              </NText>
              <NButton size="small" @click="chooseDir">选择目录</NButton>
            </div>
          </div>
          <NButton type="primary" :loading="saving" :disabled="!canSave" @click="save">
            <template #icon><Save :size="16" /></template>
            保存到文件
          </NButton>
          <div v-if="savedPath !== ''" class="flex items-center gap-2">
            <NText class="flex-1 break-all text-xs">{{ savedPath }}</NText>
            <NButton size="small" @click="revealSaved">
              <template #icon><FolderOpen :size="14" /></template>
              打开所在文件夹
            </NButton>
          </div>
        </div>
      </section>

      <NAlert v-if="generateError !== null" type="error" :title="generateError.message">
        <p class="text-xs opacity-70">{{ generateError.code }}</p>
        <p v-if="generateError.detail" class="break-all text-xs opacity-70">
          {{ generateError.detail }}
        </p>
        <NButton
          v-if="isRetryable(generateError.code)"
          size="small"
          class="mt-2"
          @click="save"
        >
          重试
        </NButton>
      </NAlert>
    </div>

    <!-- —— 识别 —— -->
    <div v-else class="flex flex-col gap-4">
      <DropZone :accept="IMAGE_ACCEPT" hint="拖拽或选择一张包含二维码的图片" @select="onSelect" @invalid="onInvalid" />
      <p v-if="invalidHint !== ''" class="text-sm text-[var(--lumin-color-danger)]">
        {{ invalidHint }}
      </p>

      <div v-if="decoding" class="flex items-center gap-2 text-sm text-[var(--lumin-color-text-secondary)]">
        <RefreshCw :size="16" class="animate-spin" />
        识别中…
      </div>

      <section v-if="decoded !== null" class="flex flex-col gap-2 rounded-[var(--lumin-radius-lg)] border border-[var(--lumin-color-border)] p-4">
        <div class="flex items-center justify-between">
          <NText depth="3" class="text-xs">
            {{ decoded.name }} · {{ decoded.width }}×{{ decoded.height }}
          </NText>
          <div class="flex items-center gap-2">
            <NText v-if="copyHint !== ''" depth="3" class="text-xs">{{ copyHint }}</NText>
            <NButton size="small" @click="copyDecoded">
              <template #icon><Copy :size="14" /></template>
              复制
            </NButton>
          </div>
        </div>
        <NInput :value="decoded.text" type="textarea" :autosize="{ minRows: 3, maxRows: 8 }" readonly />
      </section>

      <NAlert v-if="decodeError !== null" type="error" :title="decodeError.message">
        <p class="text-xs opacity-70">{{ decodeError.code }}</p>
        <p v-if="decodeError.detail" class="break-all text-xs opacity-70">
          {{ decodeError.detail }}
        </p>
        <NButton v-if="pendingFile !== null" size="small" class="mt-2" @click="retryDecode">
          重试
        </NButton>
      </NAlert>
    </div>
  </div>
</template>
