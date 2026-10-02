<script setup lang="ts">
import { computed } from 'vue'
import { moduleColor, modules } from '@/theme/tokens'
import { useThemeStore } from '@/stores/theme'

const props = defineProps<{ title: string; desc?: string; module?: string; actions?: boolean }>()
const themeStore = useThemeStore()
const accent = computed(() => moduleColor(props.module ?? 'home', themeStore.dark))
</script>

<template>
  <div class="page-header">
    <div class="page-title-row">
      <span class="accent-bar" :style="{ background: accent }"></span>
      <div>
        <h1 class="page-title">{{ title }}</h1>
        <p v-if="desc" class="page-desc">{{ desc }}</p>
      </div>
    </div>
    <div v-if="$slots.default" class="page-actions">
      <slot />
    </div>
  </div>
</template>

<style scoped>
.page-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 20px;
}
.page-title-row {
  display: flex;
  gap: 12px;
}
.page-title {
  margin: 0;
  font-size: 20px;
  font-weight: 650;
  letter-spacing: -0.01em;
}
.page-desc {
  margin: 4px 0 0;
  color: var(--wb-text-2);
  font-size: 12.5px;
}
.page-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  flex: none;
}
</style>
