<!-- 薄页面：只 import 工具包 ToolView（AGENTS §2 壳零工具知识） -->
<script setup lang="ts">
import DevToolboxView from '@lumin/tool-dev-toolbox/renderer/ToolView.vue'

defineOptions({ name: 'DevToolboxToolPage' })
</script>

<template>
  <DevToolboxView />
</template>
