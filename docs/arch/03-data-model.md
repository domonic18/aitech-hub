# 数据模型与迁移管理

> schema 唯一真相源是 `prisma/schema.prisma` + `prisma/migrations/`。本文定义表结构设计与迁移纪律;Prisma 模型名与 DB 表名的映射规则见 [arch/06-project-structure §3](06-project-structure.md)。

## 1. 迁移纪律(Prisma Migrate 承载 SQL 台账制精神)

- `0000_init` 基线迁移(全部一期表)→ 按日期命名增量;`prisma/migrations/` 下 SQL 文件可读、可评审
- **forward-only**:已应用的迁移禁止修改;破坏性变更走 expand-contract(先加后删,分两次)
- **执行**:`npx prisma migrate deploy`(**起库健康后、起应用前必须执行**);`_prisma_migrations` 台账 exactly-once、幂等
- 开发流程:`prisma migrate dev --create-only` 生成 SQL → 人工评审 → 应用;禁止 `db push` 绕过迁移
- 种子:`prisma/seed.ts`(幂等 upsert:四分类、站点配置);admin 不预置,首次部署 `npm run admin <phone>` 创建
- **CI 重放守卫**:起临时 postgres:16 → `migrate deploy` 全量 → 再 deploy 一次验证幂等 → Prisma introspect 断言 schema 一致(standard/01-testing §5)

## 2. 一期表结构(0000_init 的设计依据)

域前缀:`content_` / `user_` / `stats_` / `legacy_`;视频字段按 arch/08-media 决策已内建。站点统计聚合族与 `user_pat` 为 2026-09-29 需求补充(requirement §3.5/§3.6),属一期表,随 `0000_init` 基线建表。

### 2.1 content_(内容域)

```sql
-- 文章主表;wp_post_id 是与旧站的溯源锚点
CREATE TABLE content_post (
    id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    slug            VARCHAR(255) NULL,               -- 装饰性 ASCII slug(2026-10 起;URL /post/<id>-<slug> 由 id 锚定,
                                                     -- 迁移自 WP percent-encoded 中文;可空可改,纯中文标题 → NULL)
    title           VARCHAR(500) NOT NULL,
    excerpt         TEXT,
    content_html    TEXT,                            -- 旧文正文(清洗后 HTML,只读保真)
    content_md      TEXT,                            -- 新文正文(Markdown;二选一非空)
    cover_path      VARCHAR(500),                    -- 媒体 URL 路径 /wp-content/uploads/...
    category_id     BIGINT NOT NULL REFERENCES content_category(id),
    status          VARCHAR(20) NOT NULL DEFAULT 'draft',   -- draft/published
    content_origin  VARCHAR(20) NOT NULL DEFAULT 'human',   -- 创作方式 human/ai_assisted/ai_generated
                                                     -- (AI 生成合成内容标识办法 2025-09-01 施行;应用层枚举)
    is_pinned       BOOLEAN NOT NULL DEFAULT FALSE,
    views_count     BIGINT NOT NULL DEFAULT 0,
    seo_title       VARCHAR(255),
    seo_description TEXT,
    published_at    TIMESTAMPTZ,
    wp_post_id      BIGINT UNIQUE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX uq_content_post_slug ON content_post (slug);  -- PG unique 允许多行 NULL(bare-id 文)
CREATE INDEX idx_content_post_status_published ON content_post (status, published_at DESC);
CREATE INDEX idx_content_post_category ON content_post (category_id);

CREATE TABLE content_category (
    id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    slug        VARCHAR(100) NOT NULL,               -- blog / report / news / advertising
    name        VARCHAR(100) NOT NULL,
    description TEXT,
    sort_order  INT NOT NULL DEFAULT 0,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX uq_content_category_slug ON content_category (slug);

CREATE TABLE content_tag (
    id         BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    slug       VARCHAR(200) NOT NULL,
    name       VARCHAR(100) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX uq_content_tag_slug ON content_tag (slug);

CREATE TABLE content_post_tag (
    post_id BIGINT NOT NULL REFERENCES content_post(id) ON DELETE CASCADE,
    tag_id  BIGINT NOT NULL REFERENCES content_tag(id) ON DELETE CASCADE,
    PRIMARY KEY (post_id, tag_id)
);

-- 媒体表(图片+视频+文件统一资产;kind 现在就位,二期视频零迁移)
CREATE TABLE content_media (
    id               BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    path             VARCHAR(500) NOT NULL,          -- URL 路径;/wp-content/uploads/...(图片)或 /media/videos/...(二期 COS 域内路径)
    filename         VARCHAR(255) NOT NULL,
    kind             VARCHAR(20) NOT NULL DEFAULT 'image',  -- image/video/file
    status           VARCHAR(20) NOT NULL DEFAULT 'active', -- active/orphan/missing
    size_bytes       BIGINT,
    width            INT,
    height           INT,
    duration_seconds INT,                            -- 视频用;图片 NULL
    thumb_path       VARCHAR(500),                   -- 缩略图/视频封面(WebP)
    sha1             CHAR(40),                       -- 重复检测与去重
    storage          VARCHAR(20) NOT NULL DEFAULT 'local',  -- local/cos(arch/08-media 演进)
    wp_attachment_id BIGINT,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX uq_content_media_path ON content_media (path);
CREATE INDEX idx_content_media_kind_status ON content_media (kind, status);

-- 媒体引用追踪:文章保存时解析正文/封面写入;孤儿/断链清洗的地基(arch/08-media §3)
CREATE TABLE content_media_ref (
    media_path VARCHAR(500) NOT NULL,
    post_id    BIGINT NOT NULL REFERENCES content_post(id) ON DELETE CASCADE,
    PRIMARY KEY (media_path, post_id)
);
CREATE INDEX idx_content_media_ref_post ON content_media_ref (post_id);
```

