<script setup lang="ts">
/**
 * @file markdown-tool 渲染层（Markdown 预览 / JSON→TS / YAML 三页签）
 * @author cuilanchao
 * @date 2026-11-21
 * @description spec §2：解析全在 renderer 同步完成；预览用 sandbox iframe + CSP；
 *              导出经主进程 save 通道（原子写盘 + 冲突递增）。
 */
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { NButton, NInput, NRadioButton, NRadioGroup, NTabPane, NTabs, NText } from 'naive-ui'
import { Copy, Download, FolderOpen } from '@lucide/vue'
import type { StructuredError } from '@lumin/shared'
import { buildHtmlDocument, renderMarkdown, type MarkdownOutcome } from '../markdown'
import { generateTypes, type DeclarationStyle } from '../json-to-ts'
import { formatYaml, jsonToYaml, yamlToJson } from '../yaml'
import { sanitizeBaseName } from '../save'
import { errorMessage, toolError, type MarkdownToolErrorCode, type ToolFailure } from '../errors'
import { config, revealPath, saveFile, saveOutputDir } from './client'

type TabKey = 'markdown' | 'json' | 'yaml'
type YamlMode = 'yaml-to-json' | 'json-to-yaml' | 'format-yaml'

/** 内置示例（标题/列表/引用/表格/代码块/链接） */
const MARKDOWN_SAMPLE = [
  '# Lumin Markdown 示例',
  '',
  '## 列表与行内样式',
  '',
  '- 支持 **粗体**、*斜体* 与 `行内代码`',
  '- [链接](https://example.com)',
  '',
  '> 引用块：内容在本地渲染，脚本不会执行。',
  '',
  '| 功能 | 状态 |',
  '| --- | --- |',
  '| 预览 | 已支持 |',
  '| 导出 | 已支持 |',
  '',
  '```ts',
  "const message = 'Hello Lumin'",
  '```'
].join('\n')

const YAML_PLACEHOLDERS: Record<YamlMode, string> = {
  'yaml-to-json': '粘贴 YAML，例如：\nname: lumin\nversion: 0.1.0',
  'json-to-yaml': '粘贴 JSON，例如：{"name":"lumin","version":"0.1.0"}',
  'format-yaml': '粘贴 YAML 进行格式化（移除注释）'
}

const activeTab = ref<TabKey>('markdown')
const outputDir = ref('')
const exporting = ref(false)
const actionError = ref<StructuredError | null>(null)
const notice = ref('')
const lastOutput = ref<string | null>(null)
const copiedKey = ref('')

// —— Markdown 页签 ——
const mdInput = ref('')
const mdResult = ref<MarkdownOutcome>({ ok: true, value: { html: '', chars: 0, lines: 0 } })
const mdFileName = ref('document')
let mdTimer: ReturnType<typeof setTimeout> | undefined

watch(
  mdInput,
  () => {
    if (mdTimer !== undefined) clearTimeout(mdTimer)
    mdTimer = setTimeout(() => {
      mdResult.value = renderMarkdown(mdInput.value)
    }, 150)
  },
  { immediate: true }
)

onBeforeUnmount(() => {
  if (mdTimer !== undefined) clearTimeout(mdTimer)
})

const mdHtml = computed(() => (mdResult.value.ok ? mdResult.value.value.html : ''))
const mdPreviewDoc = computed(() => buildHtmlDocument(mdHtml.value, 'Markdown 预览', 'preview'))
const mdFailure = computed<ToolFailure | null>(() => (mdResult.value.ok ? null : mdResult.value))
const mdChars = computed(() => (mdResult.value.ok ? mdResult.value.value.chars : 0))
const mdLines = computed(() => (mdResult.value.ok ? mdResult.value.value.lines : 0))

// —— JSON→TS 页签 ——
const jsonInput = ref('')
const rootName = ref('Root')
const tsStyle = ref<DeclarationStyle>('interface')
const tsFileName = ref('types')
const tsOutcome = computed(() =>
  generateTypes(jsonInput.value, { rootName: rootName.value, style: tsStyle.value })
)
const tsCode = computed(() => (tsOutcome.value.ok ? tsOutcome.value.value.code : ''))
const tsExtension = computed<'ts' | 'json'>(() =>
  tsStyle.value === 'json-schema' ? 'json' : 'ts'
)
watch(tsStyle, (style) => {
  if (style === 'json-schema' && tsFileName.value === 'types') tsFileName.value = 'schema'
  if (style !== 'json-schema' && tsFileName.value === 'schema') tsFileName.value = 'types'
  actionError.value = null
})
const tsFailure = computed<ToolFailure | null>(() => {
  if (tsOutcome.value.ok) return null
  if (jsonInput.value.trim() === '' && rootName.value === '') return null
  return tsOutcome.value
})

