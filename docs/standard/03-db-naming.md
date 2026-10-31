# 数据库命名与结构规范

> 本文是表名/列名/约束/索引命名的**唯一权威源**;`arch/03-data-model §3`、`arch/06-project-structure §3` 只保留速查与指针,不再复述细则。
> 建表、改表、加索引前先读本文 §6 的 checklist;存量例外登记在 §7,不回头改。

## 1. 规范靠什么落地

| 层 | 机制 |
|----|------|
| 表达式 | `prisma/schema.prisma` 是唯一真相源;表名走 `@@map`、列名走 `@map`、索引/唯一约束走 `map:` —— **DB 侧名字全部显式写死,不靠默认推导** |
| 机器守卫 | CI `migrate-replay` job:临时库重放全部迁移 → 再 deploy 一次验幂等 → `prisma migrate diff --from-url <临时库> --to-schema-datamodel prisma/schema.prisma --exit-code` |
| 人审 | `npx prisma migrate dev --create-only` 生成的 SQL 必须逐条评审;表重命名 Prisma 会生成 DROP+CREATE,必须手写 `ALTER TABLE ... RENAME`(见 §5) |

守卫的含义:任何人从零建库,重放迁移后的库必须与 schema 完全一致。漏一个 `map:`、漏一个索引改名,守卫立刻红。

## 2. 表名

**格式:`<域前缀>_<实体>`,全小写 snake_case,单数,语义完整。**

| 域前缀 | 覆盖 |
|--------|------|
| `content_` | 文章、分类、标签、评论、点赞、媒体资产、专题贴图 |
| `user_` | 账号、令牌、钱包与流水 |
| `stats_` | 站点统计聚合与明细 |
| `legacy_` | 旧站 URL 承接 |
| `pay_` | 订单、订单行、回调留痕、网关配置、付费权益 |
| `insight_` | 洞察信号、聚类、实体、榜单快照、词表、热源 |
| `ai_` | 模型、任务绑定、用量台账、封面候选、配图工坊 |
| `crawl_` | 采集源与快照 |
| `publish_` | 分发渠道、媒体缓存、公众号配置 |
| `discovery_` | 优质内容发现候选与热词 |
| `search_` | 检索会话与向量 |
| `admin_` | 后台与外部的绑定配置 |
| `agent_` | Agent 技能等运行时配置 |
| `github_` | 仓库、活动、文章映射 |

规则:

- **新表必须带域前缀,无例外**;同一功能族的关联表沿用主实体前缀(`content_post_tag`、`insight_entity_alias`)。
- 引入新域时,先在本表登记前缀再建表;前缀是领域归属信号,不是缩写练习。
- 表名用单数(`content_post` 而非 `content_posts`)。
- 系统/框架自建表不在此列(`_prisma_migrations`、LangGraph `checkpoint_*`,见 §7)。

## 3. 列名

| 对象 | 规范 |
|------|------|
| 一般列 | snake_case;TS 侧 camelCase,`@map` 单点映射 |
| 主键 | 统一 `id`;默认 `BIGSERIAL`(类型例外见 §7) |
| 外键列 | `<被引实体>_id`;自关联可用语义限定(`parent_id`、`merged_into_id`、`primary_id`) |
| 时间列 | 带时刻的一律 `_at`(`created_at`/`published_at`),`timestamptz(6)`;纯日期用 `_date`(`captured_date`) |
| 布尔列 | **必须带语义前缀** `is_` / `has_` / `supports_`(`is_pinned`、`has_video`);只有「整行开关」型配置表可用裸 `enabled`;禁止裸形容词(`visible`/`display`/`handled`) |
| 枚举/状态列 | VARCHAR + 注释枚举,**不加 DB CHECK**,合法值由应用层 Zod 边界管控 |

审计字段:业务表统一 `created_at` + `updated_at`;append-only 台账只需 `created_at`。明细表若时间语义由业务列承担(`granted_at`/`captured_at`/`started_at`),不重复加 `created_at`(登记见 §7)。

## 4. 约束与索引

### 4.1 主键与外键

- PK 名 `<table>_pkey`,FK 名 `<table>_<col>_fkey` —— **Prisma 默认名,禁止自定义**。理由:Prisma schema 无法表达 FK 命名,硬改会让 introspect 守卫永久报差异;一致性校验优先于命名美学(2026-09-29 定)。
- 显式多对多表用 `@@id([a, b])` 复合主键建模,不再额外挂同列的 `@@unique`(唯一约束当主键是反例)。
- **FK 列必须自建索引**:PG 不为主键外的 FK 自动建索引,漏建会让删除/更新父行全表扫。

### 4.2 唯一与普通索引(必须带 `map:`)

| 场景 | 写法 |
|------|------|
| 单字段唯一 | `@unique(map: "uq_<table>_<col>")` |
| 复合唯一 | `@@unique([a, b], map: "uq_<table>_<a>_<b>")` |
| 普通索引 | `@@index([a, b(sort: Desc)], map: "idx_<table>_<cols>")` |
| 裸 SQL 建的索引(pgvector / partial) | 同样遵守 `idx_` 前缀,迁移里显式 `CREATE INDEX "idx_..."` |

`uq_` 后面跟表名再跟列名,列名用下划线拼接;部分索引/表达式索引取最能表达用途的短名,但前缀不许省。

### 4.3 删除行为(`onDelete`)裁定纪律

按**真实删除路径**裁定,不按直觉:

