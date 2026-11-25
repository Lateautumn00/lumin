<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import {
  Archive,
  Braces,
  Calculator,
  CalendarDays,
  ClipboardList,
  ChevronDown,
  ChevronRight,
  Clock,
  Copy,
  Crop,
  Download,
  Eraser,
  Eye,
  FileDiff,
  FileOutput,
  FilePen,
  FileCode,
  FileImage,
  Files,
  Film,
  FlaskConical,
  FolderCog,
  GitCompare,
  HardDrive,
  Hash,
  Image,
  Info,
  KeyRound,
  LayoutGrid,
  Monitor,
  Network,
  Palette,
  PencilLine,
  PiggyBank,
  Play,
  Printer,
  QrCode,
  RotateCw,
  Ruler,
  ScanSearch,
  ScanText,
  Scissors,
  Search,
  Settings,
  Stamp,
  Terminal,
  Timer,
  Wrench,
  type LucideIcon
} from '@lucide/vue'
import { NIcon } from 'naive-ui'
import type { ToolCategory } from '@lumin/plugin-api'
import { toolManifests } from '../../../tool-manifests'
import { t } from '../i18n/zh-CN'
import { TOOL_CATEGORY_LABEL_KEY, groupToolsByCategory } from './sidebar-groups'

const props = withDefaults(defineProps<{ collapsed?: boolean }>(), { collapsed: false })

const emit = defineEmits<{ navigate: []; expand: []; search: [] }>()

const route = useRoute()

const iconMap: Record<string, LucideIcon> = {
  calculator: Calculator,
  ruler: Ruler,
  'file-output': FileOutput,
  'flask-conical': FlaskConical,
  scissors: Scissors,
  download: Download,
  eye: Eye,
  image: Image,
  'file-pen': FilePen,
  'pencil-line': PencilLine,
  'file-code': FileCode,
  'file-diff': FileDiff,
  'file-image': FileImage,
  stamp: Stamp,
  eraser: Eraser,
  'rotate-cw': RotateCw,
  'layout-grid': LayoutGrid,
  files: Files,
  film: Film,
  hash: Hash,
  'scan-search': ScanSearch,
  braces: Braces,
  'qr-code': QrCode,
  'scan-text': ScanText,
  copy: Copy,
  crop: Crop,
  'hard-drive': HardDrive,
  'git-compare': GitCompare,
  'folder-cog': FolderCog,
  archive: Archive,
  clock: Clock,
  'calendar-days': CalendarDays,
  'clipboard-list': ClipboardList,
  'key-round': KeyRound,
  palette: Palette,
  'piggy-bank': PiggyBank,
  play: Play,
  printer: Printer,
  monitor: Monitor,
  network: Network,
  terminal: Terminal,
  timer: Timer,
  wrench: Wrench
}

/** 折叠为图标栏时的分类标识 */
const CATEGORY_ICON: Record<ToolCategory, LucideIcon> = {
  compute: Calculator,
  text: PencilLine,
  image: Image,
  document: Files,
  media: Film,
  file: Archive,
  misc: Wrench
}

const groups = computed(() => groupToolsByCategory(toolManifests.filter((tool) => !tool.hidden)))

/** 当前路由所属分类（用于自动展开，首次进入不显示“空导航”） */
function categoryForPath(path: string): ToolCategory | null {
  for (const group of groups.value) {
    if (group.tools.some((tool) => `/tools/${tool.id}` === path)) return group.category
  }
  return null
}

/** 手风琴折叠：默认展开当前工具所在分类，展开某分类时其余分类自动收起 */
const openCategory = ref<ToolCategory | null>(categoryForPath(route.path))

watch(
  () => route.path,
  (path) => {
    const category = categoryForPath(path)
    if (category !== null) openCategory.value = category
  }
)

function isOpen(category: ToolCategory): boolean {
  return openCategory.value === category
}

function toggle(category: ToolCategory): void {
  openCategory.value = openCategory.value === category ? null : category
}

/** 图标栏态：分类按钮作为“展开入口”，避免图标堆叠造成歧义 */
function onCategoryClick(category: ToolCategory): void {
  if (props.collapsed) {
    emit('expand')
    openCategory.value = category
    return
  }
  toggle(category)
}

function isCategoryActive(category: ToolCategory): boolean {
  return categoryForPath(route.path) === category
}

function iconFor(name: string): LucideIcon {
  return iconMap[name] ?? Wrench
}

const LINK_BASE =
  'group relative flex items-center rounded-[var(--lumin-radius-md)] text-sm no-underline transition-colors duration-150'

function linkClass(path: string): string {
  const active = route.path === path
  const layout = props.collapsed ? 'justify-center px-0 py-2.5' : 'gap-2.5 px-3 py-2'
  const tone = active
    ? 'bg-[var(--lumin-color-primary)] font-medium text-[var(--lumin-color-primary-contrast)] shadow-[var(--lumin-shadow-sm)]'
    : 'text-[var(--lumin-color-text-secondary)] hover:bg-[var(--lumin-color-surface-hover)] hover:text-[var(--lumin-color-text)]'
  return `${LINK_BASE} ${layout} ${tone}`
}