### 2.2 user_(账号域)

```sql
CREATE TABLE user_account (
    id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    phone           VARCHAR(20) UNIQUE,
    nickname        VARCHAR(100),
    avatar_path     VARCHAR(500),
    bio             VARCHAR(500),
    role            VARCHAR(20) NOT NULL DEFAULT 'user',   -- user/admin
    status          VARCHAR(20) NOT NULL DEFAULT 'active', -- active/disabled/pending_binding
    password_hash   VARCHAR(255),                    -- 可空,自愿补设(bcrypt)
    wp_user_id      BIGINT UNIQUE,
    legacy_username VARCHAR(100),
    legacy_phpass   VARCHAR(255),                    -- 仅审计留存,登录永不使用
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_user_account_status ON user_account (status);
```

```sql
-- 发布 API 个人访问令牌(requirement §3.6,2026-09-29 补)
-- 库中只存 sha256 哈希;明文仅创建时返回一次;吊销后即拒
CREATE TABLE user_pat (
    id           BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    user_id      BIGINT NOT NULL REFERENCES user_account(id) ON DELETE CASCADE,
    name         VARCHAR(100) NOT NULL,   -- 令牌备注(如 "claude-code-laptop")
    token_hash   CHAR(64) NOT NULL,       -- sha256 hex
    last_used_at TIMESTAMPTZ,
    revoked_at   TIMESTAMPTZ,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX uq_user_pat_token_hash ON user_pat (token_hash);
CREATE INDEX idx_user_pat_user ON user_pat (user_id);
```

### 2.3 stats_ 与 legacy_

```sql
CREATE TABLE stats_post_view_daily (
    post_id   BIGINT NOT NULL REFERENCES content_post(id) ON DELETE CASCADE,
    view_date DATE NOT NULL,
    count     BIGINT NOT NULL DEFAULT 0,
    PRIMARY KEY (post_id, view_date)
);
```

