<script setup lang="ts">
// 开发工具主视图（M42）
// 作者：cuilanchao · 修改时间：2026-11-21
// 三页签：端口占用 / CURL 转代码 / 静态服务器；静态服务器跑在主进程，切走页签不打断
import { onMounted, onUnmounted, ref, watch } from 'vue'
import { NAlert, NButton, NTabPane, NTabs, NTag } from 'naive-ui'
import { toStructuredError, type StructuredError } from '@lumin/shared'
import { DEFAULT_SERVER_PORT, type AccessLog } from '../schema'
import { config, serverStart, serverStatus, serverStop, setConfig } from './client'
import PortsPanel from './PortsPanel.vue'
import CurlPanel from './CurlPanel.vue'
import ServerPanel from './ServerPanel.vue'

/** 服务器视图状态（与 IPC 出参同形） */
interface ServerView {
  running: boolean
  port?: number
  root?: string
  requests: AccessLog[]
}

/** 轮询间隔（ms） */
const POLL_INTERVAL_MS = 1000

const activeTab = ref('ports')
const root = ref('')
const port = ref<number>(DEFAULT_SERVER_PORT)
const status = ref<ServerView>({ running: false, requests: [] })
const busy = ref(false)
const error = ref<StructuredError | null>(null)
const loaded = ref(false)
let pollTimer: ReturnType<typeof setInterval> | null = null
let persistTimer: ReturnType<typeof setTimeout> | null = null

function stopPolling(): void {
  if (pollTimer === null) return
  clearInterval(pollTimer)
  pollTimer = null
}

function startPolling(): void {
  if (pollTimer !== null) return
  pollTimer = setInterval(() => {
    void refreshStatus()
  }, POLL_INTERVAL_MS)
}

async function refreshStatus(): Promise<void> {
  try {
    const next = await serverStatus()
    status.value = {
      running: next.running,
      requests: next.requests,
      ...(next.port !== undefined ? { port: next.port } : {}),
      ...(next.root !== undefined ? { root: next.root } : {})
    }
    if (!next.running) stopPolling()
  } catch {
    // 轮询失败不打断页面，下一次继续
  }
}

/** 记忆写回（失败静默，避免打断主流程） */
async function persist(): Promise<void> {
  try {
    await setConfig({ ...(root.value !== '' ? { root: root.value } : {}), port: port.value })
  } catch {
    // 配置记忆失败不影响本次操作
  }
}

function schedulePersist(): void {
  if (!loaded.value) return
  if (persistTimer !== null) clearTimeout(persistTimer)
  persistTimer = setTimeout(() => {
    persistTimer = null
    void persist()
  }, 400)
}

watch([root, port], schedulePersist)

async function startServer(): Promise<void> {
  if (busy.value) return
  if (root.value === '') {
    error.value = { code: 'DT_ROOT_INVALID', message: '请先选择服务器根目录' }
    return
  }
  error.value = null
  busy.value = true
  try {
    await serverStart({ root: root.value, port: port.value })
    loaded.value = true
    await persist()
    await refreshStatus()
    startPolling()
  } catch (err) {
    error.value = toStructuredError(err)
  } finally {
    busy.value = false
  }
}

async function stopServer(): Promise<void> {
  if (busy.value) return
  busy.value = true
  error.value = null
  try {
    await serverStop()
    await refreshStatus()
  } catch (err) {
    error.value = toStructuredError(err)
  } finally {
    busy.value = false
  }
}

function updateRoot(value: string): void {
  root.value = value
}

function updatePort(value: number): void {
  port.value = value
}

onMounted(async () => {
  try {
    const saved = await config()
    if (saved.root !== null) root.value = saved.root
    port.value = saved.port
  } catch {
    // 读取失败沿用默认值
  }
  loaded.value = true
  await refreshStatus()
  if (status.value.running) {
    if (status.value.root !== undefined) root.value = status.value.root
    startPolling()
  }
})

onUnmounted(() => {
  stopPolling()
  if (persistTimer !== null) clearTimeout(persistTimer)
})
</script>

<template>
  <div class="flex max-w-5xl flex-col gap-4">
    <div>
      <h1 class="text-base font-semibold">开发工具</h1>
      <p class="mt-1 text-sm text-[var(--lumin-color-text-secondary)]">
        端口占用查询与进程结束、CURL 命令转代码、本地静态服务器（全部本机运行，仅监听 127.0.0.1）
      </p>
    </div>

    <!-- 服务运行中常驻提示：跨页签不打断 -->
    <NAlert v-if="status.running" type="success" :bordered="false">
      <div class="flex flex-wrap items-center gap-2">
        <NTag size="small" type="success" :bordered="false">服务运行中</NTag>
        <span class="text-sm">http://127.0.0.1:{{ status.port ?? port }}/</span>
        <span class="text-xs text-[var(--lumin-color-text-secondary)]">
          切换页签后服务保持运行，可在「静态服务器」页签停止
        </span>
      </div>
    </NAlert>

    <!-- 页签仅作切换器（与 text-toolbox 同范式）：标签走 #tab 插槽，内容用 v-if 渲染 -->
    <NTabs v-model:value="activeTab" type="line">
      <NTabPane name="ports">
        <template #tab>端口占用</template>
      </NTabPane>
      <NTabPane name="curl">
        <template #tab>CURL 转代码</template>
      </NTabPane>
      <NTabPane name="server">
        <template #tab>静态服务器</template>
      </NTabPane>
    </NTabs>

    <PortsPanel v-if="activeTab === 'ports'" />
    <CurlPanel v-else-if="activeTab === 'curl'" />

    <div v-else class="flex flex-col gap-3">
      <ServerPanel
        :root="root"
        :port="port"
        :status="status"
        :busy="busy"
        @update:root="updateRoot"
        @update:port="updatePort"
        @start="startServer"
        @stop="stopServer"
      />

      <!-- 报错态：结构化错误码 → 中文文案 + 重试 -->
      <NAlert v-if="error !== null" type="error" :bordered="false" title="操作失败">
        <div class="flex flex-wrap items-center gap-2">
          <span class="text-sm">{{ error.message }}（{{ error.code }}）</span>
          <NButton size="tiny" @click="startServer">重试</NButton>
        </div>
        <p v-if="error.detail !== undefined" class="mt-1 break-all text-xs">
          {{ error.detail }}
        </p>
      </NAlert>
    </div>
  </div>
</template>
