<!-- 薄页面：只 import 工具包 ToolView（AGENTS §2 壳零工具知识） -->
<script setup lang="ts">
import LifeCalculatorView from '@lumin/tool-life-calculator/renderer/ToolView.vue'

defineOptions({ name: 'LifeCalculatorToolPage' })
</script>

<template>
  <LifeCalculatorView />
</template>
