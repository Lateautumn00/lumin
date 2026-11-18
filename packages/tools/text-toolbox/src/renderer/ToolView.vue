<script setup lang="ts">
// 文本工具箱主视图（M8）
// 作者：cuilanchao · 修改时间：2026-11-18
// 纯 renderer 三 Tab（JSON / 编解码 / 正则），零 IPC；大文本先渲染 busy 再分帧计算（R4 加载态）
import { computed, ref, watch } from 'vue'
import { NButton, NCheckbox, NInput, NTabPane, NTabs, NTag, NText } from 'naive-ui'
import { Copy } from '@lucide/vue'
import type { StructuredError } from '@lumin/shared'
import { errorMessage } from '../errors'
import { formatJson, minifyJson, validateJson, type JsonResult } from '../json'
import { decodeBase64, decodeUrl, encodeBase64, encodeUrl } from '../encoding'
import { collectMatches, replacePreview, type RegexMatchInfo } from '../regex'

/** 超过该字节数先渲染「处理中」再分帧计算，避免输入后界面卡住无反馈 */
const HEAVY_BYTES = 200 * 1024

const activeTab = ref('json')
const busy = ref(false)
const error = ref<StructuredError | null>(null)
const errorDetail = ref('')
const notice = ref('')
const copiedLabel = ref('')

// —— JSON Tab ——
const jsonInput = ref('')
const jsonOutput = ref('')
const jsonIndent = ref<2 | 4>(2)

// —— 编解码 Tab ——
const codecMode = ref<'base64' | 'url'>('base64')
const codecInput = ref('')
const codecOutput = ref('')

// —— 正则 Tab ——
const regexPattern = ref('')
const regexFlags = ref({ g: true, i: false, m: false, s: false, u: false })
const regexText = ref('')
const regexReplacement = ref('')
const regexMatches = ref<RegexMatchInfo[]>([])
const regexTotal = ref(0)
const regexTruncated = ref(false)
const regexReplaceResult = ref('')
const regexReplaceCount = ref(0)

/** 当前勾选的 flags（按固定顺序拼接，保证可预期） */
const flagsString = computed(() => {
  const entries = Object.entries(regexFlags.value)
  return entries
    .filter(([, enabled]) => enabled)
    .map(([flag]) => flag)
    .join('')
})

/** UTF-8 字节数（展示用） */
function byteLength(text: string): number {
  return new TextEncoder().encode(text).length
}

function clearFeedback(): void {
  error.value = null
  errorDetail.value = ''
  notice.value = ''
}

watch(activeTab, clearFeedback)

/**
 * 大文本分帧执行：先显示 busy，再在下一帧执行同步计算
 * @param text 参与计算的文本（用于判断体积）
 * @param task 同步计算
 */
function runMaybeHeavy(text: string, task: () => void): void {
  if (byteLength(text) <= HEAVY_BYTES) {
    task()
    return
  }
  busy.value = true
  window.setTimeout(() => {
    try {
      task()
    } finally {
      busy.value = false
    }
  }, 0)
}

function showError(err: StructuredError): void {
  error.value = err
  errorDetail.value = err.detail ?? ''
  notice.value = ''
}

/**
 * 复制到剪贴板（渲染层原生能力，不走 IPC）
 * @param text 待复制文本
 * @param label 按钮语义（用于短暂回显）
 */
async function copyText(text: string, label: string): Promise<void> {
  if (text === '') return
  try {
    await navigator.clipboard.writeText(text)
    copiedLabel.value = label
    window.setTimeout(() => {
      if (copiedLabel.value === label) copiedLabel.value = ''
    }, 1200)
  } catch {
    showError({ code: 'TT_CLIPBOARD_FAILED', message: '复制失败，请手动选择文本复制' })
  }
}

/** JSON 格式化/压缩的统一落地（成功写输出 + 统计，失败写错误） */
function applyJsonResult(result: JsonResult<string>): void {
  if (!result.ok) {
    jsonOutput.value = ''
    showError(result.error)
    return
  }
  jsonOutput.value = result.value
  notice.value = `输入 ${byteLength(jsonInput.value)} 字节 → 输出 ${byteLength(result.value)} 字节`
}

