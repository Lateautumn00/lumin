<script setup lang="ts">
import { computed } from 'vue'
import { useRoute } from 'vue-router'
import {
  Braces,
  Calculator,
  Download,
  FileOutput,
  FilePen,
  FileImage,
  Files,
  Film,
  FlaskConical,
  Hash,
  Image,
  Info,
  QrCode,
  Ruler,
  Scissors,
  Settings,
  Wrench,
  type LucideIcon
} from '@lucide/vue'
import { NIcon } from 'naive-ui'
import { toolManifests } from '../../../tool-manifests'
import { t } from '../i18n/zh-CN'

const route = useRoute()

const iconMap: Record<string, LucideIcon> = {
  calculator: Calculator,
  ruler: Ruler,
  'file-output': FileOutput,
  'flask-conical': FlaskConical,
  scissors: Scissors,
  download: Download,
  image: Image,
  'file-pen': FilePen,
  'file-image': FileImage,
  files: Files,
  film: Film,
  hash: Hash,
  braces: Braces,
  'qr-code': QrCode,
  wrench: Wrench
}

const sortedTools = computed(() => [...toolManifests].sort((a, b) => a.order - b.order))

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
  <nav class="flex h-full flex-col gap-1 p-3">
    <RouterLink
      v-for="tool in sortedTools"
      :key="tool.id"
      :to="`/tools/${tool.id}`"
      :class="linkClass(`/tools/${tool.id}`)"
    >
      <NIcon :component="iconFor(tool.icon)" :size="16" />
      <span>{{ tool.name }}</span>
    </RouterLink>

    <RouterLink to="/settings" class="mt-auto" :class="linkClass('/settings')">
      <NIcon :component="Settings" :size="16" />
      <span>{{ t('shell.sidebar.settings') }}</span>
    </RouterLink>
    <RouterLink to="/about" :class="linkClass('/about')">
      <NIcon :component="Info" :size="16" />
      <span>{{ t('shell.sidebar.about') }}</span>
    </RouterLink>
  </nav>
</template>
