<script setup lang="ts">
/**
 * @file 工具搜索浮层（Ctrl K）：模糊匹配工具名 / id / 分类，键盘选择并打开
 * @author cuilanchao
 * @date 2026-11-24
 * @description 仅壳级 UI：结果来自 toolManifests（壳零工具知识），分类名走 i18n；
 *              空态提示 / 无结果提示 / ↑↓ 选择 / Enter 打开 / Esc 关闭。
 */
import { computed, nextTick, ref, watch } from 'vue'
import { NIcon, NInput, NModal } from 'naive-ui'
import { Search } from '@lucide/vue'
import type { ToolCategory } from '@lumin/plugin-api'
import { toolManifests } from '../../../tool-manifests'
import { t } from '../i18n/zh-CN'
import { TOOL_CATEGORY_LABEL_KEY } from './sidebar-groups'
import { searchTools, type SearchResult } from './tool-search'

const props = defineProps<{ show: boolean }>()

const emit = defineEmits<{ 'update:show': [value: boolean]; select: [id: string] }>()

const query = ref('')
const activeIndex = ref(0)
const inputRef = ref<InstanceType<typeof NInput> | null>(null)

const results = computed<SearchResult[]>(() =>
  searchTools(toolManifests, query.value, {
    limit: 8,
    categoryLabel: (category: ToolCategory) => t(TOOL_CATEGORY_LABEL_KEY[category])
  })
)
const hasQuery = computed(() => query.value.trim() !== '')

/** 分类展示名 */
function categoryLabel(category: ToolCategory): string {
  return t(TOOL_CATEGORY_LABEL_KEY[category])
}

/** 显隐回传（遮罩点击 / Esc 由 NModal 触发） */
function onShowChange(value: boolean): void {
  emit('update:show', value)
}

/** 打开结果并关闭浮层 */
function openResult(result: SearchResult | undefined): void {
  if (result === undefined) return
  emit('select', result.id)
  emit('update:show', false)
}

/** 上下移动选中项（循环） */
function moveActive(step: number): void {
  const total = results.value.length
  if (total === 0) return
  activeIndex.value = (activeIndex.value + step + total) % total
}

/** 输入框键盘导航 */
function onInputKeydown(event: KeyboardEvent): void {
  if (event.key === 'ArrowDown') {
    event.preventDefault()
    moveActive(1)
    return
  }
  if (event.key === 'ArrowUp') {
    event.preventDefault()
    moveActive(-1)
    return
  }
  if (event.key === 'Enter') {
    event.preventDefault()
    openResult(results.value[activeIndex.value])
    return
  }
  if (event.key === 'Escape') {
    event.preventDefault()
    emit('update:show', false)
  }
}

watch(
  () => props.show,
  (visible) => {
    if (!visible) return
    query.value = ''
    activeIndex.value = 0
    void nextTick(() => inputRef.value?.focus())
  }
)

watch(query, () => {
  activeIndex.value = 0
})
</script>

<template>
  <NModal
    :show="show"
    preset="card"
    :bordered="false"
    :auto-focus="false"
    :style="{ width: 'min(560px, 92vw)' }"
    :title="t('shell.search.title')"
    @update:show="onShowChange"
  >
    <div class="flex flex-col gap-3" data-testid="tool-search-overlay">
      <NInput
        ref="inputRef"
        v-model:value="query"
        clearable
        :placeholder="t('shell.search.placeholder')"
        @keydown="onInputKeydown"
      >
        <template #prefix>
          <NIcon :component="Search" :size="16" aria-hidden="true" />
        </template>
      </NInput>

      <ul
        v-if="results.length > 0"
        class="flex max-h-[320px] flex-col gap-1 overflow-y-auto"
        role="listbox"
        :aria-label="t('shell.search.title')"
      >
        <li v-for="(item, index) in results" :key="item.id" role="none">
          <button
            type="button"
            role="option"
            data-testid="tool-search-result"
            :data-tool-id="item.id"
            :aria-selected="index === activeIndex"
            class="flex w-full items-center gap-3 rounded-[var(--lumin-radius-md)] px-3 py-2 text-left transition-colors"
            :class="
              index === activeIndex
                ? 'bg-[var(--lumin-color-primary-soft)] text-[var(--lumin-color-primary)]'
                : 'text-[var(--lumin-color-text)] hover:bg-[var(--lumin-color-surface-hover)]'
            "
            @mouseenter="activeIndex = index"
            @click="openResult(item)"
          >
            <span class="min-w-0 flex-1 truncate text-sm font-medium">{{ item.name }}</span>
            <span
              class="shrink-0 rounded-full bg-[var(--lumin-color-surface-muted)] px-2 py-0.5 text-[11px] text-[var(--lumin-color-text-tertiary)]"
            >
              {{ categoryLabel(item.category) }}
            </span>
          </button>
        </li>
      </ul>

      <p
        v-else-if="hasQuery"
        data-testid="tool-search-empty"
        class="rounded-[var(--lumin-radius-md)] border border-dashed border-[var(--lumin-color-border)] px-3 py-6 text-center text-sm text-[var(--lumin-color-text-tertiary)]"
      >
        {{ t('shell.search.noResult') }}
      </p>

      <p v-else class="px-1 text-sm text-[var(--lumin-color-text-tertiary)]">
        {{ t('shell.search.tip') }}
      </p>

      <p class="px-1 text-[11px] text-[var(--lumin-color-text-tertiary)]">
        {{ t('shell.search.keys') }}
      </p>
    </div>
  </NModal>
</template>