```sql
-- 站点统计日聚合族(requirement §3.5,2026-09-29 补)
-- 口径:客户端 beacon 上报,服务端去 bot/去管理员;UV 为 IP+UA 哈希去重,任何表不存明文 IP/UA
-- 写入路径:上报 → Redis 当日缓冲 → worker 定时聚合 UPSERT(日粒度,行数有界)

-- 站点总览:全站 PV/UV(总览卡片与趋势图)
CREATE TABLE stats_visit_daily (
    stat_date DATE NOT NULL,
    pv        BIGINT NOT NULL DEFAULT 0,
    uv        BIGINT NOT NULL DEFAULT 0,
    PRIMARY KEY (stat_date)
);

-- 流量来源:direct/search/referral/ai/bot 五类,细分到具体来源
CREATE TABLE stats_referrer_daily (
    stat_date    DATE NOT NULL,
    source_class VARCHAR(20) NOT NULL,   -- direct/search/referral/ai/bot(bot=已命名爬虫抓取 PV,2026-10-07 方案B,middleware→/api/stats/bot→同一 ref 日缓冲;无迁移,varchar 枚举演进)
    source_name  VARCHAR(50) NOT NULL,   -- direct 固定 'none';其余为 google/bing/baidu/chatgpt/perplexity…/GPTBot/ClaudeBot/Googlebot…
    pv           BIGINT NOT NULL DEFAULT 0,
    uv           BIGINT NOT NULL DEFAULT 0,
    PRIMARY KEY (stat_date, source_class, source_name)
);

-- 热门页面:路径粒度(文章页同时累加 stats_post_view_daily)
CREATE TABLE stats_page_daily (
    stat_date DATE NOT NULL,
    path      VARCHAR(500) NOT NULL,
    pv        BIGINT NOT NULL DEFAULT 0,
    uv        BIGINT NOT NULL DEFAULT 0,
    PRIMARY KEY (stat_date, path)
);
CREATE INDEX idx_stats_page_daily_date_pv ON stats_page_daily (stat_date, pv DESC);

-- 访客环境(采集一期实现,展示可简版)
CREATE TABLE stats_client_daily (
    stat_date   DATE NOT NULL,
    browser     VARCHAR(50) NOT NULL,
    os          VARCHAR(50) NOT NULL,
    device_type VARCHAR(20) NOT NULL,   -- desktop/mobile/tablet
    pv          BIGINT NOT NULL DEFAULT 0,
    PRIMARY KEY (stat_date, browser, os, device_type)
);

-- 旧 URL 301 映射(迁移脚本灌入;web legacy 路由 + Redis 缓存消费)
CREATE TABLE legacy_url_map (
    old_path    VARCHAR(500) PRIMARY KEY,
    target_url  VARCHAR(500),
    http_status SMALLINT NOT NULL DEFAULT 301,
    note        VARCHAR(200),
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

### 2.4 二期预留(到时增量迁移,不在基线)

`pay_order` / `pay_order_item` / `content_post_purchase`(付费权益)、`github_repo` / `github_repo_activity`(项目展示)。命名已避让。

**GitHub 项目展示域三表已落地(2026-10-05 M11 批①迁移 `github_showcase`,白名单口径——admin 逐行登记,不做全账号扫描)**:

- `github_repo`(仓库白名单台账):`full_name` 唯一(同步跟随 GitHub 改名重定向回写);`slug` 唯一(站内 URL 键 `/projects/<slug>`,登记时由 name 派生**此后冻结**);stars/forks/language/topics text[]/html_url/homepage/default_branch;README 缓存 `readme_md`/`readme_sha`(sha 不变跳写,防 updatedAt/sitemap lastmod 空转)/`readme_fetched_at`;展示 `display`(前台开关,下架不删数据)/`sort_order`;调度观测列族与 social_account 同款 `sync_interval_min(默认 60)/last_sync_at/next_sync_at/consecutive_fails/last_error/status`
- `github_repo_activity`(进展动态):`repo_id+kind+external_id` 唯一(commit sha/release id 去重锚),`occurred_at` 倒序索引;同步裁剪仅留每仓最新 50 条
- `github_repo_post`(仓库↔文章显式 m2m,镜像 PostTag 复合主键双侧 Cascade):admin 手动关联,「配套文章 ×N」与详情页联动数据源

**电报流表族已落地(M7 文字管道 + M8 视频管道,增量迁移进 `prisma/migrations/`,字段终态以 schema 为准)**:

- `crawl_source`(文字渠道台账;M8 起兼**平台行**:`type=social-video + platform=douyin` 每平台一行,承载 Cookie 池密文 `config.cookieJars`/平台总开关/日上限,自身不调度——设计见 [arch/02 §2 落地注记](02-data-collection.md))
- `social_account`(视频博主,2026-10-04 M8 新表):`platform+sec_uid` 唯一;调度字段 `crawl_interval_min(默认 180)/last_post_at(增量地板)/last_run_at/next_run_at/consecutive_fails/last_error`;`platform_row_id` FK→crawl_source(N:1);`enabled` 启停(两步武装删除前置)
- `telegram`(电报表;M8 扩视频列):`media_type varchar(10) default 'text'` + `video_platform/video_blogger(冗余博主名)/video_cover_url/video_duration/video_engagement jsonb`,索引 `(status, media_type)`;**无 transcript/play_url 列**(版权红线,arch/02 §3.2);AI 解读列组视频/文字共用:`ai_status/ai_topic/ai_summary/ai_points jsonb/ai_keywords jsonb(M12 批⑥ 新列,文字条关键词 tag)/ai_ran_at/last_ai_error`(语义与契约演进见 arch/02 §3.2 落地注记)
- `blocklist`(屏蔽词)

**AI 服务域三表已落地(2026-10-04 M8 批⑥迁移 `ai_service_admin`,治理后台见 [arch/04 §4](04-ai-agent.md))**:

- `ai_model`(模型台账):`provider/protocol/base_url?/model_id`;`api_key_enc?/api_key_mask?`(AES-256-GCM 密文 + 脱敏冗余列,界面仅回显掩码);`purposes text[]`(interpret/summarize/search/cover,绑定校验 `has: role`);`supports_view/concurrency(默认 4)/timeout_sec(默认 60)/enabled` + `last_test` 四件套(tested_at/status ok|fail/error 截 500/latency_ms)
- `ai_task_binding`(任务绑定):`role` 自然主键(四角色)+ `primary_id?/backup_id?` FK→ai_model(`onDelete: SetNull` 仅 DB 兜底,应用层删前先校验解绑)+ `daily_max?`(M9 批⑥:解读日配额条/日,null=默认 100;当前仅 interpret 消费,设置入口 /admin/models 任务绑定卡)
- `asr_config`(ASR 渠道单例 `id=1`,get-or-create):`provider/protocol/base_url?/model_id/api_key_enc?/api_key_mask?/max_audio_seconds(默认 600)/hotwords text[] 默认[]/enabled 默认 false`(无消费方,先配置后启用)+ `last_test` 四件套

对称密钥不入库:主钥 = HKDF-SHA256 从必有的 `AUTH_SECRET` 派生 32B(salt/info 冻结常量,`src/lib/crypto/secret-box.ts`),AES-256-GCM;**`APP_COOKIE_ENC_KEY` 已退役**(M8 批⑥,Cookie 池与 API Key 同箱)——轮换 `AUTH_SECRET` 会使存量密文失效(Cookie 重导、Key 重录);枚举合法值应用层 Zod 管控(§3 同款纪律)。

**站点配置与访问明细已落地(2026-10-04 M10 迁移,体验反馈批)**:

- `site_config`(kv 通用底座):`key varchar(50) PK + value text + updated_at`;value 一律字符串,消费方自行解析 + clamp(键注册表 `SITE_CONFIG_KEYS` + per-key Zod,`src/lib/config/site-config.ts`;缺行/非数值/越界一律回落默认)。**M12 批② value 放宽为 text**(hero_md 存 markdown,varchar(200) 不够)并扩键族:`band.item_count`(默认 12,钳 1..50)/`home.repo_count`(默认 3,钳 1..12)/`home.post_count`(默认 5,钳 1..12)/`site.title`(默认「一起AI」,1..50 字;传播 generateMetadata/Header/Footer/feed.xml/llms.txt)/`home.hero_md`(≤2000 字,空 = 回退内置品牌语)/`site.icp`(2026-10-05,≤60 字,空 = 页脚不渲染备案行;页脚链 beian.miit.gov.cn)
- `stats_visit_log`(近期访问明细,行级):`path varchar(500)/ip varchar(45)/browser/os varchar(50)/device_type varchar(20)/source_class varchar(20)/source_name varchar(50)/visitor_hash varchar(32)/created_at`;索引 `created_at DESC`。**口径例外**:统计族其余表不存明文 IP,此表存全量 IP(2026-10-04 用户定调)但仅 7 天短留存——ingestView 同步落行(不 await 不阻断 beacon,失败仅 warn,聚合口径不受影响),worker 日调度 `visit-log-purge` 清过期行
- `stats_search_log`(搜索词明细,行级,2026-10-06 排行需求):`term varchar(100)/created_at`;索引 `created_at DESC`。口径:/search 页 counted PV 携带的 q(trim + 空白折叠截 100 字,`classify.ts#normalizeSearchTerm`,保留原样大小写),仅 path 为 /search 记;无 PII(不存 IP/访客哈希);行级直插不经缓冲(不 await 不阻断 beacon,失败仅 warn),worker `visit-log-purge` 同 job 清 180 天前行——排行「全部」窗口的实际上界

