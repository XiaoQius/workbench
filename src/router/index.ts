import { createRouter, createWebHashHistory } from 'vue-router'

// hash 模式：保留深链 #/dev?tab=projects 等
const router = createRouter({
  history: createWebHashHistory(),
  routes: [
    { path: '/', name: 'home', component: () => import('@/views/HomeView.vue'), meta: { module: 'home', title: '总览' } },
    { path: '/workspace', name: 'workspace', component: () => import('@/views/WorkspaceView.vue'), meta: { module: 'workspace', title: '工作台' } },
    { path: '/dev', name: 'dev', component: () => import('@/views/DevView.vue'), meta: { module: 'dev', title: '开发' } },
    // FileGuard（他人 WIP 页面）：先于 /ops 匹配，避免被 OpsView 吞掉
    { path: '/ops/fileguard', name: 'fileguard', component: () => import('@/views/FileGuardView.vue'), meta: { module: 'ops', title: '文件监管' } },
    { path: '/ops', name: 'ops', component: () => import('@/views/OpsView.vue'), meta: { module: 'ops', title: '运维' } },
    { path: '/life', name: 'life', component: () => import('@/views/LifeView.vue'), meta: { module: 'life', title: '生活' } },
    { path: '/study', name: 'study', component: () => import('@/views/StudyView.vue'), meta: { module: 'study', title: '学习' } },
    { path: '/knowledge', name: 'knowledge', component: () => import('@/views/KnowledgeView.vue'), meta: { module: 'knowledge', title: '知识' } },
    { path: '/inspiration', name: 'inspiration', component: () => import('@/views/InspirationView.vue'), meta: { module: 'inspiration', title: '灵感' } },
    { path: '/:pathMatch(.*)*', redirect: '/' },
  ],
})

export default router
