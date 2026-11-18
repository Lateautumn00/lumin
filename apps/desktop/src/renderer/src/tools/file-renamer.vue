<!-- 薄页面：只 import 工具包 ToolView（AGENTS §2 壳零工具知识） -->
<script setup lang="ts">
import FileRenamerView from '@lumin/tool-file-renamer/renderer/ToolView.vue'

defineOptions({ name: 'FileRenamerToolPage' })
</script>

<template>
  <FileRenamerView />
</template>
