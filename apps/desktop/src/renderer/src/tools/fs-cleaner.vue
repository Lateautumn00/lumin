<!-- 薄页面：只 import 工具包 ToolView（AGENTS §2 壳零工具知识） -->
<script setup lang="ts">
import FsCleanerView from '@lumin/tool-fs-cleaner/renderer/ToolView.vue'

defineOptions({ name: 'FsCleanerToolPage' })
</script>

<template>
  <FsCleanerView />
</template>
