# aitech-hub - Claude Code AI 上下文文件

## 1. 项目概览

- **愿景**:一起AI技术(17aitech.com)个人品牌内容站,替换旧 WordPress;SEO 是生命线
- **架构**:Next.js 15 全栈单体(App Router RSC/ISR + Route Handlers)+ Prisma/PostgreSQL
  + Redis/BullMQ worker;公开品牌与域名沿用 17aitech
- **关键约束**:旧文章 URL(中文 percent-encoded slug)原样可用;296 老用户短信登录继承;
  154 篇原创文章及其引用图片全量迁移;3314 篇爬虫资讯弃用(301 承接)

## 2. 项目结构

**⚠️ 执行任何任务前,先读本文件;涉及哪一层,再读 docs/ 对应 arch 文档(按需,勿全量加载)。**

- `src/app/(site|user|admin)/` 页面;`src/app/api/` Route Handlers;`src/lib/` 业务库(按 domain 分包)
- `prisma/` schema 唯一真相源;`worker/` BullMQ 异步任务;`scripts/migrate-wp/` WP 迁移
- `workspace/` 宿主机持久化数据(pg/redis 数据、迁移媒体、ssl 证书、backups),gitignore 不入库
- 文档:requirement/(需求基准)arch/(终态方案)plan/development-plan.md(状态真相源)

| 主题               | 文档            |
| ------------------ | --------------- |
| 目录与规范细节     | docs/arch/01    |
| 表结构/迁移纪律    | docs/arch/02    |
| WP 迁移映射与红线  | docs/arch/03    |
| 中文 slug 路由红线 | docs/arch/04 §3 |
| 媒体/视频/清洗     | docs/arch/08    |

## 3. 通用编码规范与 AI 指令

- 你最重要的工作是管理自己的上下文。规划变更前,务必先阅读相关文件。
- KISS、YAGNI、DRY;文件 ≤350 行;Server Component 默认,请求内禁秒级任务(进 BullMQ)。
- 未经用户批准不要提交到 git。不要主动创建 *.md/README。
- 永远不要模拟、不要占位符、不要省略代码;对想法的好坏坦率诚实。
- 安全:外部输入边界校验(Zod);密钥仅 env;日志记事件不记敏感值;Origin 校验 mutation。
- slug 红线:任何含 slug 的路由/查询必须经 `src/lib/slug.ts#normalizeSlug`,禁止直接用 params 查库。
- 数据库:schema 只经 prisma/migrations 变更(forward-only);跑 `npx prisma migrate deploy`;
  禁止改已应用迁移;禁止 create_all 式建表。
- 端口:本地 web:3000 / pg:5434 / redis:6380。

## 4. 任务完成后协议

1. `npm run typecheck && npm run lint && npm run test:unit`(一键 `make check`)
2. schema 有变更:`npx prisma migrate dev --create-only` 评审 SQL;验证从零重放
3. 行为变更同步 CLAUDE.md / docs 对应章节

# 重要指令提醒

按要求做;不多不少。
