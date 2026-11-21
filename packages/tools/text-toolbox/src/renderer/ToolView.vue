<script setup lang="ts">
// 文本工具箱主视图（M8，M36 增 Hex/Unicode 与文本处理）
// 作者：cuilanchao · 修改时间：2026-11-21
// 纯 renderer 四 Tab（JSON / 编解码 / 正则 / 文本处理），零 IPC；大文本先渲染 busy 再分帧计算（R4 加载态）
import { computed, ref, watch } from 'vue'
import { NButton, NCheckbox, NInput, NTabPane, NTabs, NTag, NText } from 'naive-ui'
import { Copy } from '@lucide/vue'
import type { StructuredError } from '@lumin/shared'
import { errorMessage, type TextResult } from '../errors'
import { formatJson, minifyJson, validateJson, type JsonResult } from '../json'
import {
  decodeBase64,
  decodeHex,
  decodeUnicode,
  decodeUrl,
  encodeBase64,
  encodeHex,
  encodeUnicode,
  encodeUrl
} from '../encoding'
import { decodeMorse, encodeMorse } from '../morse'
import { collectMatches, replacePreview, type RegexMatchInfo } from '../regex'
import { applyLineOps, replaceText, type CaseMode, type SortMode } from '../text-ops'
import { countText } from '../stats'

/** 超过该字节数先渲染「处理中」再分帧计算，避免输入后界面卡住无反馈 */
const HEAVY_BYTES = 200 * 1024

type CodecMode = 'base64' | 'url' | 'hex' | 'unicode'

const CODEC_ENCODERS: Record<CodecMode, (text: string) => TextResult<string>> = {
  base64: encodeBase64,
  url: encodeUrl,
  hex: encodeHex,
  unicode: encodeUnicode
}

const CODEC_DECODERS: Record<CodecMode, (text: string) => TextResult<string>> = {
  base64: decodeBase64,
  url: decodeUrl,
  hex: decodeHex,
  unicode: decodeUnicode
}

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
const codecMode = ref<CodecMode>('base64')
const codecInput = ref('')
const codecOutput = ref('')

// —— 摩尔斯 Tab ——
const morseInput = ref('')
const morseOutput = ref('')

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

// —— 文本处理 Tab ——
const textOpsInput = ref('')
const textOpsOutput = ref('')
const textOpsProcessed = ref(false)
const replaceFind = ref('')
const replaceWith = ref('')
const replaceRegex = ref(false)
const replaceCaseSensitive = ref(true)
const lineRemoveEmpty = ref(true)
const lineDedupe = ref(true)
const lineSort = ref<SortMode>('asc')
const lineCase = ref<CaseMode>('none')

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
      kind === 'encode'
        ? CODEC_ENCODERS[codecMode.value](input)
        : CODEC_DECODERS[codecMode.value](input)
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

/* ---------- 摩尔斯 Tab ---------- */

function runMorse(kind: 'encode' | 'decode'): void {
  clearFeedback()
  if (morseInput.value === '') {
    notice.value = '请先输入要处理的文本'
    return
  }
  runMaybeHeavy(morseInput.value, () => {
    const result = kind === 'encode' ? encodeMorse(morseInput.value) : decodeMorse(morseInput.value)
    if (!result.ok) {
      morseOutput.value = ''
      showError(result.error)
      return
    }
    morseOutput.value = result.value
    notice.value = `${kind === 'encode' ? '编码' : '解码'}完成 · ${byteLength(result.value)} 字节`
  })
}

function swapMorse(): void {
  if (morseOutput.value === '') return
  clearFeedback()
  morseInput.value = morseOutput.value
  morseOutput.value = ''
}

function fillMorseSample(): void {
  clearFeedback()
  morseInput.value = 'Lumin 2026'
  morseOutput.value = ''
}

/* ---------- 文本处理 Tab ---------- */

/** 统计对象：已处理则统计输出，否则统计输入 */
const textOpsStats = computed(() =>
  countText(textOpsProcessed.value ? textOpsOutput.value : textOpsInput.value)
)

