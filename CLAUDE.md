# aitech-hub - Claude Code AI 上下文文件

## 1. 项目概览

- **愿景**:一起AI(17aitech.com)AI 信息 Hub(连接用户与快速变化的 AI 信息:资讯/教程/示例项目;
  站长原创文章为核心渠道之一),替换旧 WordPress;SEO 是生命线
- **架构**:Next.js 15 全栈单体(App Router RSC/ISR + Route Handlers)+ Prisma/PostgreSQL
  + Redis/BullMQ worker;公开品牌与域名沿用 17aitech
- **关键约束**:文章 URL 终态 `/post/<id>-<slug>`(id 锚定,2026-10 迁移,旧中文链 301/410 承接);
  296 老用户短信登录继承(三期开启——运营商个人签名资质停发,一期仅 admin 密码鉴权);
  154 篇原创文章及其引用图片全量迁移;3314 篇爬虫资讯弃用(301 承接)

## 2. 项目结构

**⚠️ 执行任何任务前,先读本文件;涉及哪一层,再读 docs/ 对应 arch 文档(按需,勿全量加载)。**

- `src/app/(site|user|admin)/` 页面(用户中心落 `(site)/account` 共享站点壳,不开 `(user)` 组;悬浮 AI 助手挂 `(site)/layout` 全站);`src/app/api/` Route Handlers(admin API 按惯例落顶层域目录如 `/api/users`、`/api/feedback`,无 `/api/admin/` 命名空间);`src/lib/` 业务库(按 domain 分包)
- `prisma/` schema 唯一真相源;`worker/` BullMQ 异步任务;`scripts/` 分 ops/(长期运维,npm 绑定)与 oneoff/(一次性订正/清洗,应用后删除、git 历史存档),脚本 docblock 带 @status;`services/douyin-gateway/` 抖音数据网关(Python sidecar,独立镜像,契约 arch/05 §4.4)
- `workspace/` 宿主机持久化数据(pg/redis 数据、迁移媒体、ssl 证书、backups),gitignore 不入库
- 文档:requirement/(需求基准)arch/(终态方案)standard/(稳定规范)plan/development-plan.md(状态真相源)

| 主题                          | 文档                             |
| ----------------------------- | -------------------------------- |
| 数据源/采集/AI Agent          | docs/arch/01、02、04             |
| 表结构/迁移纪律               | docs/arch/03-data-model          |
| 服务分层/异步任务/接口清单    | docs/arch/05-services            |
| 目录与规范细节                | docs/arch/06-project-structure   |
| 文章 URL 终态(/post/id-slug) | docs/arch/07-frontend §2         |
| 媒体/视频/清洗                | docs/arch/08-media               |
| 公众号分发(微信草稿箱同步)   | docs/arch/05 §4.1 + arch/03 §2.4 |
| 搜索/AI 答案卡/Drawer 会话 Agent | docs/arch/04 §3(检索/答案卡/K2.5) |
| UI 原型(M4/M5 开发依据)      | docs/prototypes/index.html       |
| 原型设计规范(令牌/图标/组件) | docs/prototypes/DESIGN-SPEC.md   |
| 测试规范                      | docs/standard/01-testing         |
| CICD/分支模型/部署            | docs/standard/02-cicd-deployment |

## 3. 通用编码规范与 AI 指令

- 你最重要的工作是管理自己的上下文。规划变更前,务必先阅读相关文件。
- KISS、YAGNI、DRY;文件 ≤350 行(页面只留编排,拆片子组件入 `src/components/` 对应域目录,见 arch/06 §2);Server Component 默认,请求内禁秒级任务(进 BullMQ)。
- 未经用户批准不要提交到 git。不要主动创建 *.md/README。
- 分支:开发主线为 `develop`;新功能建 `feature/<topic>` 分支 PR 合回 develop;`main` 禁直推(只经 develop→main PR 发布)。
- 永远不要模拟、不要占位符、不要省略代码;对想法的好坏坦率诚实。
- 安全:外部输入边界校验(Zod);密钥仅 env;日志记事件不记敏感值;Origin 校验 mutation。
- slug 红线:文章详情以 BigInt id 解析(`/post/<id>-<slug>`,构造/解析唯一出口 `src/lib/content/post-path.ts`,
  非 canonical 段一律 308 归一);项目详情以冻结 slug 解析(`/projects/<slug>/`,构造唯一出口
  `src/lib/github/project-path.ts`,无 id 锚点错 slug 直接 404 不归一);分类/标签/legacy 仍经
  `src/lib/slug.ts#normalizeSlug`,禁止直接用 params 查库。
- 数据库:schema 只经 prisma/migrations 变更(forward-only);跑 `npx prisma migrate deploy`;
  禁止改已应用迁移;禁止 create_all 式建表。
- 端口:本地 web:3000 / pg:5434 / redis:6380。

## 4. 任务完成后协议

1. `npm run typecheck && npm run lint && npm run test:unit`(一键 `make check`)
2. schema 有变更:`npx prisma migrate dev --create-only` 评审 SQL;验证从零重放
3. 行为变更同步 CLAUDE.md / docs 对应章节
4. 提交遵循 §3 分支纪律:功能走 feature 分支 PR 合 develop;合并前 CI 绿

# 重要指令提醒

按要求做;不多不少。
