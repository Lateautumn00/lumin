<script setup lang="ts">
// 文本工具箱主视图（M8，M36 增 Hex/Unicode 与文本处理，M60 增 URL 编码 / SQL 格式化，M77 并入编辑 / 对比）
// 作者：cuilanchao · 修改时间：2026-11-25
// 多 Tab（JSON / 编解码 / 正则 / 文本处理 / 摩尔斯 / CSV-JSON / 拼音 / URL 编码 / SQL 格式化 / 编辑 / 对比），
// 前九个纯 renderer 零 IPC；编辑 / 对比页签为 M77 并入的独立三态视图（走 text-toolbox:editor-* / diff-* 通道）
import { computed, ref, watch } from 'vue'
import {
  NButton,
  NCheckbox,
  NInput,
  NRadio,
  NRadioGroup,
  NTabPane,
  NTabs,
  NTag,
  NText
} from 'naive-ui'
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
  encodeUrl,
  type UrlEncodeMode
} from '../encoding'
import { decodeMorse, encodeMorse } from '../morse'
import { collectMatches, replacePreview, type RegexMatchInfo } from '../regex'
import { applyLineOps, replaceText, type CaseMode, type SortMode } from '../text-ops'
import { countText } from '../stats'
import { csvToJson, jsonToCsv, type CsvDelimiter } from '../csv'
import { convertPinyin, type PinyinStyle } from '../pinyin'
import { formatSql, minifySql } from '../sql'
import EditorTab from '../editor/renderer/ToolView.vue'
import DiffTab from '../diff/renderer/ToolView.vue'

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

// —— CSV/JSON Tab（M47）——
const csvDirection = ref<'csv2json' | 'json2csv'>('csv2json')
const csvDelimiter = ref<CsvDelimiter>(',')
const csvHasHeader = ref(true)
const csvIncludeHeader = ref(true)
const csvInput = ref('')
const csvOutput = ref('')

/** 输入 placeholder 随转换方向变化 */
const csvPlaceholder = computed(() =>
  csvDirection.value === 'csv2json'
    ? '粘贴 CSV 文本（支持引号包裹与字段内换行）'
    : '粘贴 JSON 对象数组，如 [{"name":"张三"}]'
)

// —— 拼音 Tab（M54）——
const pinyinStyle = ref<PinyinStyle>('tone')
const pinyinKeepNonZh = ref(true)
const pinyinInput = ref('')
const pinyinOutput = ref('')

// —— URL 编码 Tab（M60）——
const urlMode = ref<UrlEncodeMode>('component')
const urlInput = ref('')
const urlOutput = ref('')
const urlLastAction = ref<'encode' | 'decode' | null>(null)

// —— SQL 格式化 Tab（M60）——
const sqlInput = ref('')
const sqlOutput = ref('')

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

/* ---------- CSV/JSON Tab ---------- */

watch(csvDirection, () => {
  clearFeedback()
  csvOutput.value = ''
})

function runCsv(): void {
  clearFeedback()
  if (csvInput.value.trim() === '') {
    notice.value = '请先输入要转换的文本'
    return
  }
  runMaybeHeavy(csvInput.value, () => {
    const result =
      csvDirection.value === 'csv2json'
        ? csvToJson(csvInput.value, {
            delimiter: csvDelimiter.value,
            hasHeader: csvHasHeader.value
          })
        : jsonToCsv(csvInput.value, {
            delimiter: csvDelimiter.value,
            includeHeader: csvIncludeHeader.value
          })
    if (!result.ok) {
      csvOutput.value = ''
      showError(result.error)
      return
    }
    csvOutput.value = result.value
    notice.value = `转换完成 · ${byteLength(result.value)} 字节`
  })
}

function swapCsv(): void {
  if (csvOutput.value === '') return
  clearFeedback()
  csvInput.value = csvOutput.value
  csvOutput.value = ''
  csvDirection.value = csvDirection.value === 'csv2json' ? 'json2csv' : 'csv2json'
}

function fillCsvSample(): void {
  clearFeedback()
  csvOutput.value = ''
  csvInput.value =
    csvDirection.value === 'csv2json'
      ? 'name,role,active\n张三,管理员,true\n李四,编辑,false'
      : '[{"name":"张三","role":"管理员"},{"name":"李四","role":"编辑"}]'
}

/* ---------- 拼音 Tab（M54） ---------- */

