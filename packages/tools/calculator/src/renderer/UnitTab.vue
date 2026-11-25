<script setup lang="ts">
/**
 * @file UnitTab.vue 单位换算页签（M79 由独立工具 unit-converter 并入计算器）
 * @author cuilanchao
 * @date 2026-11-25
 * @description 17 类单位双向换算 + 单位互换 + 收藏置顶，纯 renderer 无 IPC
 */
import { computed, ref } from 'vue'
import { NButton, NInput, NSelect } from 'naive-ui'
import { ArrowLeftRight, Star } from '@lucide/vue'
import { formatNumber } from '@lumin/shared'

import { convert, ConvertError } from '../units/convert'
import {
  CATEGORIES,
  findCategory,
  isCategoryId,
  type Category,
  type CategoryId,
  type ConsumptionUnit,
  type LinearUnit,
  type ResolutionUnit,
  type TempUnit
} from '../units/data'
import { sortWithFavorites, useFavoritesStore } from '../units/favorites'

type ResultState =
  | { readonly kind: 'empty' }
  | { readonly kind: 'error'; readonly message: string }
  | { readonly kind: 'ok'; readonly text: string }

const category = ref<CategoryId>('length')
const fromId = ref('m')
const toId = ref('km')
const valueInput = ref('')
const dpiInput = ref('96')
const favorites = useFavoritesStore()

const categoryOptions = CATEGORIES.map((item) => ({ label: item.name, value: item.id }))

const currentCategory = computed<Category>(() => findCategory(category.value) ?? CATEGORIES[0])

const favoriteIds = computed<string[]>(() => favorites.list(category.value))

const currentUnits = computed<
  readonly (LinearUnit | TempUnit | ResolutionUnit | ConsumptionUnit)[]
>(() => currentCategory.value.units)

const unitOptions = computed(() =>
  sortWithFavorites(currentUnits.value, favoriteIds.value).map((unit) => ({
    label: unit.name,
    value: unit.id
  }))
)

const result = computed<ResultState>(() => {
  const raw = valueInput.value
  if (raw.trim() === '') return { kind: 'empty' }
  const numeric = Number(raw)
  if (!Number.isFinite(numeric)) return { kind: 'error', message: '请输入有效数值' }
  try {
    const converted = convert(
      category.value,
      fromId.value,
      toId.value,
      numeric,
      Number(dpiInput.value)
    )
    return { kind: 'ok', text: formatNumber(converted) }
  } catch (err) {
    return { kind: 'error', message: err instanceof ConvertError ? err.message : '换算失败' }
  }
})

function onCategoryChange(value: string | number): void {
  const id = String(value)
  if (!isCategoryId(id)) return
  const next = findCategory(id) ?? CATEGORIES[0]
  category.value = next.id
  fromId.value = next.units[0].id
  toId.value = next.units[1].id
  dpiInput.value = String(next.id === 'resolution' ? next.dpiDefault : 96)
}

function swap(): void {
  const previousFrom = fromId.value
  fromId.value = toId.value
  toId.value = previousFrom
}

function isFavorite(unitId: string): boolean {
  return favoriteIds.value.includes(unitId)
}

function onToggleFavorite(unitId: string): void {
  favorites.toggle(category.value, unitId)
}
</script>

<template>
  <div class="flex h-full min-h-0 flex-col gap-3">
    <div class="flex items-center gap-2">
      <span class="text-sm text-[var(--lumin-color-text-secondary)]">换算类别</span>
      <div class="ml-auto w-44">
        <NSelect
          :value="category"
          :options="categoryOptions"
          aria-label="换算类别"
          @update:value="onCategoryChange"
        />
      </div>
    </div>

    <div
      class="flex flex-col gap-3 rounded-[var(--lumin-radius-md)] border border-[var(--lumin-color-border)] bg-[var(--lumin-color-surface)] p-4"
    >
      <div class="flex items-center gap-1.5">
        <div class="min-w-0 flex-1">
          <NSelect v-model:value="fromId" :options="unitOptions" aria-label="源单位" />
        </div>
        <NButton
          size="small"
          quaternary
          class="shrink-0"
          :aria-label="isFavorite(fromId) ? '取消收藏源单位' : '收藏源单位'"
          @click="onToggleFavorite(fromId)"
        >
          <Star
            :size="14"
            :fill="isFavorite(fromId) ? 'currentColor' : 'none'"
            :class="isFavorite(fromId) ? 'text-[var(--lumin-color-primary)]' : ''"
          />
        </NButton>
        <NButton size="small" quaternary class="shrink-0" aria-label="交换单位" @click="swap">
          <ArrowLeftRight :size="14" />
        </NButton>
        <div class="min-w-0 flex-1">
          <NSelect v-model:value="toId" :options="unitOptions" aria-label="目标单位" />
        </div>
        <NButton
          size="small"
          quaternary
          class="shrink-0"
          :aria-label="isFavorite(toId) ? '取消收藏目标单位' : '收藏目标单位'"
          @click="onToggleFavorite(toId)"
        >
          <Star
            :size="14"
            :fill="isFavorite(toId) ? 'currentColor' : 'none'"
            :class="isFavorite(toId) ? 'text-[var(--lumin-color-primary)]' : ''"
          />
        </NButton>
      </div>

      <div class="flex items-center gap-3">
        <div class="min-w-0 flex-1">
          <NInput
            v-model:value="valueInput"
            placeholder="输入数值"
            inputmode="decimal"
            aria-label="数值"
          />
        </div>
        <div class="flex min-h-8 min-w-0 flex-1 items-center justify-end">
          <span
            v-if="result.kind === 'error'"
            class="text-sm text-[var(--lumin-color-danger)]"
            role="alert"
          >
            {{ result.message }}
          </span>
          <span
            v-else-if="result.kind === 'ok'"
            class="text-lg font-semibold tabular-nums text-[var(--lumin-color-text)]"
          >
            = {{ result.text }}
          </span>
          <span v-else class="text-lg tabular-nums text-[var(--lumin-color-text-secondary)]">
            —
          </span>
        </div>
      </div>

      <div v-if="category === 'resolution'" class="flex flex-wrap items-center gap-2">
        <span class="text-sm text-[var(--lumin-color-text-secondary)]">DPI</span>
        <div class="w-32">
          <NInput v-model:value="dpiInput" inputmode="numeric" aria-label="DPI" />
        </div>
        <span class="text-xs text-[var(--lumin-color-text-secondary)]">
          1 英寸 = DPI 像素（常用 96 / 150 / 300）
        </span>
      </div>

      <p v-if="favoriteIds.length === 0" class="text-xs text-[var(--lumin-color-text-secondary)]">
        暂无收藏单位（点 ☆ 收藏，收藏后在下拉列表置顶）
      </p>
    </div>
  </div>
</template>
