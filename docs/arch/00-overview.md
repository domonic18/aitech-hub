# aitech-hub 总体架构设计

> 需求基准见 [requirement/01-requirement.md](../requirement/01-requirement.md)。本文档是终态方案。
> 2026-09-29 定稿:**Next.js 全栈单体**(评估过 Node 生态的任务队列 BullMQ 与爬虫 Crawlee/Playwright 后,权衡运维面最小化所做的选择)。

## 1. 技术选型

| 层 | 选型 | 说明 |
|----|------|------|
| 应用 | **Next.js 15(App Router)+ React 19 + TypeScript 5.x(strict)** | 公开站 RSC/ISR 承载 SEO;API 层 Route Handlers;admin 区 Ant Design 5,公开站 Tailwind + shadcn/ui |
| ORM | **Prisma + Prisma Migrate** | migrations 即 SQL 文件(可读、可评审),`_prisma_migrations` 台账 exactly-once;纪律承袭 ai-invest-assisstant SQL 台账制(§4) |
| 数据库 | **PostgreSQL 16** | 延续站内近期项目选择 |
| 缓存/队列 | **Redis 7 + BullMQ** | 验证码、会话吊销、频控、legacy 缓存;BullMQ 承载异步任务(媒体后处理等),独立 worker 进程 |
| 认证 | 手机验证码 + jose 签名 httpOnly Cookie 会话 | 无密码迁移;Redis 会话登记可吊销(arch/05-services §3) |
| 校验 | Zod(schema 与 TS 类型同源,前后端一份) | 替代跨服务 OpenAPI codegen——单体后类型天然共享 |
| 对象存储 | 一期本地磁盘;**视频与二期图片走 COS**,浏览器 STS 直传 | 演进路径与清洗能力见 [08-media.md](08-media.md) |
| 部署 | Docker Compose + 腾讯云 TCR,**单应用镜像**(web + worker 同镜像不同 cmd)+ Nginx | 与旧 WP 同服务器原位切换(§4) |
| CI | GitHub Actions | lint/typecheck/test/build 门禁 + 迁移重放守卫 + 镜像发布 |
| 测试 | Vitest(单测)+ Playwright(E2E) | 见 [standard/01-testing.md](../standard/01-testing.md) |

**二期已定方向**:GitHub 项目展示(GitHub API 同步)、付费阅读(虎皮椒)、AI 资讯管道(**Crawlee + BullMQ**,替代旧 WP 采集插件)、giscus 评论。

**刻意不做**(一期):爬虫模块(资讯已弃用)、对象存储自托管图片(本地磁盘起步)、微服务拆分、消息中间件(BullMQ+Redis 够用)。

## 2. 单体拓扑

```
aitech-hub/                      # 一个 Next.js 应用 + 一个 BullMQ worker(同一仓库同镜像)
├── src/app/                     # App Router:(site) 公开站 / (user) 登录态 / (admin) 后台 / api/ Route Handlers
├── src/lib/                     # db(prisma 单例)/ redis / auth / media / slug / seo / queue
├── prisma/                      # schema.prisma + migrations/(SQL)+ seed.ts —— schema 唯一真相源
├── worker/                      # BullMQ worker 进程:媒体后处理(缩略图/WebP)、二期爬虫与 COS 同步
├── scripts/migrate-wp/          # WP→PG 一次性迁移(TS:cheerio + mysql2 + pg,与主应用共享 slug/清洗工具)
├── e2e/                         # Playwright
├── docker/                      # Dockerfile(多阶段)+ nginx/
├── docs/                        # 本文档体系 + UI 原型(docs/prototypes/index.html)
├── docker-compose.yml           # dev:仅 pg(5434)/redis(6380),应用本地跑保热更
└── docker-compose.prod.yml      # prod:nginx + web + worker + redis + pg
```

**未来扩展规划落点**(占位,需求明确后细化):多渠道数据源 → [01-data-source.md](01-data-source.md);爬虫采集 → [02-data-collection.md](02-data-collection.md);AI Agent 体系 → [04-ai-agent.md](04-ai-agent.md)。三者均挂靠现有单体拓扑(worker 新增队列/库层新增 service),不引入新进程形态。

**单体带来的简化**(相对双服务方案):

- 类型一份:Zod schema 同源前后端,`lib/api-client.ts` 直接复用,无 codegen/契约漂移问题
- 数据访问一层:RSC 直查 Prisma(公开页零 HTTP 自调用),Route Handlers 只服务客户端交互与外部回调
- 部署一个应用镜像(worker 用同镜像 `command` 覆盖),Nginx 只需反代一个 upstream

**代价与对策**:

- API 与页面同进程,重任务会拖垮渲染 → 异步一律进 BullMQ(媒体处理/未来爬虫),请求内只做快读写
- 单体变大后边界模糊 → 目录按 domain 分包(`lib/media`、`lib/auth`),规则写入 CLAUDE.md,文件 ≤350 行

## 3. 数据与媒体架构