**混合检索向量表已落地(2026-10-08 M20 批①迁移 `20261008110000_hybrid_search_pgvector`,检索架构见 [arch/04 §3.2](04-ai-agent.md))**:

- `search_embedding`:`entity_type varchar(20)`(post/telegram/repo)/`entity_id bigint`/`model varchar(100)`/`dims int`/`embedding vector(1024) NOT NULL`/`updated_at`;唯一约束 `(entity_type, entity_id)`(upsert 锚),三个分部 HNSW 索引(`vector_cosine_ops`,`WHERE entity_type = '…'` 每域一个);迁移同批 `CREATE EXTENSION IF NOT EXISTS vector`
- 纪律:向量列 pgvector 自定义类型,Prisma 侧 `Unsupported("vector(1024)")` 仅锚 DDL 防 migrate 漂移(field 必须 required,optional 会 diff 出漂移),**读写一律 raw SQL**(`src/lib/search/embedding-repo.ts` 唯一出口;`serializeVector` 产文本字面量经参数化注入);生命周期 = worker 15 分钟对账自愈(缺/陈旧重嵌:post/repo 源时钟 `updated_at`,telegram 无 updated_at 取 `COALESCE(ai_ran_at, created_at)`)+ 孤儿清理(下架/隐藏/回草稿即删);**换绑 embedding 模型 = 维度/语义空间双变,对账时钟感知不到,需手动清表重嵌**

