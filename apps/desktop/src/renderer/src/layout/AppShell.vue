<script setup lang="ts">
/**
 * @file 应用壳：响应式侧栏（展开 / 图标栏 / 窄屏抽屉）+ 内容区 + 状态栏
 * @author cuilanchao
 * @date 2026-11-23
 * @description 侧栏宽度随窗口尺寸自适应：≥1024px 可展开 248px；768–1023px 收为 76px 图标栏；
 *              <768px 改为顶栏 + 抽屉。用户手动收起/展开偏好写入 localStorage（仅壳状态）。
 */
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { Lightbulb, Menu, PanelLeftClose, PanelLeftOpen, X } from '@lucide/vue'
import { t } from '../i18n/zh-CN'
import AppSidebar from './AppSidebar.vue'
import StatusBar from './StatusBar.vue'
import ToolSearchOverlay from './ToolSearchOverlay.vue'

/** 侧栏展开偏好（仅 UI 状态，不涉及主进程设置） */
const NAV_PREF_KEY = 'lumin.shell.nav.collapsed'

const route = useRoute()
const router = useRouter()
const viewportWidth = ref(window.innerWidth)
const overlayOpen = ref(false)
const searchOpen = ref(false)
const manualCollapsed = ref<boolean | null>(readNavPreference())
const menuButtonRef = ref<HTMLElement | null>(null)
const drawerRef = ref<HTMLElement | null>(null)

/** 窄屏：改用抽屉，不占用横向空间 */
const isCompact = computed(() => viewportWidth.value < 768)
/** 中等屏：默认收成图标栏 */
const autoCollapsed = computed(() => viewportWidth.value < 1024)
const collapsed = computed(() =>
  isCompact.value ? false : (manualCollapsed.value ?? autoCollapsed.value)
)

function readNavPreference(): boolean | null {
  try {
    const stored = window.localStorage.getItem(NAV_PREF_KEY)
    if (stored === 'true') return true
    if (stored === 'false') return false
  } catch {
    // localStorage 不可用时回退自动布局
  }
  return null
}

function persistNavPreference(value: boolean): void {
  try {
    window.localStorage.setItem(NAV_PREF_KEY, String(value))
  } catch {
    // 忽略写入失败：下次仍按窗口宽度自动判断
  }
}

function toggleNav(): void {
  if (isCompact.value) {
    if (overlayOpen.value) {
      closeOverlay()
    } else {
      openOverlay()
    }
    return
  }
  const next = !collapsed.value
  manualCollapsed.value = next
  persistNavPreference(next)
}

/** 打开抽屉：焦点移入抽屉，优先聚焦当前页链接 */
function openOverlay(): void {
  overlayOpen.value = true
  void nextTick(() => {
    const drawer = drawerRef.value
    if (drawer === null) return
    const target =
      drawer.querySelector<HTMLElement>('nav a[aria-current="page"]') ??
      drawer.querySelector<HTMLElement>('nav a[href]') ??
      drawer.querySelector<HTMLElement>('button')
    target?.focus()
  })
}

/** 关闭抽屉：焦点归还顶栏菜单按钮（弹层模式的焦点闭环） */
function closeOverlay(): void {
  if (!overlayOpen.value) return
  overlayOpen.value = false
  void nextTick(() => menuButtonRef.value?.focus())
}

/** 图标栏下点击分类：展开侧栏并展示该分类 */
function expandNav(): void {
  manualCollapsed.value = false
  persistNavPreference(false)
}

function onResize(): void {
  viewportWidth.value = window.innerWidth
  if (!isCompact.value) overlayOpen.value = false
}

/** 打开工具搜索浮层（侧栏按钮入口） */
function openSearch(): void {
  searchOpen.value = true
}

/** 打开搜索结果：关闭浮层与窄屏抽屉，跳转到对应工具 */
function selectTool(id: string): void {
  searchOpen.value = false
  closeOverlay()
  void router.push(`/tools/${id}`)
}

function onKeydown(event: KeyboardEvent): void {
  // Ctrl/Cmd + K：任意位置唤起工具搜索（输入框内同样生效）
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
    event.preventDefault()
    searchOpen.value = !searchOpen.value
    return
  }
  if (!overlayOpen.value || !isCompact.value) return
  if (event.key === 'Escape') {
    event.preventDefault()
    closeOverlay()
    return
  }
  // Tab 焦点陷阱：抽屉打开期间焦点不逃逸到被遮罩的内容区
  if (event.key !== 'Tab') return
  const drawer = drawerRef.value
  if (drawer === null) return
  const focusables = Array.from(
    drawer.querySelectorAll<HTMLElement>(
      'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
    )
  ).filter((el) => el.getClientRects().length > 0)
  if (focusables.length === 0) return
  const first = focusables[0]
  const last = focusables[focusables.length - 1]
  if (first === undefined || last === undefined) return
  const active = document.activeElement
  if (!(active instanceof HTMLElement) || !drawer.contains(active)) {
    event.preventDefault()
    first.focus()
    return
  }
  if (event.shiftKey && active === first) {
    event.preventDefault()
    last.focus()
  } else if (!event.shiftKey && active === last) {
    event.preventDefault()
    first.focus()
  }
}

watch(
  () => route.path,
  () => closeOverlay()
)

onMounted(() => {
  viewportWidth.value = window.innerWidth
  window.addEventListener('resize', onResize, { passive: true })
  window.addEventListener('keydown', onKeydown)
})

