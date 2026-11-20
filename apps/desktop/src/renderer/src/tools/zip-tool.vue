<!-- 薄页面：只 import 工具包 ToolView（AGENTS §2 壳零工具知识） -->
<script setup lang="ts">
import ZipToolView from '@lumin/tool-zip-tool/renderer/ToolView.vue'

defineOptions({ name: 'ZipToolPage' })
</script>

<template>
  <ZipToolView />
</template>