**内容分发域三表已落地(2026-10-06 M17 批①迁移 `20261006122422_publish_channel_wechat`,多渠道分发首渠道=微信公众号,requirement §4)**:

- `publish_wechat_config`(渠道配置单例 `id=1`,get-or-create,镜像 `asr_config`):`appid/app_secret_enc?/app_secret_mask?`(secret-box AES-256-GCM 同箱,AUTH_SECRET 轮换失效重录)/`author?`(图文作者,缺省「一起AI」)/`theme 默认 "default"`(渠道默认正文主题 id,wechat-themes 注册表)/`auto_sync_enabled 默认 false`(发布即推,用户定调默认关)/`enabled 默认 false`(渠道总开关)+ `last_test` 四件套
- `publish_channel`(渠道中立分发状态机):`post_id+channel` 唯一(一期 channel 仅 wechat,CSDN/知乎后置);`status`(pending/synced/failed,应用层 Zod)/`media_id?`(公众号草稿锚——有值重推走 draft/update,清空回落 draft/add)/`title?/digest?/thumb_path?/theme?`(按渠道微调快照,组装优先级 overrides > 行快照 > 文章字段;theme 快照=上次推送所用主题 id,重推沿用,空=渠道默认)/`attempts/last_error?(截 500)/synced_at?`
- `publish_media_cache`(转存防重推):`channel+source_key` 唯一;`source_key` 前缀分区:`b:<sha1 源字节>`(站内正文图)/`u:<sha1 url>`(外链图)/`m:<sha1 源字节>`(封面,`remote_media_id` 有值);`remote_url`(uploadimg 回传 mmbiz 链,永久有效无 TTL)/`remote_media_id?`(add_material 回传);缓存命中零上传,公众号频控友好