```
┌────────────────────────────────────────────────────────────────┐
│ Nginx(唯一 80/443 入口,SSL 终结)                             │
│  ├── /wp-content/uploads/* → workspace/media/(一期)→ COS(二期)│ ← URL 永不变
│  ├── /_next/*、页面         → web:3000(Next.js 单体)          │
│  ├── /feed/                 → 301 /feed.xml                    │
│  └── 未命中路由兜底          → /legacy/<path>(301 映射表)      │
└────────────────────────────────────────────────────────────────┘
                              │
        ┌─────────────────────┴────────────────────┐
        │  web:3000(Next.js)                      │
        │  RSC 直查 Prisma(ISR 页面)              │
        │  /api/* Route Handlers(客户端交互/回调) │
        └───────────────┬──────────────────────────┘
                        │ enqueue
                 ┌──────┴──────┐      ┌────────────┐
                 │ worker      │      │ Redis 7    │
                 │ (BullMQ)    │─────▶│ 队列/会话/  │
                 │ 媒体后处理   │      │ 验证码/频控 │
                 └──────────────┘     └────────────┘
                        │
                  PostgreSQL 16(唯一业务真相源)
```

- **媒体演进不改公网 URL**:一期 `/wp-content/uploads/**` → 本地 `workspace/media/`;二期切 COS 时 Nginx 反代 COS origin(或批量重写内容 URL 到 `media.17aitech.com` CDN 域,内容已在自家库,一条 SQL 的事)。细则见 arch/08-media。
- **视频一期就定框架**:`content_media.kind=video`,STS 直传 COS(不经应用服务器),MP4 原生播放 + B 站嵌入双模式;表字段现在就位,零补迁移。

## 4. 数据库迁移管理纪律(承袭 SQL 台账制,Prisma 承载)

| ai-invest-assisstant 纪律 | 本项目 Prisma 对应 |
|---------------------------|-------------------|
| `0001_baseline.sql` 全量幂等基线 | `prisma/migrations/0000_init/`(基线迁移,含全部一期表) |
| 按日期命名增量、forward-only、合并禁改 | `prisma migrate dev --create-only` 评审后应用;已应用迁移禁止修改 |
| `schema_migrations` 台账 exactly-once | `_prisma_migrations` 表,`prisma migrate deploy` 幂等 |
| `migrate.sh` 执行入口 | `npx prisma migrate deploy`(**起库健康后、起应用前必须执行**) |
| CI 从零重放守卫 | CI 起临时 PG → `migrate deploy` 全量 → 重放第二次不报错 → schema 断言 |
| seed SQL | `prisma/seed.ts`(四分类 + 站点配置,幂等 upsert) |

> 若更倾向保留手写 SQL 台账(`migrate.sh` + `prisma db execute`),机制可换回;默认推荐 Prisma Migrate,因为 schema 与迁移由同一工具保证一致性。

## 5. 部署架构与旧站共存

单台轻量服务器(现跑 WordPress 那台),**原位切换**:

```
阶段 A(开发期):旧站照常服务;新栈仅本地/服务器高位端口验证
阶段 B(切换日):Nginx 接管 80/443 → 新栈;旧 WP(Apache,127.0.0.1:9000)保留待命
阶段 C(观察 1~2 周):无回退需求后下线 WP 容器;mysql_data 与 uploads 留档
```

- 回滚 = Nginx upstream 切回 `127.0.0.1:9000`,分钟级;runbook 见 [standard/02-cicd-deployment.md](../standard/02-cicd-deployment.md) §5
- 镜像:`aitech-hub` 单镜像推 TCR(`ccr.ccs.tencentyun.com/domonic18/aitech-hub`),`APP_TAG` 钉 git 短 sha;web 与 worker 两个服务共用该镜像

## 6. 环境与端口

| 环境 | web | worker | postgres | redis | 备注 |
|------|-----|--------|----------|-------|------|
| 本地 dev | 3000 | 无端口(BullMQ worker) | **5434** | **6380** | 避开本机 agent-eval(5432)、ai-invest(5433/6379)已占端口 |
| 生产 | 3000(仅内网) | 无端口 | 5432(容器内) | 6379(容器内) | 仅 Nginx 对外 |

- 配置:`.env`(不入库)+ `.env.example` 全量登记;Zod 校验 env schema,缺项启动即报
- 日志:结构化 JSON(pino),request id 中间件;安全事件记录但不落敏感值

## 7. 关键风险与对策

| 风险 | 对策 |
|------|------|
| 弃用 3314 篇资讯导致域名权重下跌 | 已接受的决策;301 至列表页让权重收敛;Search Console 观察 |
| 中文 percent-encoded slug 路由匹配(App Router decode params,DB 存编码形态) | `normalizeSlug` 唯一入口 + 双列存储 + 专测钉死(arch/07-frontend §2) |
| Elementor 时代 HTML 正文样式残留 | 迁移白名单清洗(clean-html 标签/属性白名单),`prose.css` 兜底 |
| 同机 2C4G 跄全栈 | compose mem_limit 全线设置;重任务只进 worker;ISR 降频 |
| 老用户 52 个无手机号(2026-09-29 实库复核) | `pending_binding` 态,登录前强制绑定 |
| 单体进程内长任务阻塞渲染 | 纪律:请求内禁做秒级以上处理,一律 BullMQ(arch/08-media §4) |
