import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import UnoCSS from 'unocss/vite'
import { fileURLToPath, URL } from 'node:url'

// Tauri 2 推荐配置：固定端口 1420，strictPort，忽略 src-tauri 变更
export default defineConfig({
  plugins: [vue({ template: { compilerOptions: { cacheHandlers: false } } }), UnoCSS()],
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    watch: {
      ignored: ['**/src-tauri/**'],
    },
  },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  build: {
    target: 'es2021',
    outDir: 'dist',
    rollupOptions: {
      output: {
        // naive-ui 独立 chunk:与视图代码隔离作用域,修复生产包里 @click 函数引用被错绑的 bug
        manualChunks: {
          naive: ['naive-ui'],
        },
      },
    },
  },
})
