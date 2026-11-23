<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRoute } from 'vue-router'
import {
  Archive,
  Braces,
  Calculator,
  ChevronDown,
  ChevronRight,
  Clock,
  Copy,
  Crop,
  Download,
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
  Palette,
  PencilLine,
  PiggyBank,
  Play,
  QrCode,
  RotateCw,
  Ruler,
  ScanText,
  Scissors,
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
import { t, type MessageKey } from '../i18n/zh-CN'
import { groupToolsByCategory } from './sidebar-groups'

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
  'rotate-cw': RotateCw,
  'layout-grid': LayoutGrid,
  files: Files,
  film: Film,
  hash: Hash,
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
  'key-round': KeyRound,
  palette: Palette,
  'piggy-bank': PiggyBank,
  play: Play,
  monitor: Monitor,
  terminal: Terminal,
  timer: Timer,
  wrench: Wrench
}

const CATEGORY_LABEL: Record<ToolCategory, MessageKey> = {
  compute: 'shell.sidebar.category.compute',
  text: 'shell.sidebar.category.text',
  image: 'shell.sidebar.category.image',
  document: 'shell.sidebar.category.document',
  media: 'shell.sidebar.category.media',
  file: 'shell.sidebar.category.file',
  misc: 'shell.sidebar.category.misc'
}

const groups = computed(() => groupToolsByCategory(toolManifests.filter((tool) => !tool.hidden)))

/** 手风琴折叠：默认全部折叠，展开某分类时其余分类自动收起 */
const openCategory = ref<ToolCategory | null>(null)

function isOpen(category: ToolCategory): boolean {
  return openCategory.value === category
}

function toggle(category: ToolCategory): void {
  openCategory.value = openCategory.value === category ? null : category
}

function iconFor(name: string): LucideIcon {
  return iconMap[name] ?? Wrench
}

function linkClass(path: string): string {
  const base =
    'flex items-center gap-2 rounded-[var(--lumin-radius-md)] px-3 py-2 text-sm no-underline'
  return route.path === path
    ? `${base} bg-[var(--lumin-color-primary)] text-white`
    : `${base} text-[var(--lumin-color-text-secondary)] hover:bg-[var(--lumin-color-surface)]`
}
</script>

<template>
  <nav class="flex h-full flex-col gap-2 overflow-y-auto p-3">
    <section v-for="group in groups" :key="group.category" class="flex flex-col gap-1">
      <button
        type="button"
        class="flex items-center gap-1 rounded-[var(--lumin-radius-md)] px-2 py-1 text-xs font-medium text-[var(--lumin-color-text-secondary)] hover:bg-[var(--lumin-color-surface)]"
        :aria-expanded="isOpen(group.category)"
        @click="toggle(group.category)"
      >
        <NIcon :component="isOpen(group.category) ? ChevronDown : ChevronRight" :size="14" />
        <span>{{ t(CATEGORY_LABEL[group.category]) }}</span>
        <span class="ml-auto opacity-60">{{ group.tools.length }}</span>
      </button>
      <div v-show="isOpen(group.category)" class="flex flex-col gap-1">
        <RouterLink
          v-for="tool in group.tools"
          :key="tool.id"
          :to="`/tools/${tool.id}`"
          :class="linkClass(`/tools/${tool.id}`)"
        >
          <NIcon :component="iconFor(tool.icon)" :size="16" />
          <span>{{ tool.name }}</span>
        </RouterLink>
      </div>
    </section>

    <div class="mt-auto flex flex-col gap-1 pt-2">
      <RouterLink to="/settings" :class="linkClass('/settings')">
        <NIcon :component="Settings" :size="16" />
        <span>{{ t('shell.sidebar.settings') }}</span>
      </RouterLink>
      <RouterLink to="/about" :class="linkClass('/about')">
        <NIcon :component="Info" :size="16" />
        <span>{{ t('shell.sidebar.about') }}</span>
      </RouterLink>
    </div>
  </nav>
</template>