const CATEGORY_BASE =
  'flex w-full items-center rounded-[var(--lumin-radius-sm)] px-2 py-1.5 text-[11px] font-semibold tracking-wide transition-colors'

function categoryClass(category: ToolCategory): string {
  const layout = props.collapsed ? 'justify-center px-0' : 'gap-1.5'
  const tone =
    props.collapsed && isCategoryActive(category)
      ? 'bg-[var(--lumin-color-primary-soft)] text-[var(--lumin-color-primary)]'
      : 'text-[var(--lumin-color-text-tertiary)] hover:bg-[var(--lumin-color-surface-hover)] hover:text-[var(--lumin-color-text-secondary)]'
  return `${CATEGORY_BASE} ${layout} ${tone}`
}
</script>

<template>
  <div class="flex h-full min-h-0 flex-col">
    <div class="shrink-0 px-2.5 pt-3">
      <button
        type="button"
        data-testid="tool-search-open"
        :title="t('shell.search.open')"
        :aria-label="t('shell.search.open')"
        class="flex w-full items-center gap-2 rounded-[var(--lumin-radius-md)] border border-[var(--lumin-color-border)] bg-[var(--lumin-color-surface)] px-2.5 py-1.5 text-xs text-[var(--lumin-color-text-tertiary)] transition-colors hover:border-[var(--lumin-color-primary)] hover:text-[var(--lumin-color-text-secondary)]"
        :class="collapsed ? 'justify-center px-0 py-2' : ''"
        @click="emit('search')"
      >
        <NIcon :component="Search" :size="16" aria-hidden="true" />
        <template v-if="!collapsed">
          <span class="truncate">{{ t('shell.search.open') }}</span>
          <kbd
            class="ml-auto rounded-[var(--lumin-radius-sm)] border border-[var(--lumin-color-border)] bg-[var(--lumin-color-surface-muted)] px-1.5 py-0.5 text-[10px] font-medium"
          >
            {{ t('shell.search.shortcut') }}
          </kbd>
        </template>
      </button>
    </div>
    <nav class="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-2.5 pb-3 pt-2">
      <section v-for="group in groups" :key="group.category" class="flex flex-col gap-1">
        <button
          type="button"
          :class="categoryClass(group.category)"
          :aria-expanded="isOpen(group.category)"
          :title="collapsed ? t(TOOL_CATEGORY_LABEL_KEY[group.category]) : undefined"
          @click="onCategoryClick(group.category)"
        >
          <NIcon
            v-if="collapsed"
            :component="CATEGORY_ICON[group.category]"
            :size="18"
            aria-hidden="true"
          />
          <template v-else>
            <NIcon
              :component="isOpen(group.category) ? ChevronDown : ChevronRight"
              :size="14"
              aria-hidden="true"
            />
            <span class="min-w-0 truncate">{{ t(TOOL_CATEGORY_LABEL_KEY[group.category]) }}</span>
            <span
              class="ml-auto rounded-full bg-[var(--lumin-color-surface-muted)] px-1.5 text-[10px] font-medium tabular-nums text-[var(--lumin-color-text-tertiary)]"
            >
              {{ group.tools.length }}
            </span>
          </template>
        </button>
        <div v-show="!collapsed && isOpen(group.category)" class="flex flex-col gap-1">
          <RouterLink
            v-for="tool in group.tools"
            :key="tool.id"
            :to="`/tools/${tool.id}`"
            :class="linkClass(`/tools/${tool.id}`)"
            :title="collapsed ? tool.name : undefined"
            :aria-label="tool.name"
            :aria-current="route.path === `/tools/${tool.id}` ? 'page' : undefined"
            @click="emit('navigate')"
          >
            <NIcon :component="iconFor(tool.icon)" :size="16" aria-hidden="true" />
            <span :class="collapsed ? 'sr-only' : 'truncate'">{{ tool.name }}</span>
          </RouterLink>
        </div>
      </section>

      <div class="mt-auto flex flex-col gap-1 border-t border-[var(--lumin-color-border)] pt-3">
        <RouterLink
          to="/settings"
          :class="linkClass('/settings')"
          :title="collapsed ? t('shell.sidebar.settings') : undefined"
          :aria-label="t('shell.sidebar.settings')"
          :aria-current="route.path === '/settings' ? 'page' : undefined"
          @click="emit('navigate')"
        >
          <NIcon :component="Settings" :size="16" aria-hidden="true" />
          <span :class="collapsed ? 'sr-only' : 'truncate'">{{ t('shell.sidebar.settings') }}</span>
        </RouterLink>
        <RouterLink
          to="/about"
          :class="linkClass('/about')"
          :title="collapsed ? t('shell.sidebar.about') : undefined"
          :aria-label="t('shell.sidebar.about')"
          :aria-current="route.path === '/about' ? 'page' : undefined"
          @click="emit('navigate')"
        >
          <NIcon :component="Info" :size="16" aria-hidden="true" />
          <span :class="collapsed ? 'sr-only' : 'truncate'">{{ t('shell.sidebar.about') }}</span>
        </RouterLink>
      </div>
    </nav>
  </div>
</template>