// —— YAML 页签 ——
const yamlMode = ref<YamlMode>('yaml-to-json')
const yamlInput = ref('')
const yamlFileName = ref('data')
const yamlOutcome = computed(() => {
  if (yamlMode.value === 'yaml-to-json') return yamlToJson(yamlInput.value)
  if (yamlMode.value === 'json-to-yaml') return jsonToYaml(yamlInput.value)
  return formatYaml(yamlInput.value)
})
const yamlOutput = computed(() => (yamlOutcome.value.ok ? yamlOutcome.value.value.text : ''))
const yamlFailure = computed<ToolFailure | null>(() => (yamlOutcome.value.ok ? null : yamlOutcome.value))
const yamlExtension = computed<'json' | 'yaml'>(() =>
  yamlMode.value === 'yaml-to-json' ? 'json' : 'yaml'
)

watch(yamlMode, () => {
  actionError.value = null
})

onMounted(() => {
  void loadConfig()
})

/** 读取输出目录记忆（失败时保持空，导出由主进程回退默认目录） */
async function loadConfig(): Promise<void> {
  try {
    const result = await config()
    outputDir.value = result.outputDir
  } catch {
    outputDir.value = ''
  }
}

/**
 * 错误归一化（bridge 抛错 → 结构化展示）
 * @param err 捕获异常
 * @param fallback 兜底错误码
 */
function normalizeError(err: unknown, fallback: MarkdownToolErrorCode): StructuredError {
  if (typeof err === 'object' && err !== null) {
    const source = err as { code?: unknown; message?: unknown; detail?: unknown }
    const result: StructuredError = {
      code: typeof source.code === 'string' ? source.code : fallback,
      message:
        typeof source.message === 'string' && source.message !== ''
          ? source.message
          : errorMessage(fallback)
    }
    if (typeof source.detail === 'string') result.detail = source.detail
    return result
  }
  return { code: fallback, message: errorMessage(fallback) }
}

/**
 * 失败文案（含 detail）
 * @param failure 纯函数失败结果
 */
function failureText(failure: ToolFailure): string {
  return failure.detail === undefined || failure.detail === ''
    ? failure.message
    : `${failure.message}（${failure.detail}）`
}

/**
 * 复制文本到剪贴板
 * @param key 复制成功的标记键
 * @param text 待复制文本
 */
async function copyText(key: string, text: string): Promise<void> {
  if (text === '') return
  try {
    await navigator.clipboard.writeText(text)
    copiedKey.value = key
    setTimeout(() => {
      if (copiedKey.value === key) copiedKey.value = ''
    }, 1500)
  } catch {
    actionError.value = toolError('MD_CLIPBOARD_FAILED')
  }
}

/** 选择输出目录并记忆 */
async function chooseDirectory(): Promise<void> {
  try {
    const dir = await window.lumin.pickDirectory('选择输出目录')
    if (dir === null || dir === '') return
    outputDir.value = dir
    await saveOutputDir(dir)
  } catch (err) {
    actionError.value = normalizeError(err, 'MD_SAVE_FAILED')
  }
}

/**
 * 导出文本产物
 * @param extension 扩展名
 * @param baseName 文件名主名
 * @param content 文件内容
 */
async function exportFile(
  extension: 'html' | 'ts' | 'json' | 'yaml',
  baseName: string,
  content: string
): Promise<void> {
  if (content.trim() === '') return
  actionError.value = null
  notice.value = ''
  exporting.value = true
  try {
    const result = await saveFile({
      outputDir: outputDir.value,
      baseName: sanitizeBaseName(baseName),
      extension,
      content
    })
    lastOutput.value = result.output
    notice.value = `已导出：${result.output}`
  } catch (err) {
    actionError.value = normalizeError(err, 'MD_SAVE_FAILED')
  } finally {
    exporting.value = false
  }
}

/** 打开最近一次导出所在文件夹 */
function openFolder(): void {
  if (lastOutput.value === null) return
  void revealPath(lastOutput.value).catch(() => undefined)
}

/** 载入示例 Markdown */
function loadSample(): void {
  mdInput.value = MARKDOWN_SAMPLE
}
</script>

