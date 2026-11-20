<!-- 薄页面：只 import 工具包 ToolView（AGENTS §2 壳零工具知识） -->
<script setup lang="ts">
import FolderCompareView from '@lumin/tool-folder-compare/renderer/ToolView.vue'

defineOptions({ name: 'FolderCompareToolPage' })
</script>

<template>
  <FolderCompareView />
</template>