const textOpsStatsRows = computed<{ label: string; value: number }[]>(() => {
  const stats = textOpsStats.value
  return [
    { label: '字符', value: stats.chars },
    { label: '不含空白', value: stats.charsNoSpaces },
    { label: '汉字', value: stats.chinese },
    { label: '字母', value: stats.letters },
    { label: '数字', value: stats.digits },
    { label: '词', value: stats.words },
    { label: '行', value: stats.lines },
    { label: '非空行', value: stats.nonEmptyLines },
    { label: 'UTF-8 字节', value: stats.bytes }
  ]
})

// 用户改动输入后，输出视为过期，统计回落到输入
watch(textOpsInput, () => {
  textOpsProcessed.value = false
})

function runReplace(): void {
  clearFeedback()
  if (textOpsInput.value === '') {
    notice.value = '请先输入要处理的文本'
    return
  }
  runMaybeHeavy(textOpsInput.value, () => {
    const result = replaceText(textOpsInput.value, replaceFind.value, replaceWith.value, {
      regex: replaceRegex.value,
      caseSensitive: replaceCaseSensitive.value
    })
    if (!result.ok) {
      textOpsOutput.value = ''
      textOpsProcessed.value = true
      showError(result.error)
      return
    }
    textOpsOutput.value = result.value
    textOpsProcessed.value = true
    notice.value = `替换完成 · ${byteLength(result.value)} 字节`
  })
}

function runLineOps(): void {
  clearFeedback()
  if (textOpsInput.value === '') {
    notice.value = '请先输入要处理的文本'
    return
  }
  runMaybeHeavy(textOpsInput.value, () => {
    const result = applyLineOps(textOpsInput.value, {
      removeEmpty: lineRemoveEmpty.value,
      dedupe: lineDedupe.value,
      sort: lineSort.value,
      caseMode: lineCase.value
    })
    textOpsOutput.value = result
    textOpsProcessed.value = true
    notice.value = `处理完成 · ${byteLength(result)} 字节`
  })
}

function resetTextOps(): void {
  clearFeedback()
  textOpsInput.value = ''
  textOpsOutput.value = ''
  textOpsProcessed.value = false
}

