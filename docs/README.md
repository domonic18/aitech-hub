# aitech-hub 文档中心

> 本文件是文档体系的**使用说明**:文档怎么分层、写什么、什么时候读、怎么维护。
> 具体计划与进度不写在这里——状态只在 [plan/development-plan.md](plan/development-plan.md)
> 维护。按需阅读对应章节,勿全量加载。

## 一、分层与归属(决定新文档放哪)

判断标准是「这份文档回答什么问题、多久变一次」,不是它写得多长。

| 目录 | 定位 | 回答的问题 | 变更纪律 |
| --- | --- | --- | --- |
| `requirement/` | 需求基准 | 做什么、不做什么、验收标准是什么 | 极少变;变更需业务确认 |
| `arch/` | 终态方案(按领域分册) | 系统现在长什么样、为什么这么设计 | 行为变更同批更新;只写终态,不写待办 |
| `standard/` | 稳定规范 | 测试、CI、部署、分支这类固定流程怎么走 | 流程本身变了才改 |
| `plan/` | 迭代计划 | 这个迭代怎么做、做到哪一步 | 状态真相源;里程碑完成后压缩为一行 |
| `research/` | 调研评估 | 某个选型/路线为什么这么定 | 结论落定后冻结 |
| `prototypes/` | UI 原型与设计令牌 | 界面长什么样、设计令牌取值 | 设计稿定版后作为开发依据 |

一句话规则:**终态进 `arch/`,过程进 `plan/`,结论进 `research/`,规矩进 `standard/`。**

## 二、索引与阅读时机

### requirement/(需求基准)

| 文档 | 说明 |
| --- | --- |
| [01-requirement.md](requirement/01-requirement.md) | 项目定位、功能范围与不做清单、非功能需求、迁移验收标准 |

### arch/(架构设计 · 终态方案)

| 文档 | 说明 | 阅读时机 |
| --- | --- | --- |
| [00-overview.md](arch/00-overview.md) | 技术选型、单体拓扑、部署架构、与旧站共存与切换 | 首次进入项目必读 |
| [01-data-source.md](arch/01-data-source.md) | 渠道矩阵(一手源/榜单/海外社区/国内需求语料)、地域与翻译口径、事件与榜单落点、接入契约 | 规划内容来源、接入新渠道时 |
| [02-data-collection.md](arch/02-data-collection.md) | 采集架构、调度、准入与合规 | 改采集管道时 |
| [03-data-model.md](arch/03-data-model.md) | 表设计、Prisma Migrate 纪律 | 涉及表结构变更时 |
| [04-ai-agent.md](arch/04-ai-agent.md) | AI Agent 体系、检索与答案卡、会话编排与安全边界 | 涉及智能体能力时 |
| [05-services.md](arch/05-services.md) | service 分层与事务边界、会话、BullMQ 任务、接口清单 | 写 `src/lib/` 或 `worker/` 前 |
| [06-project-structure.md](arch/06-project-structure.md) | 目录组织规范、文件规则、CLAUDE.md 体系 | 新建目录/文件前 |
| [07-frontend.md](arch/07-frontend.md) | 渲染策略、URL 与 slug 红线、SEO、API 层约定、管理后台 | 写页面/Handler 前 |
| [08-media.md](arch/08-media.md) | 存储演进、视频、后台清洗管理 | 涉及媒体一切工作时 |

### standard/(稳定规范)

| 文档 | 说明 | 阅读时机 |
| --- | --- | --- |
| [01-testing.md](standard/01-testing.md) | 测试分层、单测红线清单、迁移重放守卫、发布门槛 | 写测试/发布前 |
| [02-cicd-deployment.md](standard/02-cicd-deployment.md) | 分支模型、CI 流水线、镜像、切换 runbook、备份 | 部署/发版/开新分支时 |
| [03-db-naming.md](standard/03-db-naming.md) | 数据库命名权威源:表/列/约束/索引/删除行为、反例速查、新表 checklist、历史例外登记 | 建表/改表/加索引前 |

### plan/(迭代计划 · 状态真相源)

| 文档 | 说明 |
| --- | --- |
| [development-plan.md](plan/development-plan.md) | 总纲:当前基线、里程碑表、后置池、专项排期、维护约定 |
| [discovery-plan.md](plan/discovery-plan.md) | 优质内容发现机制(热词/博主/热点视频)实现方案 |
| [insight-plan.md](plan/insight-plan.md) | 洞察中心(热点舆情 + 用户痛点)实现方案 |
| [data-expansion-plan.md](plan/data-expansion-plan.md) | M58 数据面扩展与洞察 v2(多语言/厂商事件/榜单页/社区语料/问句清洗) |
| [editor-ai-plan.md](plan/editor-ai-plan.md) | 编辑器 AI 化(对话改稿 + diff 评审 + 自动保存)实现方案 |
| [topic-pipeline-plan.md](plan/topic-pipeline-plan.md) | 专题内容管线实现方案 |
| [xhs-auto-publish-design.md](plan/xhs-auto-publish-design.md) | 小红书自动发布系统设计 |

### research/ · prototypes/

| 文档 | 说明 |
| --- | --- |
| [research/01-douyin-signer-eval.md](research/01-douyin-signer-eval.md) | 抖音签名能力落地路线评估 |
| [prototypes/index.html](prototypes/index.html) | 原型索引:前台 / 用户中心 / 后台各屏,单文件自包含、离线可开 |
| [prototypes/DESIGN-SPEC.md](prototypes/DESIGN-SPEC.md) | 设计令牌、图标、组件规范(原型与落地页共用) |

## 三、常用阅读路径

- **新会话/新人**:根 [CLAUDE.md](../CLAUDE.md) → `arch/00` → 当前 `plan/development-plan.md`
- **改数据模型**:`arch/03` + `prisma/migrations`(schema 是唯一真相源)
- **写后端逻辑**:`arch/05` + 对应领域 `src/lib/`
- **写页面/接口**:`arch/07`,目录与文件规则看 `arch/06`
- **碰媒体/视频**:`arch/08`
- **写测试 / 发版**:`standard/01`、`standard/02`

## 四、维护纪律

1. **单一真相源**:同一事实只在一处写,别处用链接引用,不复制。
2. **状态只住 `plan/`**:`arch/` 写终态不写待办;`plan/` 写进度不复述终态。
3. **里程碑完成后退化**:该条目压成一行基线(做了什么、落在哪个 arch 章节),
   实现细节交给代码与 arch,不留在计划里。
4. **一次性过程文档不长期驻留**:评审清单、订正记录这类一次性产物,应用完成后
   删除,历史由 git 保留。
5. **不复述代码**:字段、常量、接口签名以 schema 与源码为准,文档只写意图与约束。
6. **同批同步**:行为变更当批更新对应 arch 章节,不允许"代码先行、文档后补"跨迭代漂移。
7. **命名**:`arch/standard/requirement/research` 用 `NN-英文主题.md`;`plan/` 用
   `<主题>-plan.md` 或 `<主题>-design.md`。
8. **不主动新建 `*.md`**:文档是必要资产,不是工作日志。
