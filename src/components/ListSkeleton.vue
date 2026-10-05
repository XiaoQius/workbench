<script setup lang="ts">
/**
 * 列表加载骨架屏。视图首屏还在查库时用它占位，
 * 避免切 Tab 时先闪一片空白再突然蹦出内容。
 */
withDefaults(defineProps<{ rows?: number; label?: string }>(), { rows: 4, label: '' })
</script>

<template>
  <div class="sk-wrap" aria-busy="true">
    <div v-if="label" class="sk-label">{{ label }}</div>
    <div v-for="i in rows" :key="i" class="sk-row" :style="{ animationDelay: `${(i - 1) * 80}ms` }">
      <div class="sk-bar sk-title" />
      <div class="sk-bar sk-meta" />
      <div class="sk-bar sk-tag" />
    </div>
  </div>
</template>

<style scoped>
.sk-wrap {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.sk-label {
  font-size: 12.5px;
  color: var(--wb-text-3);
  margin-bottom: 2px;
}
.sk-row {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 14px;
  border: 1px solid var(--wb-border);
  border-radius: var(--wb-radius-md);
  background: var(--wb-card);
}
.sk-bar {
  height: 10px;
  border-radius: 999px;
  background: var(--wb-card-alt);
  animation: sk-pulse 1.4s ease-in-out infinite;
}
.sk-title { width: 34%; }
.sk-meta { width: 22%; }
.sk-tag { width: 56px; margin-left: auto; }
@keyframes sk-pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.45; }
}
/* 系统「减少动效」开关打开时不要闪 */
@media (prefers-reduced-motion: reduce) {
  .sk-bar { animation: none; }
}
</style>
