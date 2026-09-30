# 项目结构与 CLAUDE.md 体系

> 本文是骨架初始化(M1)的施工图:目录树、文件组织规则、双层 CLAUDE.md 全文草案。
> M1 落盘后**以 CLAUDE.md 文件为准**,本文仅记录设计意图。

## 1. 完整目录结构(目标态)

```
aitech-hub/
├── CLAUDE.md                     # 根上下文(§3 全文草案)
├── README.md                     # 项目简介 + 快速开始
├── Makefile                      # setup / dev / worker / lint / test / check / build / migrate / openapi-free
├── package.json                  # 单包;scripts: dev/build/start/worker/lint/typecheck/test/e2e/migrate
├── next.config.ts                # trailingSlash:true、images、standalone、headers
├── tsconfig.json / eslint.config.mjs / postcss.config.mjs / prettier 配置
├── .env.example                  # 全量环境变量(带注释);.env 不入库
├── .gitignore / .dockerignore
│
├── prisma/                       # ── schema 唯一真相源 ────────────────
│   ├── schema.prisma             # 全部模型(02 文档 §2 的 Prisma 表达)
│   ├── migrations/               # SQL 迁移(0000_init 基线 → 日期增量,forward-only)
│   └── seed.ts                   # 四分类/站点配置,幂等 upsert
│
├── src/
│   ├── app/
│   │   ├── (site)/               # 公开站(RSC/ISR)
│   │   │   ├── layout.tsx        # 站点壳:Header/Footer
│   │   │   ├── page.tsx          # 首页
│   │   │   ├── [slug]/page.tsx   # 文章详情(中文编码 slug,04 文档 §3)
│   │   │   ├── articles/page.tsx # 全部文章(分页)
│   │   │   ├── category/[slug]/page.tsx
│   │   │   ├── tag/[slug]/page.tsx
│   │   │   ├── archive/page.tsx
│   │   │   ├── search/page.tsx
│   │   │   ├── about|agreement|privacy/page.tsx
│   │   │   ├── sitemap.ts / robots.ts / feed.xml/route.ts
│   │   │   └── legacy/[...path]/route.ts    # 旧 URL 301 兜底(legacy_url_map)
│   │   ├── (user)/               # 登录态页(CSR 为主)
│   │   │   ├── login/page.tsx
│   │   │   └── account/{profile,settings}/page.tsx
│   │   ├── (admin)/admin/        # 后台(AntD 5 + 客户端守卫 + API 双重校验)
│   │   │   ├── layout.tsx
│   │   │   ├── posts/{page,[id]/edit,new}/page.tsx
│   │   │   ├── media/page.tsx    # 媒体库:图片/视频/文件 + 孤儿/断链/重复清洗(08 文档)
│   │   │   ├── users/page.tsx
│   │   │   └── overview/page.tsx
│   │   ├── api/                  # Route Handlers(REST 风格,camelCase JSON)
│   │   │   ├── auth/{sms-code,login,logout,session}/route.ts
│   │   │   ├── posts/route.ts、posts/[id]/route.ts、posts/[id]/{publish,unpublish}/route.ts
│   │   │   ├── media/route.ts、media/[id]/route.ts、media/{orphans,duplicates,stats}/route.ts
│   │   │   ├── users/route.ts、users/[id]/route.ts
│   │   │   ├── view/route.ts     # 浏览计数(去重窗口)
│   │   │   ├── revalidate/route.ts
│   │   │   └── health/route.ts
│   │   └── layout.tsx            # 根布局:字体/主题/providers
│   ├── components/               # 按 domain 分包:site/ article/ auth/ admin/ media/
│   ├── lib/
│   │   ├── db.ts                 # Prisma client 单例
│   │   ├── redis.ts              # Redis 单例
│   │   ├── env.ts                # Zod env schema,启动即校验
│   │   ├── auth/                 # session(jose cookie)/ sms(腾讯云)/ rate-limit
│   │   ├── media/                # storage(LocalDisk→COS Provider)/ refs(引用解析)/ rules(类型白名单)
│   │   ├── content/              # post service(保存钩子:slug/引用解析/revalidate 触发)
│   │   ├── slug.ts               # normalizeSlug 唯一入口(04 文档 §3 红线)
│   │   ├── seo/                  # metadata/jsonld/sitemap 构造
│   │   ├── queue.ts              # BullMQ producer(enqueue 封装)
│   │   └── api-client.ts         # 前端 fetch 封装(Zod 校验响应)
│   ├── stores/                   # Zustand:session
│   ├── styles/                   # globals.css、prose.css(旧 HTML 正文兜底)
│   └── types/                    # 手写补充类型(领域类型与 Zod schema 同源)
│
├── worker/                       # BullMQ worker 进程(独立入口,同镜像 cmd 覆盖)
│   ├── index.ts                  # 队列注册、优雅退出
│   └── processors/               # media-process.ts(sharp 缩略图/WebP)、二期: cos-sync、crawler
│
├── scripts/
│   ├── setup-local.sh            # cp .env / npm install / compose up pg,redis / migrate / seed
│   └── migrate-wp/               # TS 一次性迁移:extract(mysql2)/ transform(cheerio,共享 src/lib/slug)/
│                                 #   media-manifest / load(pg)/ verify / run(dry-run 支持)
│                                 #   fixtures/ WP 真实导出 HTML(clean-html 等单测共用)
├── e2e/                          # Playwright:首页/中文 slug 文章页/301/登录/sitemap
├── docker/
│   ├── Dockerfile                # 多阶段:deps → next build(standalone)→ runner(web+worker 同镜像)
│   ├── entrypoint.sh             # 容器入口:web 先 migrate deploy + ISR 预热;worker 直起
│   └── nginx/                    # nginx.conf + conf.d/aitech-hub.conf(07 文档 §4)
├── docs/                         # 本文档体系(索引 docs/README.md)
├── public/                       # 静态字节资源(favicon 等)
│
├── docker-compose.yml            # dev:postgres(5434)/ redis(6380)
├── docker-compose.prod.yml       # prod:nginx / web / worker / redis / postgres(mem_limit 全线)
└── workspace/                    # 宿主机持久化数据(pg/redis 数据、迁移媒体、ssl、backups;gitignore,不入库)
```