<template>
  <div class="mx-auto flex max-w-5xl flex-col gap-4">
    <header>
      <h1 class="text-base font-semibold">Markdown 工具</h1>
      <p class="mt-1 text-sm text-[var(--lumin-color-text-secondary)]">
        Markdown 预览与 HTML 导出、JSON 转 TypeScript 类型、YAML 格式化与互转；全部本地处理。
      </p>
    </header>

    <div class="flex flex-wrap items-center gap-2 text-sm">
      <NText depth="2">输出目录：</NText>
      <NText code class="max-w-96 truncate">{{ outputDir === '' ? '（默认 userData/markdown）' : outputDir }}</NText>
      <NButton size="small" secondary data-testid="choose-dir" @click="chooseDirectory">
        <FolderOpen class="mr-1 h-3 w-3" />选择目录
      </NButton>
      <NButton v-if="lastOutput !== null" size="small" quaternary @click="openFolder">
        打开所在文件夹
      </NButton>
    </div>

    <NTabs v-model:value="activeTab" type="line" animated>
      <!-- Markdown 预览 -->
      <NTabPane name="markdown" tab="Markdown">
        <div class="flex flex-col gap-3 pt-2">
          <div class="grid gap-3 md:grid-cols-2">
            <div class="flex flex-col gap-2">
              <div class="flex items-center justify-between">
                <NText depth="2" class="text-sm">Markdown 输入</NText>
                <div class="flex items-center gap-1">
                  <NButton size="tiny" quaternary data-testid="load-sample" @click="loadSample">
                    载入示例
                  </NButton>
                  <NButton size="tiny" quaternary data-testid="clear-markdown" @click="mdInput = ''">
                    清空
                  </NButton>
                </div>
              </div>
              <div data-testid="md-input">
                <NInput
                  v-model:value="mdInput"
                  type="textarea"
                  placeholder="在此输入 Markdown…"
                  :autosize="{ minRows: 16, maxRows: 40 }"
                  :input-props="{ class: 'font-mono text-xs', spellcheck: false }"
                />
              </div>
              <NText depth="3" class="text-xs" data-testid="md-stats">
                字符 {{ mdChars }} · 行 {{ mdLines }}
              </NText>
              <div
                v-if="mdFailure !== null"
                role="alert"
                class="text-sm text-[var(--lumin-color-error)]"
                data-testid="md-error"
              >
                {{ mdFailure.code }} · {{ failureText(mdFailure) }}
              </div>
            </div>

            <div class="flex flex-col gap-2">
              <NText depth="2" class="text-sm">预览</NText>
              <iframe
                v-if="mdHtml !== ''"
                data-testid="md-preview"
                class="h-96 w-full rounded-[var(--lumin-radius-md)] border border-[var(--lumin-color-border, #e0e0e6)] bg-white"
                title="Markdown 预览"
                sandbox=""
                :srcdoc="mdPreviewDoc"
              ></iframe>
              <div
                v-else
                class="flex h-96 items-center justify-center rounded-[var(--lumin-radius-md)] border border-dashed border-[var(--lumin-color-border, #e0e0e6)] text-sm text-[var(--lumin-color-text-secondary)]"
              >
                在左侧输入 Markdown，或点击「载入示例」
              </div>
            </div>
          </div>

          <div class="flex flex-wrap items-center gap-2">
            <NButton size="small" secondary :disabled="mdHtml === ''" @click="copyText('md', mdHtml)">
              <Copy class="mr-1 h-3 w-3" />{{ copiedKey === 'md' ? '已复制' : '复制 HTML' }}
            </NButton>
            <NInput
              v-model:value="mdFileName"
              size="small"
              class="w-48"
              placeholder="文件名"
              data-testid="md-file-name"
            />
            <NButton
              size="small"
              type="primary"
              :loading="exporting"
              :disabled="mdHtml === ''"
              data-testid="export-html"
              @click="exportFile('html', mdFileName, mdPreviewDoc)"
            >
              <Download class="mr-1 h-3 w-3" />导出 HTML
            </NButton>
          </div>
        </div>
      </NTabPane>

      <!-- JSON → TypeScript -->
      <NTabPane name="json" tab="JSON→TS">
        <div class="flex flex-col gap-3 pt-2">
          <div class="grid gap-3 md:grid-cols-2">
            <div class="flex flex-col gap-2">
              <div class="flex flex-wrap items-center gap-2">
                <NText depth="2" class="text-sm">
                  {{ tsStyle === 'json-schema' ? '根标题' : '根类型名' }}
                </NText>
                <NInput v-model:value="rootName" size="small" class="w-32" data-testid="ts-root-name" />
                <NRadioGroup v-model:value="tsStyle" size="small" data-testid="ts-style">
                  <NRadioButton value="interface">interface</NRadioButton>
                  <NRadioButton value="type">type</NRadioButton>
                  <NRadioButton value="json-schema">json-schema</NRadioButton>
                </NRadioGroup>
              </div>
              <div data-testid="ts-input">
                <NInput
                  v-model:value="jsonInput"
                  type="textarea"
                  placeholder="粘贴 JSON，例如：{&quot;id&quot;:1,&quot;name&quot;:&quot;lumin&quot;}"
                  :autosize="{ minRows: 16, maxRows: 40 }"
                  :input-props="{ class: 'font-mono text-xs', spellcheck: false }"
                />
              </div>
              <div
                v-if="tsFailure !== null"
                role="alert"
                class="text-sm text-[var(--lumin-color-error)]"
                data-testid="ts-error"
              >
                {{ tsFailure.code }} · {{ failureText(tsFailure) }}
              </div>
            </div>

            <div class="flex flex-col gap-2">
              <NText depth="2" class="text-sm">生成结果</NText>
              <div data-testid="ts-output">
                <NInput
                  :value="tsCode"
                  type="textarea"
                  readonly
                  placeholder="生成结果将显示在这里"
                  :autosize="{ minRows: 16, maxRows: 40 }"
                  :input-props="{ class: 'font-mono text-xs', spellcheck: false }"
                />
              </div>
            </div>
          </div>

          <div class="flex flex-wrap items-center gap-2">
            <NButton size="small" secondary :disabled="tsCode === ''" @click="copyText('ts', tsCode)">
              <Copy class="mr-1 h-3 w-3" />{{ copiedKey === 'ts' ? '已复制' : '复制代码' }}
            </NButton>
            <NInput
              v-model:value="tsFileName"
              size="small"
              class="w-48"
              placeholder="文件名"
              data-testid="ts-file-name"
            />
            <NButton
              size="small"
              type="primary"
              :loading="exporting"
              :disabled="tsCode === ''"
              data-testid="export-ts"
              @click="exportFile(tsExtension, tsFileName, tsCode)"
            >
              <Download class="mr-1 h-3 w-3" />导出 .{{ tsExtension }}
            </NButton>
          </div>
        </div>
      </NTabPane>

      <!-- YAML -->
      <NTabPane name="yaml" tab="YAML">
        <div class="flex flex-col gap-3 pt-2">
          <div class="flex flex-wrap items-center gap-2">
            <NRadioGroup v-model:value="yamlMode" size="small" data-testid="yaml-mode">
              <NRadioButton value="yaml-to-json">YAML→JSON</NRadioButton>
              <NRadioButton value="json-to-yaml">JSON→YAML</NRadioButton>
              <NRadioButton value="format-yaml">格式化 YAML</NRadioButton>
            </NRadioGroup>
            <NText depth="3" class="text-xs">格式化会移除注释、展开锚点</NText>
          </div>

          <div class="grid gap-3 md:grid-cols-2">
            <div class="flex flex-col gap-2">
              <NText depth="2" class="text-sm">输入</NText>
              <div data-testid="yaml-input">
                <NInput
                  v-model:value="yamlInput"
                  type="textarea"
                  :placeholder="YAML_PLACEHOLDERS[yamlMode]"
                  :autosize="{ minRows: 16, maxRows: 40 }"
                  :input-props="{ class: 'font-mono text-xs', spellcheck: false }"
                />
              </div>
              <div
                v-if="yamlFailure !== null"
                role="alert"
                class="text-sm text-[var(--lumin-color-error)]"
                data-testid="yaml-error"
              >
                {{ yamlFailure.code }} · {{ failureText(yamlFailure) }}
              </div>
            </div>

            <div class="flex flex-col gap-2">
              <NText depth="2" class="text-sm">输出</NText>
              <div data-testid="yaml-output">
                <NInput
                  :value="yamlOutput"
                  type="textarea"
                  readonly
                  placeholder="转换结果将显示在这里"
                  :autosize="{ minRows: 16, maxRows: 40 }"
                  :input-props="{ class: 'font-mono text-xs', spellcheck: false }"
                />
              </div>
            </div>
          </div>

          <div class="flex flex-wrap items-center gap-2">
            <NButton
              size="small"
              secondary
              :disabled="yamlOutput === ''"
              @click="copyText('yaml', yamlOutput)"
            >
              <Copy class="mr-1 h-3 w-3" />{{ copiedKey === 'yaml' ? '已复制' : '复制结果' }}
            </NButton>
            <NInput
              v-model:value="yamlFileName"
              size="small"
              class="w-48"
              placeholder="文件名"
              data-testid="yaml-file-name"
            />
            <NButton
              size="small"
              type="primary"
              :loading="exporting"
              :disabled="yamlOutput === ''"
              data-testid="export-yaml"
              @click="exportFile(yamlExtension, yamlFileName, yamlOutput)"
            >
              <Download class="mr-1 h-3 w-3" />导出 .{{ yamlExtension }}
            </NButton>
          </div>
        </div>
      </NTabPane>
    </NTabs>

    <div
      v-if="actionError !== null"
      role="alert"
      class="text-sm text-[var(--lumin-color-error)]"
      data-testid="action-error"
    >
      {{ actionError.code }} · {{ actionError.message }}
      <span v-if="actionError.detail" class="text-xs">（{{ actionError.detail }}）</span>
    </div>
    <NText v-if="notice !== ''" depth="2" class="text-xs" data-testid="export-notice">
      {{ notice }}
    </NText>
  </div>
</template>