/** 汉字转拼音（首次使用动态加载拼音字典，期间显示加载态） */
async function runPinyin(): Promise<void> {
  clearFeedback()
  if (pinyinInput.value.trim() === '') {
    notice.value = '请先输入要转换的文本'
    return
  }
  busy.value = true
  try {
    const result = await convertPinyin(pinyinInput.value, {
      style: pinyinStyle.value,
      keepNonZh: pinyinKeepNonZh.value
    })
    if (!result.ok) {
      pinyinOutput.value = ''
      showError(result.error)
      return
    }
    pinyinOutput.value = result.value
    notice.value = `转换完成 · ${byteLength(result.value)} 字节`
  } finally {
    busy.value = false
  }
}

function fillPinyinSample(): void {
  clearFeedback()
  pinyinInput.value = '重庆 你好 Lumin 2026'
  pinyinOutput.value = ''
}

function resetPinyin(): void {
  clearFeedback()
  pinyinInput.value = ''
  pinyinOutput.value = ''
}

/* ---------- URL 编码 Tab（M60） ---------- */

/** 按当前模式编码或解码；解码先探测非法 % 序列，产物含替换符时给非阻断警告 */
function runUrl(kind: 'encode' | 'decode'): void {
  clearFeedback()
  if (urlInput.value.trim() === '') return
  const input = urlInput.value
  runMaybeHeavy(input, () => {
    const result = kind === 'encode' ? encodeUrl(input, urlMode.value) : decodeUrl(input)
    if (!result.ok) {
      urlOutput.value = ''
      showError(result.error)
      return
    }
    urlOutput.value = result.value
    urlLastAction.value = kind
    if (kind === 'decode' && result.value.includes('\uFFFD')) {
      notice.value = '输入可能不是合法 UTF-8 字节序列'
      return
    }
    notice.value = `${kind === 'encode' ? '编码' : '解码'}完成 · ${byteLength(result.value)} 字节`
  })
}

/** 输出与输入互换（输出 ↔ 输入） */
function swapUrl(): void {
  if (urlOutput.value === '') return
  clearFeedback()
  const previousInput = urlInput.value
  urlInput.value = urlOutput.value
  urlOutput.value = previousInput
}

/** 对输出按上次方向再执行一次，支持多重编解码 */
function rerunUrl(): void {
  const action = urlLastAction.value
  if (action === null || urlOutput.value === '') return
  clearFeedback()
  const source = urlOutput.value
  runMaybeHeavy(source, () => {
    const result = action === 'encode' ? encodeUrl(source, urlMode.value) : decodeUrl(source)
    if (!result.ok) {
      showError(result.error)
      return
    }
    urlOutput.value = result.value
    if (action === 'decode' && result.value.includes('\uFFFD')) {
      notice.value = '输入可能不是合法 UTF-8 字节序列'
      return
    }
    notice.value = `再次${action === 'encode' ? '编码' : '解码'}完成 · ${byteLength(result.value)} 字节`
  })
}

/* ---------- SQL 格式化 Tab（M60） ---------- */