onUnmounted(() => {
  window.removeEventListener('resize', onResize)
  window.removeEventListener('keydown', onKeydown)
})
</script>

<template>
  <div
    class="relative flex h-full flex-col overflow-hidden bg-[var(--lumin-color-bg)] text-[var(--lumin-color-text)]"
  >
    <div class="lumin-atmosphere" aria-hidden="true" />

    <!-- 窄屏顶栏：提供抽屉入口 -->
    <header
      v-if="isCompact"
      class="relative z-20 flex h-[var(--lumin-topbar-height)] shrink-0 items-center gap-2 border-b border-[var(--lumin-color-border)] bg-[var(--lumin-color-surface)] px-3"
    >
      <button
        ref="menuButtonRef"
        type="button"
        class="flex h-9 w-9 items-center justify-center rounded-[var(--lumin-radius-md)] transition-colors"
        :class="
          overlayOpen
            ? 'bg-[var(--lumin-color-primary-soft)] text-[var(--lumin-color-primary)]'
            : 'text-[var(--lumin-color-text-secondary)] hover:bg-[var(--lumin-color-surface-hover)] hover:text-[var(--lumin-color-text)]'
        "
        :aria-label="t('shell.nav.menu')"
        :aria-expanded="overlayOpen"
        @click="toggleNav"
      >
        <Menu :size="18" />
      </button>
      <span class="lumin-brand-mark" aria-hidden="true"><Lightbulb :size="15" /></span>
      <span class="truncate text-sm font-semibold tracking-tight">Lumin</span>
    </header>

    <div class="relative flex min-h-0 flex-1">
      <!-- 窄屏遮罩：淡入淡出 -->
      <Transition name="lumin-scrim">
        <div
          v-if="isCompact && overlayOpen"
          class="fixed inset-0 z-40 bg-[var(--lumin-color-scrim)]"
          @click="closeOverlay"
        />
      </Transition>

      <!-- 侧栏：桌面常驻（展开/图标栏），窄屏为抽屉（滑入滑出） -->
      <Transition :name="isCompact ? 'lumin-drawer' : ''">
        <aside
          v-if="!isCompact || overlayOpen"
          ref="drawerRef"
          :role="isCompact ? 'dialog' : undefined"
          :aria-modal="isCompact ? 'true' : undefined"
          :aria-label="isCompact ? t('shell.nav.menu') : undefined"
          class="lumin-sidebar-surface relative z-10 flex shrink-0 flex-col border-r border-[var(--lumin-color-border)]"
          :class="
            isCompact
              ? 'fixed inset-y-0 left-0 z-50 w-[280px] max-w-[86vw] shadow-[var(--lumin-shadow-lg)]'
              : collapsed
                ? 'w-[var(--lumin-sidebar-rail-width)]'
                : 'w-[var(--lumin-sidebar-width)]'
          "
        >
          <div
            class="flex h-[var(--lumin-topbar-height)] shrink-0 items-center gap-2 border-b border-[var(--lumin-color-border)] px-3"
          >
            <span class="lumin-brand-mark" aria-hidden="true"><Lightbulb :size="15" /></span>
            <span
              v-if="isCompact || !collapsed"
              class="min-w-0 truncate text-sm font-semibold tracking-tight"
            >
              Lumin
            </span>
            <button
              v-if="!isCompact"
              type="button"
              class="ml-auto flex h-8 w-8 items-center justify-center rounded-[var(--lumin-radius-sm)] text-[var(--lumin-color-text-tertiary)] transition-colors hover:bg-[var(--lumin-color-surface-hover)] hover:text-[var(--lumin-color-text)]"
              :title="collapsed ? t('shell.nav.expand') : t('shell.nav.collapse')"
              :aria-label="collapsed ? t('shell.nav.expand') : t('shell.nav.collapse')"
              @click="toggleNav"
            >
              <PanelLeftOpen v-if="collapsed" :size="16" />
              <PanelLeftClose v-else :size="16" />
            </button>
            <button
              v-else
              type="button"
              class="ml-auto flex h-8 w-8 items-center justify-center rounded-[var(--lumin-radius-sm)] text-[var(--lumin-color-text-tertiary)] transition-colors hover:bg-[var(--lumin-color-surface-hover)] hover:text-[var(--lumin-color-text)]"
              :title="t('shell.nav.close')"
              :aria-label="t('shell.nav.close')"
              @click="closeOverlay"
            >
              <X :size="17" />
            </button>
          </div>
          <AppSidebar
            :collapsed="!isCompact && collapsed"
            @navigate="closeOverlay"
            @expand="expandNav"
            @search="openSearch"
          />
        </aside>
      </Transition>

      <!-- 工具搜索浮层：结果来自清单，支持模糊匹配与键盘选择 -->
      <ToolSearchOverlay v-model:show="searchOpen" @select="selectTool" />

      <!-- 内容区：窗口变化时由 flex 自动重排；超宽屏限制阅读宽度 -->
      <main class="relative min-w-0 flex-1 overflow-auto">
        <div
          class="relative mx-auto flex h-full w-full max-w-[1440px] flex-col p-4 sm:p-5 lg:p-6 2xl:p-8"
        >
          <router-view />
        </div>
      </main>
    </div>

    <StatusBar class="relative z-10" />
  </div>
</template>
