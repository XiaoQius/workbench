<script setup lang="ts">
withDefaults(defineProps<{ text?: string }>(), { text: '暂无数据' })
</script>

<template>
  <div class="empty-wrap">
    <div class="empty-icon">◇</div>
    <div>{{ text }}</div>
  </div>
</template>