## 2. 文件组织与代码规则(全仓强制)

- 文件 ≤350 行,单一职责;大文件拆 utils/常量/类型/子组件,不建 `misc`/`common` 垃圾抽屉
- 命名:组件 PascalCase,hook `use` 前缀,工具小写连字符,常量 UPPER_SNAKE;导入别名 `@/`
- 常量分层:env 可调 → `lib/env.ts`(Zod);跨模块领域常量 → `lib/constants.ts`;模块私有 → 模块顶部
- Server Component 默认,`"use client"` 尽量下沉到叶子;请求内**禁止**秒级以上处理,重任务一律 BullMQ
- 数据库:schema 只经 `prisma/migrations/` 变更(forward-only,已应用禁改);执行 `npx prisma migrate deploy`;`lib/db.ts` 是 Prisma client 唯一实例
- Zod schema 与 TS 类型同源(`z.infer`),API 输入/`api-client` 响应双端校验
- 安全:外部输入边界校验;密钥仅 env;CORS/Origin 白名单;上传类型+大小白名单;日志不落敏感值
- 提交纪律:Conventional Commits;`make check` 过了才提交;husky + lint-staged(eslint/prettier);未经用户批准不 commit
- 文档纪律:不主动建 .md;行为变更同步 CLAUDE.md;arch 文档写终态,过程进提交历史

## 3. 命名规范速查

| 对象 | 规范 | 示例 |
|------|------|------|
| 表名(Prisma `@@map`)| `<域前缀>_<实体>`,小写单数 | `content_post`、`user_account`、`stats_post_view_daily`、`legacy_url_map` |
| 域前缀 | content_ / user_ / stats_ / legacy_ / pay_(二期) | |
| Prisma 模型名 | PascalCase 领域名 | `Post`(`@@map("content_post")`)、`UserAccount`、`LegacyUrlMap` |
| 字段 | 完整单词,同一语义同一词;DB 列 snake_case(`@map`) | `viewsCount → views_count` |
| 约束/索引 | `pk_` `uq_<table>_<cols>` `fk_` `idx_` `chk_`(migration SQL 内手写校验) | |
| 审计字段 | 业务表统一 `createdAt`/`updatedAt`(timestamptz,aware UTC) | |
| API JSON | camelCase 一致(单体内部无 query 参数历史包袱,统一 camelCase) | `postId`、`pageSize` |

## 4. CLAUDE.md 体系(双层)

单应用无需分目录三份;**根 CLAUDE.md 一份承担全部**,§1 的目录树即索引。M1 落盘全文如下:

````markdown
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
- 文档:requirement/(需求基准)arch/(终态方案)plan/development-plan.md(状态真相源)

| 主题 | 文档 |
|------|------|
| 目录与规范细节 | docs/arch/01 |
| 表结构/迁移纪律 | docs/arch/02 |
| WP 迁移映射与红线 | docs/arch/03 |
| 中文 slug 路由红线 | docs/arch/04 §3 |
| 媒体/视频/清洗 | docs/arch/08 |

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
````

> 二期爬虫/COS 同步进入 `worker/` 后,如规范膨胀再考虑拆 `worker/CLAUDE.md`;当前双层即根文档 + 本 docs 体系。