/** 美化或压缩 SQL；未闭合字面量按原文保留并给非阻断警告 */
function runSql(kind: 'format' | 'minify'): void {
  clearFeedback()
  if (sqlInput.value.trim() === '') return
  const input = sqlInput.value
  runMaybeHeavy(input, () => {
    const result = kind === 'format' ? formatSql(input) : minifySql(input)
    sqlOutput.value = result.value
    notice.value =
      result.warning !== ''
        ? result.warning
        : `${kind === 'format' ? '美化' : '压缩'}完成 · ${byteLength(result.value)} 字节`
  })
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
        编解码、正则测试、批量文本处理与字数统计、摩尔斯电码、CSV/JSON
        互转、汉字转拼音（本地处理，不联网）
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
      <NTabPane name="csv">
        <template #tab>CSV/JSON</template>
      </NTabPane>
      <NTabPane name="pinyin">
        <template #tab>拼音</template>
      </NTabPane>
      <NTabPane name="url">
        <template #tab>URL 编码</template>
      </NTabPane>
      <NTabPane name="sql">
        <template #tab>SQL 格式化</template>
      </NTabPane>
      <NTabPane name="editor">
        <template #tab>编辑</template>
      </NTabPane>
      <NTabPane name="diff">
        <template #tab>对比</template>
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
        <NInput v-model:value="replaceWith" placeholder="支持正则 $1" class="min-w-40 flex-1" />
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

    <!-- CSV/JSON：RFC 4180 解析 + 扁平对象数组序列化 -->
    <div v-if="activeTab === 'csv'" class="flex flex-col gap-3">
      <div class="flex flex-wrap items-center gap-2 text-sm">
        <NText depth="2">方向</NText>
        <select
          v-model="csvDirection"
          aria-label="转换方向"
          class="rounded-[var(--lumin-radius-md)] border border-[var(--lumin-color-border, #e0e0e6)] px-2 py-1 text-sm"
        >
          <option value="csv2json">CSV → JSON</option>
          <option value="json2csv">JSON → CSV</option>
        </select>
        <NText depth="2">分隔符</NText>
        <select
          v-model="csvDelimiter"
          aria-label="CSV 分隔符"
          class="rounded-[var(--lumin-radius-md)] border border-[var(--lumin-color-border, #e0e0e6)] px-2 py-1 text-sm"
        >
          <option :value="','">逗号 ( , )</option>
          <option :value="'\t'">制表符 ( Tab )</option>
          <option :value="';'">分号 ( ; )</option>
          <option :value="'|'">竖线 ( | )</option>
        </select>
        <NCheckbox v-if="csvDirection === 'csv2json'" v-model:checked="csvHasHeader">
          首行作为表头
        </NCheckbox>
        <NCheckbox v-else v-model:checked="csvIncludeHeader">输出表头</NCheckbox>
        <NButton size="tiny" quaternary @click="fillCsvSample">填入示例</NButton>
      </div>

      <div class="grid gap-3 md:grid-cols-2">
        <div class="flex flex-col gap-2">
          <NText depth="2" class="text-sm">输入</NText>
          <NInput
            v-model:value="csvInput"
            type="textarea"
            :placeholder="csvPlaceholder"
            :autosize="{ minRows: 8, maxRows: 16 }"
          />
        </div>
        <div class="flex flex-col gap-2">
          <div class="flex items-center justify-between">
            <NText depth="2" class="text-sm">输出</NText>
            <NButton size="tiny" quaternary @click="copyText(csvOutput, 'csv')">
              <Copy class="mr-1 h-3 w-3" />{{ copiedLabel === 'csv' ? '已复制' : '复制' }}
            </NButton>
          </div>
          <NInput
            :value="csvOutput"
            type="textarea"
            readonly
            placeholder="转换结果"
            :autosize="{ minRows: 8, maxRows: 16 }"
          />
        </div>
      </div>

      <div class="flex items-center gap-2">
        <NButton type="primary" :disabled="busy" @click="runCsv">转换</NButton>
        <NButton quaternary :disabled="busy || csvOutput === ''" @click="swapCsv">交换</NButton>
      </div>
      <NText depth="3" class="text-xs">
        CSV 解析遵循 RFC 4180（引号包裹、"" 转义、字段内换行）；JSON → CSV
        仅接受扁平对象数组，值一律按字符串输出。
      </NText>
    </div>

    <!-- 拼音：汉字转拼音（四种模式，非汉字可保留/移除） -->
    <div v-if="activeTab === 'pinyin'" class="flex flex-col gap-3">
      <div class="flex flex-wrap items-center gap-2 text-sm">
        <NText depth="2">模式</NText>
        <select
          v-model="pinyinStyle"
          aria-label="拼音模式"
          class="rounded-[var(--lumin-radius-md)] border border-[var(--lumin-color-border, #e0e0e6)] px-2 py-1 text-sm"
        >
          <option value="tone">带声调</option>
          <option value="tone-number">数字声调</option>
          <option value="plain">无声调</option>
          <option value="initial">首字母</option>
        </select>
        <NCheckbox v-model:checked="pinyinKeepNonZh">保留非汉字字符</NCheckbox>
        <NButton size="tiny" quaternary @click="fillPinyinSample">填入示例</NButton>
        <NButton size="tiny" quaternary @click="resetPinyin">清空</NButton>
      </div>

      <div class="grid gap-3 md:grid-cols-2">
        <div class="flex flex-col gap-2">
          <NText depth="2" class="text-sm">输入</NText>
          <NInput
            v-model:value="pinyinInput"
            type="textarea"
            placeholder="粘贴要注音的汉字文本，如：重庆 你好"
            :autosize="{ minRows: 8, maxRows: 16 }"
          />
        </div>
        <div class="flex flex-col gap-2">
          <div class="flex items-center justify-between">
            <NText depth="2" class="text-sm">输出</NText>
            <NButton size="tiny" quaternary @click="copyText(pinyinOutput, 'pinyin')">
              <Copy class="mr-1 h-3 w-3" />{{ copiedLabel === 'pinyin' ? '已复制' : '复制' }}
            </NButton>
          </div>
          <NInput
            :value="pinyinOutput"
            type="textarea"
            readonly
            placeholder="注音结果"
            :autosize="{ minRows: 8, maxRows: 16 }"
          />
        </div>
      </div>

      <div class="flex items-center gap-2">
        <NButton type="primary" :disabled="busy" @click="runPinyin">转换</NButton>
      </div>
      <NText depth="3" class="text-xs">
        支持带声调 / 数字声调 / 无声调 /
        首字母；相邻汉字间按模式加分隔符，非汉字原样保留（可移除以只保留拼音）。
      </NText>
    </div>

    <!-- URL 编码：组件级 / 完整（RFC 3986）两种模式，解码先定位非法 % 序列 -->
    <div v-if="activeTab === 'url'" class="flex flex-col gap-3">
      <div class="flex flex-wrap items-center gap-4 text-sm">
        <NText depth="2">模式</NText>
        <NRadioGroup v-model:value="urlMode">
          <NRadio value="component">组件级</NRadio>
          <NRadio value="full">完整</NRadio>
        </NRadioGroup>
      </div>
      <div class="grid gap-3 md:grid-cols-2">
        <div class="flex flex-col gap-2">
          <NText depth="2" class="text-sm">输入</NText>
          <NInput
            v-model:value="urlInput"
            type="textarea"
            placeholder="粘贴要编码或解码的源文本"
            :autosize="{ minRows: 8, maxRows: 16 }"
          />
        </div>
        <div class="flex flex-col gap-2">
          <NText depth="2" class="text-sm">输出</NText>
          <NInput
            :value="urlOutput"
            type="textarea"
            readonly
            placeholder="处理结果"
            :autosize="{ minRows: 8, maxRows: 16 }"
          />
        </div>
      </div>
      <div class="flex items-center gap-2">
        <NButton
          type="primary"
          :disabled="busy || urlInput.trim() === ''"
          @click="runUrl('encode')"
        >
          编码
        </NButton>
        <NButton :disabled="busy || urlInput.trim() === ''" @click="runUrl('decode')">
          解码
        </NButton>
        <NButton quaternary :disabled="busy || urlOutput === ''" @click="swapUrl">交换</NButton>
        <NButton :disabled="busy || urlOutput === '' || urlLastAction === null" @click="rerunUrl">
          再执行一次
        </NButton>
      </div>
    </div>

    <!-- SQL 格式化：自写 tokenizer 保护字面量，子句关键字换行大写缩进 -->
    <div v-if="activeTab === 'sql'" class="flex flex-col gap-3">
      <div class="grid gap-3 md:grid-cols-2">
        <div class="flex flex-col gap-2">
          <NText depth="2" class="text-sm">输入</NText>
          <NInput
            v-model:value="sqlInput"
            type="textarea"
            placeholder="粘贴 SQL 语句"
            :autosize="{ minRows: 8, maxRows: 16 }"
          />
        </div>
        <div class="flex flex-col gap-2">
          <div class="flex items-center justify-between">
            <NText depth="2" class="text-sm">输出</NText>
            <NButton size="tiny" quaternary @click="copyText(sqlOutput, 'sql')">
              <Copy class="mr-1 h-3 w-3" />{{ copiedLabel === 'sql' ? '已复制' : '复制' }}
            </NButton>
          </div>
          <NInput
            :value="sqlOutput"
            type="textarea"
            readonly
            placeholder="格式化结果"
            :autosize="{ minRows: 8, maxRows: 16 }"
          />
        </div>
      </div>
      <div class="flex items-center gap-2">
        <NButton
          type="primary"
          :disabled="busy || sqlInput.trim() === ''"
          @click="runSql('format')"
        >
          美化
        </NButton>
        <NButton :disabled="busy || sqlInput.trim() === ''" @click="runSql('minify')">
          压缩
        </NButton>
      </div>
      <NText v-if="sqlInput.trim() === ''" depth="3" class="text-sm">
        输入 SQL 语句后可美化或压缩。
      </NText>
    </div>

    <!-- M77 并入页签：编辑 / 对比（自带完整三态与离开拦截，独立渲染） -->
    <EditorTab v-if="activeTab === 'editor'" />
    <DiffTab v-if="activeTab === 'diff'" />

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
