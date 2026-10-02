import { defineConfig } from 'drizzle-kit'

// drizzle-kit 配置：用于从 drizzle/schema.ts 生成迁移 SQL
// 运行时建表由 src/db/migrate.ts 的幂等迁移链负责（plugin-sql 直接执行）
export default defineConfig({
  schema: './drizzle/schema.ts',
  out: './drizzle/migrations',
  dialect: 'sqlite',
  dbCredentials: {
    url: './workbench.db',
  },
})
