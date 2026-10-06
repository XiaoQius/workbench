<script setup lang="ts">
import { NButton } from 'naive-ui'

// tip / actionText 全部可选：老调用 <EmptyState :text="..."/> 渲染结果不变
withDefaults(
  defineProps<{
    text?: string
    /** 「接下来能做什么」的引导语，比 text 更具体一点，如「添加第一门课后，这里会显示本周课表」 */
    tip?: string
    /** 主要行动按钮文案；不传则不渲染按钮 */
    actionText?: string
  }>(),
  { text: '暂无数据', tip: '', actionText: '' },
)

const emit = defineEmits<{ action: [] }>()
</script>

<template>
  <div class="empty-wrap">
    <div class="empty-icon">◇</div>
    <div class="empty-text">{{ text }}</div>
    <div v-if="tip" class="empty-tip">{{ tip }}</div>
    <NButton
      v-if="actionText"
      class="empty-action"
      size="small"
      type="primary"
      ghost
      @click="emit('action')"
    >
      {{ actionText }}
    </NButton>
  </div>
</template>

<style scoped>
/* 只补引导态新增元素的样式：基础 .empty-wrap / .empty-icon 仍用 main.css 的既有定义 */
/* 主文案沿用 .empty-wrap 的 --wb-text-3，不另换色，保证老调用渲染完全一致 */
.empty-text {
  text-align: center;
}
.empty-tip {
  font-size: var(--wb-fs-sm);
  color: var(--wb-text-3);
  text-align: center;
  /* 引导语可能较长，手机上不要顶到边 */
  max-width: 42ch;
  line-height: var(--wb-lh-normal);
}
.empty-action {
  margin-top: 2px;
}
</style>
