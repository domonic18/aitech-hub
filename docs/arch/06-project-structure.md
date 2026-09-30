# 项目结构与 CLAUDE.md 体系

> 本文是骨架初始化(M1)的施工图:目录树、文件组织规则、CLAUDE.md 组织设计。
> M1 落盘后**以 CLAUDE.md 文件为准**,本文仅记录设计意图。

## 1. 完整目录结构(目标态)

```
aitech-hub/
├── CLAUDE.md                     # 根上下文(AI 上下文唯一入口,真相源是文件本身)
├── README.md                     # 项目简介 + 快速开始
├── Makefile                      # setup / dev / worker / lint / typecheck / test / check / build / migrate / seed / format
├── package.json                  # 单包;scripts: dev/build/start/worker/lint/typecheck/test/e2e/migrate
├── next.config.ts                # trailingSlash:true、images、standalone、headers
├── tsconfig.json / eslint.config.mjs / postcss.config.mjs / prettier 配置
├── .env.example                  # 全量环境变量(带注释);.env 不入库
├── .gitignore / .dockerignore
│
├── prisma/                       # ── schema 唯一真相源 ────────────────
│   ├── schema.prisma             # 全部模型(arch/03-data-model §2 的 Prisma 表达)
│   ├── migrations/               # SQL 迁移(0000_init 基线 → 日期增量,forward-only)
│   └── seed.ts                   # 四分类/站点配置,幂等 upsert
│
├── src/
│   ├── app/
│   │   ├── (site)/               # 公开站(RSC/ISR)
│   │   │   ├── layout.tsx        # 站点壳:Header/Footer
│   │   │   ├── page.tsx          # 首页
│   │   │   ├── [slug]/page.tsx   # 文章详情(中文编码 slug,arch/07-frontend §2)
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
│   │   │   ├── media/page.tsx    # 媒体库:图片/视频/文件 + 孤儿/断链/重复清洗(arch/08-media)
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
│   │   ├── slug.ts               # normalizeSlug 唯一入口(arch/07-frontend §2 红线)
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
│   └── nginx/                    # nginx.conf + conf.d/aitech-hub.conf(standard/02-cicd-deployment §4)
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
- 分支纪律:开发主线 `develop`;新功能建 `feature/<topic>` 等类型前缀分支 PR 合回 develop;`main` 只经 develop→main 的 PR 更新,禁直推
- 文档纪律:不主动建 .md;行为变更同步 CLAUDE.md;arch 文档写终态,过程进提交历史

## 3. 命名规范速查

| 对象 | 规范 | 示例 |
|------|------|------|
| 表名(Prisma `@@map`)| `<域前缀>_<实体>`,小写单数 | `content_post`、`user_account`、`stats_post_view_daily`、`legacy_url_map` |
| 域前缀 | content_ / user_ / stats_ / legacy_ / pay_(二期) | |
| Prisma 模型名 | PascalCase 领域名 | `Post`(`@@map("content_post")`)、`UserAccount`、`LegacyUrlMap` |
| 字段 | 完整单词,同一语义同一词;DB 列 snake_case(`@map`) | `viewsCount → views_count` |
| 约束/索引 | unique/普通索引 `uq_<table>_<cols>` / `idx_*`(schema `map` 显式落名);PK/FK 保留 Prisma 默认名 `*_pkey`/`*_fkey`(见 arch/03-data-model §3,保 CI introspect 对齐);枚举值不加 DB CHECK,应用层 Zod 管控 | `uq_content_post_slug` |
| 审计字段 | 业务表统一 `createdAt`/`updatedAt`(timestamptz,aware UTC) | |
| API JSON | camelCase 一致(单体内部无 query 参数历史包袱,统一 camelCase) | `postId`、`pageSize` |

## 4. CLAUDE.md 体系(单根文档)

单应用无需分目录多份;**根 CLAUDE.md 一份承担全部**,§1 的目录树即索引,M1 已落盘。

- **唯一真相源是根目录 `CLAUDE.md` 文件本身**,本文不复刻全文(此前的全文草案已删——副本必漂移,M1 后它与实际文件已出现缺漏),仅记录组织意图
- 更新纪律:规范/红线/文档索引变更直接改 `CLAUDE.md` 并随行为变更提交;本文仅在目录结构或组织方式调整时更新 §1/§2
- 二期爬虫/COS 同步进入 `worker/` 后,如规范膨胀再考虑拆 `worker/CLAUDE.md`;当前形态即根文档 + 本 docs 体系