function runJson(kind: 'format' | 'minify' | 'validate'): void {
  clearFeedback()
  if (jsonInput.value.trim() === '') {
    notice.value = '请先输入 JSON 文本'
    return
  }
  runMaybeHeavy(jsonInput.value, () => {
    if (kind === 'validate') {
      const result = validateJson(jsonInput.value)
      if (!result.ok) {
        showError(result.error)
        return
      }
      jsonOutput.value = ''
      notice.value = `JSON 合法 · ${result.value.bytes} 字节`
      return
    }
    applyJsonResult(
      kind === 'format'
        ? formatJson(jsonInput.value, jsonIndent.value)
        : minifyJson(jsonInput.value)
    )
  })
}

function fillJsonSample(): void {
  clearFeedback()
  jsonInput.value = '{"name":"Lumin","tags":["工具","离线"],"version":1}'
  jsonOutput.value = ''
}

/** 缩进选择（原生 select 的字符串值收敛为 2 | 4） */
function onIndentChange(event: Event): void {
  const value = Number((event.target as HTMLSelectElement).value)
  jsonIndent.value = value === 4 ? 4 : 2
}

function runCodec(kind: 'encode' | 'decode'): void {
  clearFeedback()
  if (codecInput.value === '') {
    notice.value = '请先输入要处理的文本'
    return
  }
  runMaybeHeavy(codecInput.value, () => {
    const input = codecInput.value
    const result =
      codecMode.value === 'base64'
        ? kind === 'encode'
          ? encodeBase64(input)
          : decodeBase64(input)
        : kind === 'encode'
          ? encodeUrl(input)
          : decodeUrl(input)
    if (!result.ok) {
      codecOutput.value = ''
      showError(result.error)
      return
    }
    codecOutput.value = result.value
    notice.value = `${kind === 'encode' ? '编码' : '解码'}完成 · ${byteLength(result.value)} 字节`
  })
}

function swapCodec(): void {
  if (codecOutput.value === '') return
  clearFeedback()
  codecInput.value = codecOutput.value
  codecOutput.value = ''
}

function fillCodecSample(): void {
  clearFeedback()
  codecInput.value = '你好 Lumin · text-toolbox'
  codecOutput.value = ''
}

function runRegex(kind: 'match' | 'replace'): void {
  clearFeedback()
  if (regexPattern.value === '') {
    notice.value = '请输入正则表达式'
    return
  }
  runMaybeHeavy(regexText.value, () => {
    if (kind === 'match') {
      const result = collectMatches(regexPattern.value, flagsString.value, regexText.value)
      if (!result.ok) {
        regexMatches.value = []
        regexTotal.value = 0
        regexTruncated.value = false
        showError(result.error)
        return
      }
      regexMatches.value = result.value.matches
      regexTotal.value = result.value.total
      regexTruncated.value = result.value.truncated
      notice.value =
        result.value.total === 0
          ? `未匹配到内容（flags: ${flagsString.value || '无'}）`
          : `匹配 ${result.value.total} 处（flags: ${flagsString.value || '无'}）`
      return
    }
    const result = replacePreview(
      regexPattern.value,
      flagsString.value,
      regexText.value,
      regexReplacement.value
    )
    if (!result.ok) {
      regexReplaceResult.value = ''
      showError(result.error)
      return
    }
    regexReplaceResult.value = result.value.result
    regexReplaceCount.value = result.value.count
    notice.value = `替换 ${result.value.count} 处${result.value.truncated ? '（已达扫描上限）' : ''}`
  })
}

function fillRegexSample(): void {
  clearFeedback()
  regexPattern.value = '(\\d+)'
  regexFlags.value = { g: true, i: false, m: false, s: false, u: false }
  regexText.value = '订单 A-1024，订单 B-2048'
  regexReplacement.value = '<$1>'
  regexMatches.value = []
  regexReplaceResult.value = ''
  regexReplaceCount.value = 0
}

/** 错误码 → 中文（TT_CLIPBOARD_FAILED 等壳外码回退原文案） */
function messageOf(code: string): string {
  return code === 'TT_CLIPBOARD_FAILED' ? '复制失败，请手动选择文本复制' : errorMessage(code)
}
</script>

