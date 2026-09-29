# aitech-hub 文档中心

> 一起AI技术(17aitech.com)全新重建项目。本文档体系参照 ai-invest-assisstant 的组织方式:
> **requirement/ 是需求基准,arch/ 是终态方案,plan/ 是迭代状态真相源**。
> 按需阅读,勿全量加载。

## 文档索引

### requirement/(需求基准)

| 文档 | 说明 |
|------|------|
| [01-requirement.md](requirement/01-requirement.md) | 项目定位、一期/二期功能范围、明确不做清单、非功能需求、数据迁移验收标准 |

### arch/(架构设计 · 终态方案)

| 文档 | 说明 | 阅读时机 |
|------|------|----------|
| [00-总体架构设计.md](arch/00-总体架构设计.md) | 技术选型(Next.js 全栈单体)、单体拓扑、部署架构、与旧 WP 共存与切换 | 首次进入项目必读 |
| [01-项目结构与CLAUDE.md体系.md](arch/01-项目结构与CLAUDE.md体系.md) | 目录组织规范、文件规则、根 CLAUDE.md 全文草案 | 新建任何目录/文件前 |
| [02-数据模型与迁移管理.md](arch/02-数据模型与迁移管理.md) | PostgreSQL 表设计(含视频字段)、Prisma Migrate 纪律 | 涉及表结构变更时 |
| [03-WordPress数据迁移设计.md](arch/03-WordPress数据迁移设计.md) | 迁移范围、字段映射、媒体策略、SEO 红线、迁移脚本与验证 | 做 M2 迁移脚本时 |
| [04-前端架构设计.md](arch/04-前端架构设计.md) | 渲染策略、中文编码 slug 路由红线、SEO 实现、API 层约定、管理后台 | 写页面/Handler 前 |
| [05-服务与异步任务设计.md](arch/05-服务与异步任务设计.md) | service 分层与事务边界、短信登录与会话、BullMQ 任务、接口清单 | 写 lib/ 或 worker/ 前 |
| [06-测试策略.md](arch/06-测试策略.md) | 单测红线清单、集成/E2E、迁移对账与重放守卫 | 写测试前 |
| [07-CICD与部署.md](arch/07-CICD与部署.md) | GitHub Actions 流水线、镜像、同服务器切换 runbook、备份 | 部署/发版时 |
| [08-媒体资源管理设计.md](arch/08-媒体资源管理设计.md) | 存储演进(本地→COS 不改 URL)、视频(COS 直链+B 站嵌入)、后台清洗管理 | 涉及媒体一切工作时 |

### research/(调研评估)

| 文档 | 说明 |
|------|------|
| [01-抖音采集与签名能力评估.md](research/01-抖音采集与签名能力评估.md) | Node 全栈下抖音签名能力的落地路线(结论:复用 Python signer sidecar,二期引入) |

### plan/(迭代计划 · 状态真相源)

| 文档 | 说明 |
|------|------|
| [development-plan.md](plan/development-plan.md) | M1~M6 里程碑与完成状态,二期后置池;**只在此维护状态,不回填过程** |

## 背景速览(新会话先看这里)

- 旧站:WordPress(17aitech.com),数据摸底结论见 [03-WordPress数据迁移设计.md](arch/03-WordPress数据迁移设计.md) §1
- **架构(2026-09-29 定稿)**:Next.js 15 全栈单体 + Prisma/PostgreSQL + Redis/BullMQ worker;单镜像部署,与旧 WP 同服务器原位切换
- 核心决策:只迁移原创内容(博客文章 142 篇 + 产品评测 12 篇),**3314 篇爬虫资讯弃用**;296 用户全量迁移,短信验证码登录(不做密码迁移);slug 为中文 percent-encoded,URL 必须原样保留
- **媒体(2026-09-29 定稿)**:图片一期本地磁盘、二期 COS(URL 不变演进);视频 COS 直传直链 + B 站嵌入;后台媒体库带引用追踪与孤儿/断链/重复清洗
- 分期:一期 = 内容站 + SEO 无损迁移 + 手机号登录;二期 = GitHub 项目展示、付费阅读(虎皮椒)、资讯管道(Crawlee + BullMQ)、giscus 评论
- **战略定位(2026-09-29 定稿,requirement §1)**:「一个人指挥智能体军团的公开实战档案」+「想了解 AI 人群的资深可信信息源」(信息差机会);内容双受众——给人也给智能体(llms.txt + 文章 md 直出与创作 MCP 一期交付,站点内容 MCP 二期);GitHub 联动"文章教用法、仓库给武器"