| 语义 | onDelete |
|------|----------|
| 子行随父行必然消亡(评论随文章、别名随实体) | `Cascade` |
| 归属可空、父行删除后子行应留档(台账、反馈、历史事件) | `SetNull` |
| 财务/审计单不得凭空消失(订单、权益、订单行) | `Restrict` |
| 父行与子行在同一条 `DELETE ... IN (...)` 内(自关联父子) | `SetNull`(`Restrict` 会自撞) |

写 `SetNull` 前先确认列**可空**;写 `Restrict` 前先确认确实没有「删父必删子」的业务路径。

## 5. 反例速查

| 错误 | 正确 | 后果 |
|------|------|------|
| `key String @unique`(裸 `@unique`) | `key String @unique(map: "uq_insight_entity_key")` | 落 Prisma 默认名 `*_key`,全库命名分裂 |
| `@@unique([a, b], map: "table_a_b_key")` | `map: "uq_table_a_b"` | 同上,默认风名字混入 |
| `@@map("entity_event")`(同域他表都带前缀) | `@@map("insight_entity_event")` | 域归属不可见,查表靠记忆 |
| 唯一约束 + 冗余 `@@unique` 当主键 | `@@id([a, b])` | 表无主键,复制/逻辑复制/审计困难 |
| 加 FK 不建索引 | 同步 `@@index([fkCol], map: "idx_...")` | 删除父行全表扫 |
| Prisma 生成表重命名时直接接受 `DROP TABLE`+`CREATE TABLE` | 手写 `ALTER TABLE ... RENAME TO` + 改名 PK/FK/唯一/索引 | 数据丢失 |
| `session_id varchar(40)` 指向 `varchar(36)` 主键 | 两侧 native type 一致 | Prisma 无法建立 relation |
| 布尔列 `visible` / `display` | `is_visible` / `is_displayed` | 语义歧义(是状态还是动作) |

## 6. 新增表 checklist

建表前逐条对照,任一不满足先改 schema:

- [ ] 表名带域前缀,全小写单数;新域已在本文件 §2 登记
- [ ] 模型名 PascalCase,`@@map` 显式落表名
- [ ] 每列有 `@map`(除与字段名完全一致的单词列可省略,但 **DB 列名必须是 snake_case**)
- [ ] 主键 `id` `BIGSERIAL`;显式多对多表用 `@@id([...])`
- [ ] 所有唯一约束/索引带 `map:`,名字为 `uq_`/`idx_` 规范
- [ ] 所有 FK 列同步建索引
- [ ] `onDelete` 按 §4.3 裁定,写 `SetNull` 的列必须可空
- [ ] 时间列 `_at` + `timestamptz(6)`;业务表有 `created_at`(及 `updated_at`)
- [ ] 布尔列带 `is_`/`has_`/`supports_` 前缀
- [ ] 枚举列 VARCHAR + 注释,无 CHECK
- [ ] `npx prisma migrate dev --create-only` 后**逐条评审 SQL**;确认没有意外 `DROP TABLE`
- [ ] 从零重放的 `migrate diff --exit-code` 绿

## 7. 历史例外登记(不回头改)

### 7.1 无域前缀的历史表

以下表建于规范成型前,重命名成本(代码/迁移/监控)高于收益,**登记为例外**;新表不得模仿:

| 表 | 说明 |
|----|------|
| `topic` / `topic_item` | 专题内容管线 |
| `telegram` | 电报条目 |
| `feedback` | 站点反馈 |
| `job_run` | 任务运行台账 |
| `site_config` / `email_config` / `asr_config` / `system_proxy_config` | 单例/全局配置族 |
| `model_pricing` | 定价配置(历史表,已由 `ai_model` 价格列承接) |
| `social_account` | 社媒账号 |
| `blocklist` | 屏蔽词 |
| `coding_plan` | 编码计划 |
| `writing_sample_image` | 写作样例图 |

### 7.2 框架自建表(不进 migrations)

`_prisma_migrations`(Prisma 台账)、`checkpoint_blobs` / `checkpoint_migrations` / `checkpoint_writes` / `checkpoints`(LangGraph checkpointer,由框架 `setup()` 建)。这些表不参与命名规范,也不得手工改。

### 7.3 刻意不建 FK 的多态/聚合引用

| 列 | 理由 |
|----|------|
| `search_embedding.entity_id` | 多态引用(post/telegram/repo 三域) |
| `topic_item.item_id` | 多态引用 |
| `insight_signal.ref_id` | 多态引用(不同 source 指向不同表) |
| `stats_geo_daily.post_id` | varchar 存 bigint 文本;聚合表保留已删文章的历史 |
| `ai_usage_log.session_id` / `feedback.session_id` | 台账保留期(90 天)长于会话清退期(30 天),加 FK 会阻断清退或丢失聚合归属 |

### 7.4 类型例外

| 列 | 现状 | 说明 |
|----|------|------|
| `ai_model.id` | `integer` | 全库主键几乎都是 `bigint`;改类型要连带四处引用表,收益不足 |
| `search_agent_session.id` | `varchar(36)` | 会话 id 即 LangGraph thread_id(UUID),非自增;所有指向它的 `session_id` 必须同为 `varchar(36)` |

### 7.5 存量布尔裸名

`enabled` / `visible` / `assistant_visible` 等裸布尔列在 §3 规则之前已落地,**存量豁免**;新建列一律带 `is_`/`has_`/`supports_` 前缀。
