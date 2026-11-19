<!-- 薄页面：只 import 工具包 ToolView（AGENTS §2 壳零工具知识） -->
<script setup lang="ts">
import FileHasherView from '@lumin/tool-file-hasher/renderer/ToolView.vue'

defineOptions({ name: 'FileHasherToolPage' })
</script>

<template>
  <FileHasherView />
</template>
