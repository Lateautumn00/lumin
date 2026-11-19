<!-- 薄页面：只 import 工具包 ToolView（AGENTS §2 壳零工具知识） -->
<script setup lang="ts">
import DuplicateFinderView from '@lumin/tool-duplicate-finder/renderer/ToolView.vue'

defineOptions({ name: 'DuplicateFinderToolPage' })
</script>

<template>
  <DuplicateFinderView />
</template>