<template>
  <div class="flex max-w-4xl flex-col gap-4">
    <div>
      <h1 class="text-base font-semibold">文本工具箱</h1>
      <p class="mt-1 text-sm text-[var(--lumin-color-text-secondary)]">
        JSON 格式化压缩、Base64/URL 编解码、正则测试与替换预览（本地处理，不联网）
      </p>
    </div>

    <!-- 页签仅作切换器（与 image-toolbox 同范式），内容用 v-if 渲染，避免 pane 内容不随切换更新 -->
    <!-- 标签必须走 #tab 插槽：当前 naive-ui 构建下自闭合 pane 的 tab 文本不会渲染 -->
    <NTabs v-model:value="activeTab" type="line">
      <NTabPane name="json">
        <template #tab>JSON</template>
      </NTabPane>
      <NTabPane name="codec">
        <template #tab>编解码</template>
      </NTabPane>
      <NTabPane name="regex">
        <template #tab>正则</template>
      </NTabPane>
    </NTabs>

    <!-- JSON -->
    <div v-if="activeTab === 'json'" class="flex flex-col gap-3">
      <div class="flex items-center gap-2 text-sm">
        <NText depth="2">缩进</NText>
        <select
          :value="jsonIndent"
          class="rounded-[var(--lumin-radius-md)] border border-[var(--lumin-color-border, #e0e0e6)] px-2 py-1 text-sm"
          @change="onIndentChange"
        >
          <option :value="2">2 空格</option>
          <option :value="4">4 空格</option>
        </select>
      </div>
      <div class="grid gap-3 md:grid-cols-2">
        <div class="flex flex-col gap-2">
          <div class="flex items-center justify-between">
            <NText depth="2" class="text-sm">输入</NText>
            <NButton size="tiny" quaternary @click="fillJsonSample">填入示例</NButton>
          </div>
          <NInput
            v-model:value="jsonInput"
            type="textarea"
            placeholder="粘贴 JSON 文本"
            :autosize="{ minRows: 8, maxRows: 16 }"
          />
        </div>
        <div class="flex flex-col gap-2">
          <div class="flex items-center justify-between">
            <NText depth="2" class="text-sm">输出</NText>
            <NButton size="tiny" quaternary @click="copyText(jsonOutput, 'json')">
              <Copy class="mr-1 h-3 w-3" />{{ copiedLabel === 'json' ? '已复制' : '复制' }}
            </NButton>
          </div>
          <NInput
            :value="jsonOutput"
            type="textarea"
            readonly
            placeholder="格式化结果"
            :autosize="{ minRows: 8, maxRows: 16 }"
          />
        </div>
      </div>
      <div class="flex items-center gap-2">
        <NButton type="primary" :disabled="busy" @click="runJson('format')">格式化</NButton>
        <NButton :disabled="busy" @click="runJson('minify')">压缩</NButton>
        <NButton :disabled="busy" @click="runJson('validate')">校验</NButton>
      </div>
    </div>

    <!-- 编解码 -->
    <div v-if="activeTab === 'codec'" class="flex flex-col gap-3">
      <div class="flex items-center gap-2 text-sm">
        <NText depth="2">模式</NText>
        <select
          v-model="codecMode"
          class="rounded-[var(--lumin-radius-md)] border border-[var(--lumin-color-border, #e0e0e6)] px-2 py-1 text-sm"
        >
          <option value="base64">Base64（UTF-8）</option>
          <option value="url">URL Component</option>
        </select>
      </div>
      <div class="grid gap-3 md:grid-cols-2">
        <div class="flex flex-col gap-2">
          <div class="flex items-center justify-between">
            <NText depth="2" class="text-sm">输入</NText>
            <NButton size="tiny" quaternary @click="fillCodecSample">填入示例</NButton>
          </div>
          <NInput
            v-model:value="codecInput"
            type="textarea"
            placeholder="粘贴要编码或解码的文本"
            :autosize="{ minRows: 8, maxRows: 16 }"
          />
        </div>
        <div class="flex flex-col gap-2">
          <div class="flex items-center justify-between">
            <NText depth="2" class="text-sm">输出</NText>
            <NButton size="tiny" quaternary @click="copyText(codecOutput, 'codec')">
              <Copy class="mr-1 h-3 w-3" />{{ copiedLabel === 'codec' ? '已复制' : '复制' }}
            </NButton>
          </div>
          <NInput
            :value="codecOutput"
            type="textarea"
            readonly
            placeholder="处理结果"
            :autosize="{ minRows: 8, maxRows: 16 }"
          />
        </div>
      </div>
      <div class="flex items-center gap-2">
        <NButton type="primary" :disabled="busy" @click="runCodec('encode')">编码</NButton>
        <NButton :disabled="busy" @click="runCodec('decode')">解码</NButton>
        <NButton quaternary :disabled="busy || codecOutput === ''" @click="swapCodec">
          交换
        </NButton>
      </div>
    </div>

    <!-- 正则 -->
    <div v-if="activeTab === 'regex'" class="flex flex-col gap-3">
      <div class="flex flex-wrap items-center gap-2 text-sm">
        <NText depth="2">模式</NText>
        <NInput v-model:value="regexPattern" placeholder="如 (\d+)" class="min-w-64 flex-1" />
        <NCheckbox v-model:checked="regexFlags.g">g</NCheckbox>
        <NCheckbox v-model:checked="regexFlags.i">i</NCheckbox>
        <NCheckbox v-model:checked="regexFlags.m">m</NCheckbox>
        <NCheckbox v-model:checked="regexFlags.s">s</NCheckbox>
        <NCheckbox v-model:checked="regexFlags.u">u</NCheckbox>
        <NButton size="tiny" quaternary @click="fillRegexSample">填入示例</NButton>
      </div>
      <NInput
        v-model:value="regexText"
        type="textarea"
        placeholder="测试文本"
        :autosize="{ minRows: 5, maxRows: 12 }"
      />
      <div class="flex flex-wrap items-center gap-2">
        <NButton type="primary" :disabled="busy" @click="runRegex('match')">测试匹配</NButton>
        <NInput
          v-model:value="regexReplacement"
          placeholder="替换为（支持 $1–$9 / $&）"
          class="min-w-56 flex-1"
        />
        <NButton :disabled="busy" @click="runRegex('replace')">替换预览</NButton>
      </div>

      <div v-if="regexMatches.length > 0" class="flex flex-col gap-1">
        <div class="flex items-center gap-2">
          <NText depth="2" class="text-sm font-medium">
            匹配 {{ regexTotal }} 处<template v-if="regexTruncated">（仅展示前 500 条）</template>
          </NText>
          <NButton
            size="tiny"
            quaternary
            @click="copyText(JSON.stringify(regexMatches, null, 2), 'regex')"
          >
            <Copy class="mr-1 h-3 w-3" />{{ copiedLabel === 'regex' ? '已复制' : '复制结果' }}
          </NButton>
        </div>
        <div class="flex max-h-64 flex-col gap-1 overflow-y-auto">
          <div
            v-for="(match, order) in regexMatches"
            :key="`${match.index}-${order}`"
            class="flex items-center gap-2 rounded-[var(--lumin-radius-md)] border border-[var(--lumin-color-border, #e0e0e6)] px-2 py-1 text-xs"
          >
            <NTag size="tiny" :bordered="false">#{{ order + 1 }}</NTag>
            <NText depth="3">index {{ match.index }}</NText>
            <NText class="truncate">{{ match.value }}</NText>
            <NText v-if="match.groups.length > 0" depth="3" class="truncate">
              · 分组 [{{ match.groups.join(', ') }}]
            </NText>
          </div>
        </div>
      </div>

      <div v-if="regexReplaceResult !== ''" class="flex flex-col gap-2">
        <div class="flex items-center justify-between">
          <NText depth="2" class="text-sm font-medium"
            >替换结果（{{ regexReplaceCount }} 处）</NText
          >
          <NButton size="tiny" quaternary @click="copyText(regexReplaceResult, 'replace')">
            <Copy class="mr-1 h-3 w-3" />{{ copiedLabel === 'replace' ? '已复制' : '复制' }}
          </NButton>
        </div>
        <NInput
          :value="regexReplaceResult"
          type="textarea"
          readonly
          :autosize="{ minRows: 5, maxRows: 12 }"
        />
      </div>

      <NText
        v-if="
          regexText === '' &&
          regexMatches.length === 0 &&
          regexReplaceResult === '' &&
          error === null
        "
        depth="3"
        class="text-sm"
      >
        输入模式与测试文本后点击「测试匹配」；替换支持 $1–$9 与 $&
      </NText>
    </div>

    <!-- 加载态（大文本分帧） -->
    <NText v-if="busy" depth="3" class="text-sm">处理中…</NText>

    <!-- 成功提示 -->
    <NText v-if="notice !== ''" depth="2" class="text-sm">{{ notice }}</NText>

    <!-- 报错态：结构化错误码 → 中文文案 + 可展开详情 -->
    <div v-if="error !== null" class="flex flex-col gap-1">
      <NText type="error" class="text-sm">
        {{ messageOf(error.code)
        }}<template v-if="error.detail !== undefined"> （{{ error.detail }}）</template>
      </NText>
      <details v-if="errorDetail !== ''">
        <summary class="cursor-pointer text-xs text-[var(--lumin-color-text-secondary)]">
          详情
        </summary>
        <NText depth="3" class="block break-all text-xs">{{ errorDetail }}</NText>
      </details>
    </div>
  </div>
</template>
