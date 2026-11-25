<script setup lang="ts">
// 系统信息（M53）
// 作者：cuilanchao · 修改时间：2026-11-22
// 三态强制：空态引导采集 / 加载态只读采集 / 报错态 SI_COLLECT_FAILED + 重试；
// 展示操作系统、处理器、内存、磁盘、网络五区，支持刷新与复制全部（只读，不写盘）。
import { computed, onUnmounted, ref } from 'vue'
import { NButton, NEmpty, NSpin, NText } from 'naive-ui'
import {
  Check,
  CircleAlert,
  Copy,
  Cpu,
  HardDrive,
  MemoryStick,
  Monitor,
  Network,
  RefreshCw
} from '@lucide/vue'
import { toStructuredError, type StructuredError } from '@lumin/shared'
import {
  buildCopyText,
  formatFrequency,
  formatPercent,
  formatSize,
  formatTimestamp,
  formatUptime,
  percentValue,
  platformLabel,
  summarizeDisks
} from '../format'
import { isRetryable, toolError } from '../errors'
import type { Snapshot } from '../schema'
import { snapshot as fetchSnapshot } from './client'

const info = ref<Snapshot | null>(null)
const loading = ref(false)
const error = ref<StructuredError | null>(null)
const errorDetail = ref('')
const copied = ref(false)
const copyError = ref<StructuredError | null>(null)

let copiedTimer: ReturnType<typeof setTimeout> | undefined

const diskSummary = computed(() => (info.value === null ? null : summarizeDisks(info.value.disks)))

const memoryPercent = computed(() => {
  const current = info.value
  if (current === null) return 0
  return percentValue(current.memory.usedBytes, current.memory.totalBytes)
})

/** 采集/刷新系统信息 */
async function collect(): Promise<void> {
  if (loading.value) return
  loading.value = true
  error.value = null
  errorDetail.value = ''
  copyError.value = null
  try {
    info.value = await fetchSnapshot()
  } catch (err) {
    const structured = toStructuredError(err)
    info.value = null
    error.value = structured
    errorDetail.value = structured.detail ?? ''
  } finally {
    loading.value = false
  }
}

/** 复制全部为纯文本 */
async function copyAll(): Promise<void> {
  const current = info.value
  if (current === null) return
  copyError.value = null
  try {
    await navigator.clipboard.writeText(buildCopyText(current))
    copied.value = true
    if (copiedTimer !== undefined) clearTimeout(copiedTimer)
    copiedTimer = setTimeout(() => {
      copied.value = false
    }, 1500)
  } catch (err) {
    copied.value = false
    copyError.value = toolError('SI_CLIPBOARD_FAILED', err instanceof Error ? err.message : '')
  }
}

onUnmounted(() => {
  if (copiedTimer !== undefined) clearTimeout(copiedTimer)
})
</script>