function fillTextOpsSample(): void {
  clearFeedback()
  textOpsInput.value = '  第三行  \n\n第二行\n第一行\n第二行\n'
  textOpsOutput.value = ''
  textOpsProcessed.value = false
  replaceFind.value = ''
  replaceWith.value = ''
  replaceRegex.value = false
  replaceCaseSensitive.value = true
  lineRemoveEmpty.value = true
  lineDedupe.value = true
  lineSort.value = 'asc'
  lineCase.value = 'none'
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
        JSON 格式化压缩、Base64/URL/Hex/Unicode
        编解码、正则测试、批量文本处理与字数统计、摩尔斯电码（本地处理，不联网）
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
      <NTabPane name="text-ops">
        <template #tab>文本处理</template>
      </NTabPane>
      <NTabPane name="morse">
        <template #tab>摩尔斯</template>
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
          <option value="hex">Hex（UTF-8 字节）</option>
          <option value="unicode">Unicode（\uXXXX）</option>
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

    <!-- 文本处理：批量替换 / 行去重 / 排序 / 清空行 / 大小写 + 字数统计 -->
    <div v-if="activeTab === 'text-ops'" class="flex flex-col gap-3">
      <div class="flex flex-wrap items-center gap-2 text-sm">
        <NText depth="2">查找</NText>
        <NInput v-model:value="replaceFind" placeholder="查找内容" class="min-w-40 flex-1" />
        <NText depth="2">替换为</NText>
        <NInput
          v-model:value="replaceWith"
          placeholder="替换内容（正则支持 $1）"
          class="min-w-40 flex-1"
        />
        <NCheckbox v-model:checked="replaceRegex">正则</NCheckbox>
        <NCheckbox v-model:checked="replaceCaseSensitive">区分大小写</NCheckbox>
        <NButton :disabled="busy" @click="runReplace">替换</NButton>
      </div>

      <div class="flex flex-wrap items-center gap-2 text-sm">
        <NText depth="2">行处理</NText>
        <NCheckbox v-model:checked="lineRemoveEmpty">清空空白行</NCheckbox>
        <NCheckbox v-model:checked="lineDedupe">去重</NCheckbox>
        <select
          v-model="lineSort"
          aria-label="行排序"
          class="rounded-[var(--lumin-radius-md)] border border-[var(--lumin-color-border, #e0e0e6)] px-2 py-1 text-sm"
        >
          <option value="none">不排序</option>
          <option value="asc">升序</option>
          <option value="desc">降序</option>
        </select>
        <select
          v-model="lineCase"
          aria-label="大小写转换"
          class="rounded-[var(--lumin-radius-md)] border border-[var(--lumin-color-border, #e0e0e6)] px-2 py-1 text-sm"
        >
          <option value="none">不改大小写</option>
          <option value="upper">全部大写</option>
          <option value="lower">全部小写</option>
          <option value="title">单词首字母大写</option>
        </select>
        <NButton type="primary" :disabled="busy" @click="runLineOps">处理行</NButton>
        <NButton size="tiny" quaternary @click="fillTextOpsSample">填入示例</NButton>
        <NButton size="tiny" quaternary @click="resetTextOps">清空</NButton>
      </div>

      <div class="grid gap-3 md:grid-cols-2">
        <div class="flex flex-col gap-2">
          <NText depth="2" class="text-sm">输入</NText>
          <NInput
            v-model:value="textOpsInput"
            type="textarea"
            placeholder="粘贴要处理的文本（每行一条）"
            :autosize="{ minRows: 8, maxRows: 16 }"
          />
        </div>
        <div class="flex flex-col gap-2">
          <div class="flex items-center justify-between">
            <NText depth="2" class="text-sm">输出</NText>
            <NButton size="tiny" quaternary @click="copyText(textOpsOutput, 'text-ops')">
              <Copy class="mr-1 h-3 w-3" />{{ copiedLabel === 'text-ops' ? '已复制' : '复制' }}
            </NButton>
          </div>
          <NInput
            :value="textOpsOutput"
            type="textarea"
            readonly
            placeholder="处理结果"
            :autosize="{ minRows: 8, maxRows: 16 }"
          />
        </div>
      </div>

      <div class="flex flex-wrap gap-2">
        <div
          v-for="row in textOpsStatsRows"
          :key="row.label"
          class="flex min-w-24 flex-col gap-0.5 rounded-[var(--lumin-radius-md)] border border-[var(--lumin-color-border, #e0e0e6)] px-3 py-1.5"
        >
          <NText depth="3" class="text-xs">{{ row.label }}</NText>
          <NText class="text-sm font-semibold tabular-nums">{{ row.value }}</NText>
        </div>
      </div>

      <NText depth="3" class="text-xs">
        统计对象：{{ textOpsProcessed ? '处理结果' : '输入文本' }}；行处理顺序为去空行 → 大小写 →
        去重 → 排序。
      </NText>
    </div>

    <!-- 摩尔斯：字母单空格、单词用「 / 」分隔 -->
    <div v-if="activeTab === 'morse'" class="flex flex-col gap-3">
      <div class="grid gap-3 md:grid-cols-2">
        <div class="flex flex-col gap-2">
          <div class="flex items-center justify-between">
            <NText depth="2" class="text-sm">输入</NText>
            <NButton size="tiny" quaternary @click="fillMorseSample">填入示例</NButton>
          </div>
          <NInput
            v-model:value="morseInput"
            type="textarea"
            placeholder="输入文本或摩尔斯码（字母空格分隔，单词用 / 分隔）"
            :autosize="{ minRows: 8, maxRows: 16 }"
          />
        </div>
        <div class="flex flex-col gap-2">
          <div class="flex items-center justify-between">
            <NText depth="2" class="text-sm">输出</NText>
            <NButton size="tiny" quaternary @click="copyText(morseOutput, 'morse')">
              <Copy class="mr-1 h-3 w-3" />{{ copiedLabel === 'morse' ? '已复制' : '复制' }}
            </NButton>
          </div>
          <NInput
            :value="morseOutput"
            type="textarea"
            readonly
            placeholder="处理结果"
            :autosize="{ minRows: 8, maxRows: 16 }"
          />
        </div>
      </div>
      <div class="flex items-center gap-2">
        <NButton type="primary" :disabled="busy" @click="runMorse('encode')">编码</NButton>
        <NButton :disabled="busy" @click="runMorse('decode')">解码</NButton>
        <NButton quaternary :disabled="busy || morseOutput === ''" @click="swapMorse">
          交换
        </NButton>
      </div>
      <NText depth="3" class="text-xs">
        支持 A–Z、0–9 与常用标点；编码不区分大小写，解码结果统一为大写。
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
