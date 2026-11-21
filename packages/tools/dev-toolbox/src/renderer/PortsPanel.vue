<script setup lang="ts">
// 端口占用页签（M42）：查询 netstat -ano（TCP/UDP）→ 行过滤 → 结束进程
// 作者：cuilanchao · 修改时间：2026-11-21
import { computed, ref } from 'vue'
import { NAlert, NButton, NInput, NPopconfirm, NSpin, NText } from 'naive-ui'
import { RefreshCw, Trash2 } from '@lucide/vue'
import { toStructuredError, type StructuredError } from '@lumin/shared'
import { toolError } from '../errors'
import type { PortRow } from '../schema'
import { portKill, portsQuery } from './client'

const portText = ref('')
const filter = ref('')
const rows = ref<PortRow[]>([])
const truncated = ref(false)
const elapsedMs = ref(0)
const loading = ref(false)
const killingPid = ref<number | null>(null)
const queried = ref(false)
const error = ref<StructuredError | null>(null)

/** 本地行过滤（协议/地址/端口/PID/进程名，大小写不敏感） */
const visibleRows = computed<PortRow[]>(() => {
  const keyword = filter.value.trim().toLowerCase()
  if (keyword === '') return rows.value
  return rows.value.filter(
    (row) =>
      row.protocol.toLowerCase().includes(keyword) ||
      row.localAddress.toLowerCase().includes(keyword) ||
      String(row.port).includes(keyword) ||
      String(row.pid).includes(keyword) ||
      row.process.toLowerCase().includes(keyword)
  )
})

async function query(): Promise<void> {
  const text = portText.value.trim()
  let port: number | undefined
  if (text !== '') {
    const value = Number(text)
    if (!/^\d+$/.test(text) || !Number.isInteger(value) || value < 1 || value > 65535) {
      error.value = toolError('DT_INVALID_PORT')
      return
    }
    port = value
  }
  loading.value = true
  error.value = null
  try {
    const result = await portsQuery(port === undefined ? {} : { port })
    rows.value = result.rows
    truncated.value = result.truncated
    elapsedMs.value = result.elapsedMs
    queried.value = true
  } catch (err) {
    rows.value = []
    error.value = toStructuredError(err)
  } finally {
    loading.value = false
  }
}

async function kill(pid: number): Promise<void> {
  killingPid.value = pid
  error.value = null
  try {
    await portKill(pid)
    await query()
  } catch (err) {
    error.value = toStructuredError(err)
  } finally {
    killingPid.value = null
  }
}
</script>

<template>
  <div class="flex flex-col gap-3">
    <div class="flex flex-wrap items-center gap-2">
      <NInput
        v-model:value="portText"
        placeholder="端口（留空 = 全部）"
        class="w-44"
        :disabled="loading"
        @keyup.enter="query"
      />
      <NButton type="primary" :loading="loading" @click="query">
        <RefreshCw v-if="!loading" class="mr-1 h-4 w-4" />查询
      </NButton>
      <NInput
        v-model:value="filter"
        placeholder="按端口 / PID / 进程名过滤"
        class="w-56"
        :disabled="rows.length === 0"
      />
      <NText v-if="queried && !loading" depth="3" class="text-xs">
        {{ visibleRows.length }} / {{ rows.length }} 行 · {{ elapsedMs }} ms
        <template v-if="truncated">（已达 5000 行上限，已截断）</template>
      </NText>
    </div>

    <!-- 加载态 -->
    <div v-if="loading" class="flex items-center gap-2">
      <NSpin size="small" />
      <NText depth="2" class="text-sm">正在查询本机端口…</NText>
    </div>

    <!-- 空态 -->
    <div
      v-else-if="!queried && error === null"
      class="rounded-[var(--lumin-radius-md)] border border-dashed border-[var(--lumin-color-border, #e0e0e6)] px-4 py-6"
    >
      <NText depth="2" class="text-sm">
        留空点击「查询」列出全部监听端口，或输入 1–65535 精确查询；结束进程不可撤销。
      </NText>
    </div>

    <!-- 报错态 -->
    <NAlert v-if="error !== null" type="error" :bordered="false" title="查询失败">
      <div class="flex flex-wrap items-center gap-2">
        <span class="text-sm">{{ error.message }}（{{ error.code }}）</span>
        <NButton size="tiny" @click="query">重试</NButton>
      </div>
      <p v-if="error.detail !== undefined" class="mt-1 break-all text-xs">{{ error.detail }}</p>
    </NAlert>

    <!-- 结果表 -->
    <div
      v-if="!loading && rows.length > 0"
      class="max-h-96 overflow-auto rounded-[var(--lumin-radius-md)] border border-[var(--lumin-color-border, #e0e0e6)]"
    >
      <table class="w-full border-collapse text-left text-sm">
        <thead class="sticky top-0 bg-[var(--lumin-color-bg-elevated, #fafafc)]">
          <tr class="text-xs text-[var(--lumin-color-text-secondary)]">
            <th class="px-2 py-1.5 font-medium">协议</th>
            <th class="px-2 py-1.5 font-medium">本地地址</th>
            <th class="px-2 py-1.5 text-right font-medium">端口</th>
            <th class="px-2 py-1.5 font-medium">状态</th>
            <th class="px-2 py-1.5 text-right font-medium">PID</th>
            <th class="px-2 py-1.5 font-medium">进程名</th>
            <th class="px-2 py-1.5 font-medium">操作</th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="row in visibleRows"
            :key="`${row.protocol}-${row.localAddress}-${row.port}-${row.pid}`"
            class="border-t border-[var(--lumin-color-border, #e0e0e6)]"
          >
            <td class="px-2 py-1">{{ row.protocol }}</td>
            <td class="px-2 py-1 font-mono text-xs">{{ row.localAddress }}</td>
            <td class="px-2 py-1 text-right font-mono text-xs">{{ row.port }}</td>
            <td class="px-2 py-1 text-xs">{{ row.state === '' ? '—' : row.state }}</td>
            <td class="px-2 py-1 text-right font-mono text-xs">{{ row.pid }}</td>
            <td class="px-2 py-1 text-xs">{{ row.process === '' ? '—' : row.process }}</td>
            <td class="px-2 py-1">
              <NPopconfirm @positive-click="kill(row.pid)">
                <template #trigger>
                  <NButton size="tiny" quaternary type="error" :loading="killingPid === row.pid">
                    <Trash2 class="mr-1 h-3 w-3" />结束
                  </NButton>
                </template>
                确认结束进程 {{ row.process === '' ? '（未知）' : row.process }}（PID
                {{ row.pid }}）？该操作不可撤销。
              </NPopconfirm>
            </td>
          </tr>
        </tbody>
      </table>
      <NText v-if="visibleRows.length === 0" depth="3" class="block px-2 py-3 text-xs">
        过滤条件下没有匹配端口
      </NText>
    </div>

    <NText v-else-if="queried && rows.length === 0 && error === null" depth="3" class="text-sm">
      未查询到监听端口（可尝试清空端口条件后重试）
    </NText>
  </div>
</template>