**搜索 Drawer 会话表已落地(2026-10-07 K2.5 批①迁移 `20261006190159_search_agent_session`,交互见 [arch/04 §3](04-ai-agent.md))**:

- `search_agent_session`(会话索引行):`id varchar(36) PK`(uuid = LangGraph thread_id,建会话即定);`visitor_id varchar(36)`(匿名 cookie `ah_av`,归属校验锚——非本人 404 不泄露存在性;K2.6 起仅 admin 会话落行,key=`admin:<sub>`);`title? varchar(40)`(首条用户消息前 20 码点,run 收尾回填仅空行);`tokens_total int 默认 0`(会话累计 ≤50k 护栏口径);`created_at/last_message_at`(touch 于每次 run 收尾);索引 `(visitor_id, last_message_at DESC)` 列表 + `last_message_at` 30 天日清扫描。**消息轨迹不在本表**——存 LangGraph checkpoint 表框架(`setup()` 自管,不进 Prisma migrations,§1 边界);删除 = 行+checkpoint 同删(用户 DELETE 路由 / worker 日清 `purge-agent-session` 双入口,checkpoint 删失败不反噬)
- `ai_usage_log.session_id`(K2.6 迁移 `20261007045121_ai_usage_log_session_id` 增列):`varchar(40)?` 会话/线程锚 + `idx_ai_usage_log_session`——Agent 台账行记 threadId(后台会话管理聚合口径,游客线程 `g_<uuid>` 也落此锚),他类调用缺省。**游客不落会话行**:thread_id=`g_<uuid>`,归属 Redis `search:agent:gthread:{id}`(2h 滑动 TTL,不入库),checkpoint 由日清按「键已消失」清扫;后台游客统计 = 本表按 session_id 聚合

## 3. Prisma 模型约定

- 模型名 PascalCase 领域名 + `@@map` 到 snake 表名;字段 camelCase + `@map` 到 snake 列名——**TS 侧全 camel,DB 侧全 snake,映射只此一处**
- Prisma client 单例 `lib/db.ts`(dev 环境 globalThis 缓存防热更像);**禁止第二实例**
- 关系:Post↔Tag 显式多对多表(`content_post_tag` 用 `@@id([postId, tagId])` 复合主键建模),不用 Prisma 隐式 m2m(保 SQL 可控)
- 约束/索引命名:unique 与普通索引经 schema `map` 直接落 `uq_<table>_<cols>` / `idx_*` 规范(如 `uq_content_post_slug`);**PK/FK 保留 Prisma 默认名**(`content_post_pkey` / `*_fkey`)——Prisma schema 层无法表达 FK 命名,硬改会导致 introspect 断言(CI 重放守卫)永久报差异;一致性校验优先于命名美学(2026-09-29 实施定)
- 枚举字段(`status`/`role`/`kind`/`storage`/`source_class` 等)统一 VARCHAR + 注释枚举,**不加 DB CHECK 约束**:合法值由应用层 Zod 边界校验管控,演进免改库约束;`chk_` 前缀规范随之废止(2026-09-30 定)
- 禁止 `prisma db push`、禁止 `interceptDataLayer` 外的裸 SQL(迁移脚本除外)

## 4. 数据订正规范(生产修数)

- 订正一律走**一次性 TS 脚本**放 `scripts/`(pg Pool + SQL,可评审可重放);**禁止直连生产 psql 手改**,禁止在应用运行时热修数据
- 脚本结构:先打印影响行预览(默认 dry-run,显式传参才执行)→ 单事务执行 → 打印结果;**破坏性订正(批量 UPDATE/DELETE)执行前先 `pg_dump -Fc -t <表>`** 落 `workspace/backups/`
- 订正不改变 schema 语义——涉及表/列/约束的变更走 §1 迁移,不得以订正绕过;订正脚本完成后留存入库不删除(溯源)
