// KnowledgeView 各区块的弹窗表单字段定义。
// 从 KnowledgeView.vue 原样搬来，仅做静态数据抽离，字段内容保持一致。
import type { FieldDef } from '@/components/ModalForm.vue'

// ---- 踩坑库 ----
export const pitfallFields: FieldDef[] = [
  { key: 'title', label: '标题', required: true, span: 2 },
  { key: 'category', label: '分类', options: [
    { label: '前端', value: '前端' }, { label: '后端', value: '后端' },
    { label: '数据库', value: '数据库' }, { label: '运维', value: '运维' },
    { label: '工具', value: '工具' }, { label: '其他', value: '其他' },
  ] },
  { key: 'tags', label: '标签 (逗号分隔)', span: 2 },
  { key: 'problem', label: '问题描述', type: 'textarea', span: 2 },
  { key: 'solution', label: '解决方案', type: 'textarea', span: 2 },
]

// ---- F-KNW-02 决策日志（轻 ADR） ----
export const decisionFields: FieldDef[] = [
  { key: 'title', label: '决策标题', required: true, span: 2 },
  { key: 'context', label: '背景', type: 'textarea', span: 2 },
  { key: 'decision', label: '决策内容', type: 'textarea', span: 2 },
  { key: 'alternatives', label: '备选方案', type: 'textarea', span: 2 },
  { key: 'status', label: '状态', type: 'select', options: [
    { label: '提案中', value: 'proposed' }, { label: '已采纳', value: 'accepted' },
    { label: '已否决', value: 'rejected' }, { label: '被取代', value: 'superseded' },
  ] },
  { key: 'decidedAt', label: '决策日期', type: 'date' },
]

// ---- F-KNW-06 学习路径 ----
export const pathFields: FieldDef[] = [
  { key: 'title', label: '步骤标题', required: true },
  { key: 'goal', label: '目标说明', span: 2 },
  { key: 'step', label: '阶段序号' },
  { key: 'resource', label: '参考资源' },
  { key: 'status', label: '状态', type: 'select', options: [
    { label: '待开始', value: 'todo' }, { label: '进行中', value: 'doing' }, { label: '已完成', value: 'done' },
  ] },
]

// ---- F-KNW-08 创作台账：3D 项目 ----
export const threeDFields: FieldDef[] = [
  { key: 'name', label: '项目名', required: true },
  { key: 'tool', label: '工具', type: 'select', options: [
    { label: 'Blender', value: 'blender' }, { label: 'C4D', value: 'c4d' }, { label: 'Maya', value: 'maya' },
    { label: 'Unreal', value: 'unreal' }, { label: 'Unity', value: 'unity' }, { label: '其他', value: 'other' },
  ] },
  { key: 'category', label: '类别', type: 'select', options: [
    { label: '模型', value: 'model' }, { label: '场景', value: 'scene' }, { label: '动画', value: 'animation' }, { label: '渲染', value: 'render' },
  ] },
  { key: 'status', label: '状态', type: 'select', options: [
    { label: '规划中', value: 'planning' }, { label: '制作中', value: 'wip' }, { label: '已完成', value: 'done' }, { label: '归档', value: 'archived' },
  ] },
  { key: 'path', label: '文件路径' },
  { key: 'note', label: '备注', span: 2 },
]

// ---- F-KNW-09 创作台账：作品集 ----
export const portfolioFields: FieldDef[] = [
  { key: 'title', label: '作品名', required: true },
  { key: 'category', label: '类别', type: 'select', options: [
    { label: '代码', value: 'code' }, { label: '设计', value: 'design' }, { label: '写作', value: 'writing' },
    { label: '视频', value: 'video' }, { label: '其他', value: 'other' },
  ] },
  { key: 'url', label: '作品链接' },
  { key: 'path', label: '本地路径' },
  { key: 'status', label: '状态', type: 'select', options: [
    { label: '草稿', value: 'draft' }, { label: '已发布', value: 'published' }, { label: '已归档', value: 'archived' },
  ] },
  { key: 'note', label: '备注', span: 2 },
]