<template>
  <div class="flex max-w-4xl flex-col gap-4">
    <!-- 操作区 -->
    <div class="flex flex-wrap items-center gap-2">
      <NButton type="primary" :loading="loading" @click="collect">
        <RefreshCw v-if="info !== null" class="mr-1 h-3.5 w-3.5" />
        <Monitor v-else class="mr-1 h-3.5 w-3.5" />
        {{ info === null ? '采集系统信息' : '刷新' }}
      </NButton>
      <NButton :disabled="info === null || loading" @click="copyAll">
        <Check v-if="copied" class="mr-1 h-3.5 w-3.5" />
        <Copy v-else class="mr-1 h-3.5 w-3.5" />
        {{ copied ? '已复制' : '复制全部' }}
      </NButton>
      <NText v-if="copied" depth="3" class="text-xs">已复制到剪贴板</NText>
    </div>

    <!-- 加载态 -->
    <div
      v-if="loading"
      class="flex items-center gap-2 text-sm text-[var(--lumin-color-text-secondary)]"
    >
      <NSpin size="small" />正在采集系统信息…
    </div>

    <!-- 报错态 -->
    <div v-if="error !== null" class="flex flex-col gap-1">
      <div class="flex items-center gap-2">
        <NText type="error" class="text-sm">
          <CircleAlert class="mr-1 inline h-3.5 w-3.5" />{{ error.message }}
        </NText>
        <NButton v-if="isRetryable(error.code) && !loading" size="tiny" quaternary @click="collect">
          重试
        </NButton>
      </div>
      <details v-if="errorDetail !== ''">
        <summary class="cursor-pointer text-xs text-[var(--lumin-color-text-secondary)]">
          详情
        </summary>
        <NText depth="3" class="block break-all text-xs">{{ errorDetail }}</NText>
      </details>
    </div>

    <NText v-if="copyError !== null" type="error" class="text-xs">{{ copyError.message }}</NText>

    <!-- 空态 -->
    <NEmpty
      v-if="info === null && !loading && error === null"
      description="点击「采集系统信息」查看本机 CPU、内存、磁盘与网络概览"
    />

    <!-- 结果 -->
    <template v-if="info !== null">
      <div class="grid gap-3 md:grid-cols-2">
        <!-- 操作系统 -->
        <section
          class="rounded-[var(--lumin-radius-md)] border border-[var(--lumin-color-border)] bg-[var(--lumin-color-surface)] p-3"
        >
          <div class="mb-2 flex items-center gap-1.5 text-sm font-medium">
            <Monitor class="h-4 w-4" />操作系统
          </div>
          <dl class="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
            <dt class="text-[var(--lumin-color-text-secondary)]">系统</dt>
            <dd class="min-w-0 break-words">
              {{ platformLabel(info.os.platform) }} {{ info.os.release }}
            </dd>
            <dt class="text-[var(--lumin-color-text-secondary)]">类型</dt>
            <dd class="min-w-0 break-words">{{ info.os.type }}</dd>
            <dt class="text-[var(--lumin-color-text-secondary)]">架构</dt>
            <dd class="min-w-0 break-words">{{ info.os.arch }}</dd>
            <dt class="text-[var(--lumin-color-text-secondary)]">主机名</dt>
            <dd class="min-w-0 break-words">{{ info.os.hostname }}</dd>
            <dt class="text-[var(--lumin-color-text-secondary)]">运行时长</dt>
            <dd class="min-w-0 break-words">{{ formatUptime(info.os.uptimeSec) }}</dd>
          </dl>
        </section>

        <!-- 处理器 -->
        <section
          class="rounded-[var(--lumin-radius-md)] border border-[var(--lumin-color-border)] bg-[var(--lumin-color-surface)] p-3"
        >
          <div class="mb-2 flex items-center gap-1.5 text-sm font-medium">
            <Cpu class="h-4 w-4" />处理器
          </div>
          <dl class="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
            <dt class="text-[var(--lumin-color-text-secondary)]">型号</dt>
            <dd class="min-w-0 break-words">{{ info.cpu.model }}</dd>
            <dt class="text-[var(--lumin-color-text-secondary)]">逻辑核心</dt>
            <dd>{{ info.cpu.cores }}</dd>
            <dt class="text-[var(--lumin-color-text-secondary)]">平均主频</dt>
            <dd>{{ formatFrequency(info.cpu.speedMhz) }}</dd>
          </dl>
        </section>

        <!-- 内存 -->
        <section
          class="rounded-[var(--lumin-radius-md)] border border-[var(--lumin-color-border)] bg-[var(--lumin-color-surface)] p-3 md:col-span-2"
        >
          <div class="mb-2 flex items-center gap-1.5 text-sm font-medium">
            <MemoryStick class="h-4 w-4" />内存
          </div>
          <div class="mb-2 flex flex-wrap items-center justify-between gap-2 text-sm">
            <span>
              已用 {{ formatSize(info.memory.usedBytes) }} / 共
              {{ formatSize(info.memory.totalBytes) }}
            </span>
            <span class="text-[var(--lumin-color-text-secondary)]">
              可用 {{ formatSize(info.memory.freeBytes) }} ·
              {{ formatPercent(info.memory.usedBytes, info.memory.totalBytes) }}
            </span>
          </div>
          <div class="h-1.5 w-full overflow-hidden rounded-full bg-[var(--lumin-color-border)]">
            <div
              class="h-full rounded-full bg-[var(--lumin-color-primary)]"
              :style="{ width: `${memoryPercent}%` }"
            />
          </div>
        </section>

        <!-- 磁盘 -->
        <section
          class="rounded-[var(--lumin-radius-md)] border border-[var(--lumin-color-border)] bg-[var(--lumin-color-surface)] p-3 md:col-span-2"
        >
          <div class="mb-2 flex items-center gap-1.5 text-sm font-medium">
            <HardDrive class="h-4 w-4" />磁盘
          </div>
          <NText v-if="diskSummary !== null" depth="3" class="mb-2 block text-xs">
            共 {{ formatSize(diskSummary.totalBytes) }} · 已用
            {{ formatSize(diskSummary.usedBytes) }} · 可用
            {{ formatSize(diskSummary.freeBytes) }}
          </NText>
          <NText v-if="info.disks.length === 0" depth="3" class="text-sm">
            未检测到可访问磁盘
          </NText>
          <div v-else class="flex flex-col gap-2">
            <div v-for="disk in info.disks" :key="disk.path" class="flex flex-col gap-1">
              <div class="flex flex-wrap items-center justify-between gap-2 text-sm">
                <span class="font-medium">{{ disk.path }}</span>
                <span class="text-[var(--lumin-color-text-secondary)]">
                  {{ formatSize(disk.usedBytes) }} / {{ formatSize(disk.totalBytes) }} ·
                  {{ formatPercent(disk.usedBytes, disk.totalBytes) }}
                </span>
              </div>
              <div class="h-1.5 w-full overflow-hidden rounded-full bg-[var(--lumin-color-border)]">
                <div
                  class="h-full rounded-full bg-[var(--lumin-color-primary)]"
                  :style="{ width: `${percentValue(disk.usedBytes, disk.totalBytes)}%` }"
                />
              </div>
            </div>
          </div>
        </section>

        <!-- 网络 -->
        <section
          class="rounded-[var(--lumin-radius-md)] border border-[var(--lumin-color-border)] bg-[var(--lumin-color-surface)] p-3 md:col-span-2"
        >
          <div class="mb-2 flex items-center gap-1.5 text-sm font-medium">
            <Network class="h-4 w-4" />网络
          </div>
          <NText v-if="info.networks.length === 0" depth="3" class="text-sm">
            未检测到外部网络接口
          </NText>
          <div v-else class="flex flex-col">
            <div
              v-for="net in info.networks"
              :key="`${net.name}-${net.address}`"
              class="flex flex-col gap-0.5 border-b border-[var(--lumin-color-border)] py-1.5 text-sm last:border-b-0"
            >
              <div class="flex flex-wrap items-center gap-1.5">
                <span class="font-medium">{{ net.name }}</span>
                <span class="text-xs text-[var(--lumin-color-text-secondary)]">
                  {{ net.family }}
                </span>
              </div>
              <div class="break-all text-[var(--lumin-color-text-secondary)]">
                {{ net.address }}<template v-if="net.mac !== ''"> · {{ net.mac }}</template>
              </div>
            </div>
          </div>
        </section>
      </div>

      <NText depth="3" class="text-xs">采集时间：{{ formatTimestamp(info.collectedAt) }}</NText>
    </template>
  </div>
</template>
