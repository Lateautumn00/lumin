<!-- 薄页面：只 import 工具包 ToolView（AGENTS §2 壳零工具知识） -->
<script setup lang="ts">
import SystemInfoView from '@lumin/tool-system-info/renderer/ToolView.vue'

defineOptions({ name: 'SystemInfoToolPage' })
</script>

<template>
  <SystemInfoView />
</template>
