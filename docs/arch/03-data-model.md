# 数据模型与迁移管理

> schema 唯一真相源是 `prisma/schema.prisma` + `prisma/migrations/`。本文定义表结构设计与迁移纪律;Prisma 模型名与 DB 表名的映射规则见 [arch/06-project-structure §3](06-project-structure.md),命名细则(表/列/约束/索引/删除行为)的权威源是 [standard/03-db-naming](../standard/03-db-naming.md)。

## 1. 迁移纪律(Prisma Migrate 承载 SQL 台账制精神)

- `20260929131543_init` 基线迁移(全部一期表)→ 按日期命名增量;`prisma/migrations/` 下 SQL 文件可读、可评审
- **forward-only**:已应用的迁移禁止修改;破坏性变更走 expand-contract(先加后删,分两次)
- **执行**:`npx prisma migrate deploy`(**起库健康后、起应用前必须执行**);`_prisma_migrations` 台账 exactly-once、幂等
- 开发流程:`prisma migrate dev --create-only` 生成 SQL → 人工评审 → 应用;禁止 `db push` 绕过迁移
- 种子:`prisma/seed.ts`(幂等 upsert:四分类、站点配置);admin 不预置,首次部署 `npm run admin <phone>` 创建
- **CI 重放守卫**:起临时 postgres:16 → `migrate deploy` 全量 → 再 deploy 一次验证幂等 → Prisma introspect 断言 schema 一致(standard/01-testing §5)

## 2. 一期表结构(20260929131543_init 的设计依据)

域前缀:`content_` / `user_` / `stats_` / `legacy_`;视频字段按 arch/08-media 决策已内建。站点统计聚合族与 `user_pat` 为 2026-09-29 需求补充(requirement §3.5/§3.6),属一期表,随 `20260929131543_init` 基线建表。

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
    author_id       BIGINT REFERENCES user_account(id) ON DELETE SET NULL,
                                                     -- 归属作者(M71):可空(154 篇迁移旧文与存量稿无归属);
                                                     -- 外部 agent 产出归其 PAT 持有人;父行删除后留档
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
CREATE INDEX idx_content_post_author ON content_post (author_id);

CREATE TABLE content_category (
    id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    slug        VARCHAR(100) NOT NULL,               -- blog / report / news / advertising
    name        VARCHAR(100) NOT NULL,
    description TEXT,
    is_original BOOLEAN NOT NULL DEFAULT false,      -- 原创分类标记(2026-10-20):首页「博主文章/推荐视频」分流 + /articles 过滤;文章随分类继承
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

-- 评论 + 点赞(M23,迁移 20261010120000_m23_post_comment_like)。三表设计决策:
-- ① 点赞去重 = identity_key 单列("u:<userId>"|"v:<ah_av uuid>",最长 21/38),
--    不用 (user_id?, visitor_id?) 双列——PG unique 中 NULL 互不判重,双列拦不住
--    游客重复赞;两表分立(文章/评论)而非多态单表,FK Cascade 自动收尸;
-- ② 不加 likes_count/comments_count 冗余计数列:前台全走 force-dynamic API
--    现查 COUNT(量级 154 文/百级评论);列表卡显数(2026-10-10 M23 延伸需求)
--    同走现查——listPostsPage/latest/pinned 出口按页内 id 两次索引 groupBy
--    附带计数(posts.attachInteractionCounts,评论只数 visible),零写路径
--    耦合零漂移;冗余列待列表量级真起来再按单事务入口补列;
-- ③ parent_id 自引用无 FK:两级封顶(仅挂根)由应用层校验;admin 删根连带
--    直接子在事务内显式收集(FK 不级联自引用);
-- ④ user_id 无 FK(feedback 纪律:账号删除评论留档),author_name 为写侧快照
--    (登录=昵称、迁移=WP 原名),渲染零 join;wp_comment_id unique = 迁移幂等键;
-- ⑤ status 仅 visible|hidden 两态(先发后审,无 pending),应用层 Zod 管控;
-- ⑥ content 列宽 4000 容旧站迁移实测 max 2143(dry-run 2026-10-10),
--    新提交 zod 限 1..1000。
CREATE TABLE content_post_comment (
    id            BIGSERIAL PRIMARY KEY,
    post_id       BIGINT NOT NULL REFERENCES content_post(id) ON DELETE CASCADE,
    user_id       BIGINT,
    author_name   VARCHAR(100) NOT NULL,
    content       VARCHAR(4000) NOT NULL,
    status        VARCHAR(16) NOT NULL DEFAULT 'visible',
    parent_id     BIGINT,
    wp_comment_id BIGINT UNIQUE,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_content_post_comment_post_visible ON content_post_comment (post_id, status, created_at);
CREATE INDEX idx_content_post_comment_status_recent ON content_post_comment (status, created_at DESC);

CREATE TABLE content_post_like (
    post_id      BIGINT NOT NULL REFERENCES content_post(id) ON DELETE CASCADE,
    identity_key VARCHAR(42) NOT NULL,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (post_id, identity_key)
);

CREATE TABLE content_post_comment_like (
    comment_id   BIGINT NOT NULL REFERENCES content_post_comment(id) ON DELETE CASCADE,
    identity_key VARCHAR(42) NOT NULL,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (comment_id, identity_key)
);
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

```sql
-- 用户 Token 额度钱包(M22 批①迁移 20261009190234,免费额度制):
-- 注册送 20 万 tokens/月,读时惰性月重置(period_key≠当月即重置回赠额),零 cron
CREATE TABLE user_token_wallet (
    user_id     BIGINT PRIMARY KEY REFERENCES user_account(id) ON DELETE CASCADE,
    balance     INTEGER NOT NULL DEFAULT 0,   -- 当前余额(实扣可微穿仓,下限=单轮 50k 护栏)
    period_key  CHAR(7) NOT NULL,             -- 额度所属月 "YYYY-MM"(北京月界)
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- append-only 流水(余额变化全留痕;余额行 + 本表同事务更新,防并发扣穿)
CREATE TABLE user_token_ledger (
    id            BIGSERIAL PRIMARY KEY,
    user_id       BIGINT NOT NULL REFERENCES user_account(id) ON DELETE CASCADE,
    delta         INTEGER NOT NULL,
    balance_after INTEGER NOT NULL,
    reason        VARCHAR(16) NOT NULL,  -- grant | consume | reset | adjust
    session_id    VARCHAR(40),           -- 溯源 agent 线程(consume 时)
    note          VARCHAR(200),
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_user_token_ledger_user_recent ON user_token_ledger (user_id, created_at DESC);

-- 用户反馈(M22 批⑤;助手 submit_feedback 落库 + admin 后台流转,无删除无邮件)
CREATE TABLE feedback (
    id          BIGSERIAL PRIMARY KEY,
    user_id     BIGINT,                 -- 无 FK:账号删除留档可读(归属经 session_id 溯源)
    visitor_id  VARCHAR(36),            -- 游客 ah_av(工具面未落,预留)
    category    VARCHAR(20) NOT NULL,   -- requirement | issue | suggestion | other
    content     VARCHAR(2000) NOT NULL,
    contact     VARCHAR(200),           -- 用户自愿留的联系方式
    status      VARCHAR(16) NOT NULL DEFAULT 'open',  -- open | processing | resolved
    admin_note  VARCHAR(500),
    session_id  VARCHAR(40),            -- agent 线程溯源(取 run 的 configurable.thread_id)
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_feedback_status_recent ON feedback (status, created_at DESC);
```

- `user_account.assistant_visible`(M22 批①增列,`boolean not null default true`):悬浮 AI 助手显隐偏好,账号级跨设备(`PATCH /api/account/assistant-visible`);游客走 localStorage 不落库
- `ai_usage_log.user_id`(M22 批①增列 + `idx_ai_usage_log_user_created`):Agent 会话 run 台账行记登录用户锚(`recordAgentRun` 透传;admin/游客缺省)——/account/usage 本月消耗与 /admin/usage 共用本表按 user 维度聚合

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

-- 访客地区分布(2026-11-25 方案① 一期):ingest 侧 ip2region 内存查表(方案② 的库)
-- 国内按省、境外按国家聚合;province 空串=境外或国内未细化;明文 IP 只进 visit_log
-- (7 天短留存),地区行不含 IP 维度;上线前 7 天存量由 oneoff region-backfill 回填
CREATE TABLE stats_region_daily (
    stat_date DATE NOT NULL,
    country   VARCHAR(64) NOT NULL,   -- xdb country_name;国内固定 '中国'
    province  VARCHAR(64) NOT NULL,   -- 国内省级(广东省);境外/未细化空串
    pv        BIGINT NOT NULL DEFAULT 0,
    uv        BIGINT NOT NULL DEFAULT 0,
    PRIMARY KEY (stat_date, country, province)
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
- `social_account`(视频博主,2026-10-04 M8 新表):`platform+sec_uid` 唯一;**sec_uid 语义 per-platform(M24 起定档)**——douyin=sec_uid(`MS4wLjAB…` 开头),bilibili=纯数字 mid(1-16 位),判等与登记校验按平台分发(见 [arch/05 §4.4](05-services.md));调度字段 `crawl_interval_min(默认 180)/last_post_at(增量地板)/last_run_at/next_run_at/consecutive_fails/last_error`;`platform_row_id` FK→crawl_source(N:1);`enabled` 启停(两步武装删除前置)
- `telegram`(电报表;M8 扩视频列):`media_type varchar(10) default 'text'` + `video_platform/video_blogger(冗余博主名)/video_cover_url/video_duration/video_engagement jsonb`,索引 `(status, media_type)`;**无 transcript/play_url 列**(版权红线,arch/02 §3.2);AI 解读列组视频/文字共用:`ai_status/ai_topic/ai_summary/ai_points jsonb/ai_keywords jsonb(M12 批⑥ 新列,文字条关键词 tag)/ai_ran_at/last_ai_error`(语义与契约演进见 arch/02 §3.2 落地注记)
- `blocklist`(屏蔽词)
- `crawl_snapshot`(采集快照档案,2026-10-29 迁移 `crawl_snapshot`):`source_id` FK→crawl_source **CASCADE**/`captured_at`/`url`/`tab`(monthly·quarterly·yearly·page)/`http_status?`/`size_bytes`/`sha1`/`parse_status`(pending/success/failed/empty——pending 残留=worker 中途死亡)/`row_count?`/`error?`/`storage_key varchar(300)`(私有桶 `crawl-snapshots/<sourceId>/<ts>-<tab>.html.gz`)/`has_png`(同前缀 `.png` 整页截图);索引 `(source_id, captured_at DESC)`。行只存元数据,原文在 COS 私有桶;每源保留最近 20 份(应用层裁剪,超量对象+行一并清)

**AI 服务域三表已落地(2026-10-04 M8 批⑥迁移 `ai_service_admin`,治理后台见 [arch/04 §4](04-ai-agent.md))**:

- `ai_model`(模型台账):`provider/protocol/base_url?/model_id`;`api_key_enc?/api_key_mask?`(AES-256-GCM 密文 + 脱敏冗余列,界面仅回显掩码);`purposes text[]`(interpret/summarize/search/cover,绑定校验 `has: role`);`supports_view/concurrency(默认 4)/timeout_sec(默认 60)/enabled` + `last_test` 四件套(tested_at/status ok|fail/error 截 500/latency_ms)
- `ai_task_binding`(任务绑定):`role` 自然主键(四角色)+ `primary_id?/backup_id?` FK→ai_model(`onDelete: SetNull` 仅 DB 兜底,应用层删前先校验解绑)+ `daily_max?`(M9 批⑥:解读日配额条/日,null=默认 100;当前仅 interpret 消费,设置入口 /admin/models 任务绑定卡)
- `asr_config`(ASR 渠道单例 `id=1`,get-or-create):`provider/protocol/base_url?/model_id/api_key_enc?/api_key_mask?/max_audio_seconds(默认 600)/hotwords text[] 默认[]/enabled 默认 false`(无消费方,先配置后启用)+ `last_test` 四件套

对称密钥不入库:主钥 = HKDF-SHA256 从必有的 `AUTH_SECRET` 派生 32B(salt/info 冻结常量,`src/lib/crypto/secret-box.ts`),AES-256-GCM;**`APP_COOKIE_ENC_KEY` 已退役**(M8 批⑥,Cookie 池与 API Key 同箱)——轮换 `AUTH_SECRET` 会使存量密文失效(Cookie 重导、Key 重录);枚举合法值应用层 Zod 管控(§3 同款纪律)。

**站点配置与访问明细已落地(2026-10-04 M10 迁移,体验反馈批)**:

- `site_config`(kv 通用底座):`key varchar(50) PK + value text + updated_at`;value 一律字符串,消费方自行解析 + clamp(键注册表 `SITE_CONFIG_KEYS` + per-key Zod,`src/lib/config/site-config.ts`;缺行/非数值/越界一律回落默认)。**M12 批② value 放宽为 text**(hero_md 存 markdown,varchar(200) 不够)并扩键族:`band.item_count`(默认 12,钳 1..50)/`home.repo_count`(默认 3,钳 1..12)/`home.post_count`(默认 5,钳 1..12)/`site.title`(默认「一起AI」,1..50 字;传播 generateMetadata/Header/Footer/feed.xml/llms.txt)/`home.hero_md`(≤2000 字,空 = 回退内置品牌语)/`site.icp`(2026-10-05,≤60 字,空 = 页脚不渲染备案行;页脚链 beian.miit.gov.cn)/`home.search_terms`(M70,JSON `{words: string[], count: number}`:words 为后台勾选的固定建议词 0..4 个、count 为首页展示个数 3..4;空 words = 全自动取洞察关键词云,装配见 arch/07 §1)
- `stats_visit_log`(近期访问明细,行级):`path varchar(500)/ip varchar(45)/browser/os varchar(50)/device_type varchar(20)/source_class varchar(20)/source_name varchar(50)/visitor_hash varchar(32)/created_at`;索引 `created_at DESC`。**口径例外**:统计族其余表不存明文 IP,此表存全量 IP(2026-10-04 用户定调)但仅 7 天短留存——ingestView 同步落行(不 await 不阻断 beacon,失败仅 warn,聚合口径不受影响),worker 日调度 `visit-log-purge` 清过期行
- `stats_search_log`(搜索词明细,行级,2026-10-06 排行需求):`term varchar(100)/created_at`;索引 `created_at DESC`。口径:/search 页 counted PV 携带的 q(trim + 空白折叠截 100 字,`classify.ts#normalizeSearchTerm`,保留原样大小写),仅 path 为 /search 记;无 PII(不存 IP/访客哈希);行级直插不经缓冲(不 await 不阻断 beacon,失败仅 warn),worker `visit-log-purge` 同 job 清 180 天前行——排行「全部」窗口的实际上界
- `stats_click_log`(条目点击明细,行级,M28 批① 2026-10-14):`surface varchar(20)/kind varchar(20)/ref varchar(100)/domain varchar(100) default ''/created_at`;索引 `created_at DESC`。口径:首页/电报流条目锚点点击(telegram/post 存 BigInt id 文本、project 存冻结 slug,**ref 无外键**,标题读侧反解删除兜底占位);domain 服务端从 target 解析(不信任客户端,站内链接空串);无 PII(循 stats_search_log);行级直插不经缓冲,worker `visit-log-purge` 同 job 清 180 天前。**在线用户不入表**:Redis ZSET `stats:online`(member=`vhash(32hex)|<u|g>:<标识>|path` 定长前缀切片+标识段,score=最后活跃 ms,5 分钟滑窗,键 TTL 24h 兜底),实时读零落库;标识=登录用户用户名(缺省邮箱)或未登录明文 IP(2026-10-14 用户定调承接 WP 展示口径)——仅存本内存键、随滑窗滑出,不入任何表,仅 admin 统计页可见

**混合检索向量表已落地(2026-10-08 M20 批①迁移 `20261008110000_hybrid_search_pgvector`,检索架构见 [arch/04 §3.2](04-ai-agent.md))**:

- `search_embedding`:`entity_type varchar(20)`(post/telegram/repo)/`entity_id bigint`/`model varchar(100)`/`dims int`/`embedding vector(1024) NOT NULL`/`updated_at`;唯一约束 `(entity_type, entity_id)`(upsert 锚),三个分部 HNSW 索引(`vector_cosine_ops`,`WHERE entity_type = '…'` 每域一个);迁移同批 `CREATE EXTENSION IF NOT EXISTS vector`
- 纪律:向量列 pgvector 自定义类型,Prisma 侧 `Unsupported("vector(1024)")` 仅锚 DDL 防 migrate 漂移(field 必须 required,optional 会 diff 出漂移),**读写一律 raw SQL**(`src/lib/search/embedding-repo.ts` 唯一出口;`serializeVector` 产文本字面量经参数化注入);生命周期 = worker 15 分钟对账自愈(缺/陈旧重嵌:post/repo 源时钟 `updated_at`,telegram 无 updated_at 取 `COALESCE(ai_ran_at, created_at)`)+ 孤儿清理(下架/隐藏/回草稿即删);**换绑 embedding 模型 = 维度/语义空间双变,对账时钟感知不到,需手动清表重嵌**

**内容分发域三表已落地(2026-10-06 M17 批①迁移 `20261006122422_publish_channel_wechat`,多渠道分发首渠道=微信公众号,requirement §4)**:

- `publish_wechat_config`(渠道配置单例 `id=1`,get-or-create,镜像 `asr_config`):`appid/app_secret_enc?/app_secret_mask?`(secret-box AES-256-GCM 同箱,AUTH_SECRET 轮换失效重录)/`author?`(图文作者,缺省「一起AI」)/`theme 默认 "default"`(渠道默认正文主题 id,wechat-themes 注册表)/`auto_sync_enabled 默认 false`(发布即推,用户定调默认关)/`enabled 默认 false`(渠道总开关)+ `last_test` 四件套
- `publish_channel`(渠道中立分发状态机):`post_id+channel` 唯一(一期 channel 仅 wechat,CSDN/知乎后置);`status`(pending/synced/failed,应用层 Zod)/`media_id?`(公众号草稿锚——有值重推走 draft/update,清空回落 draft/add)/`title?/digest?/thumb_path?/theme?`(按渠道微调快照,组装优先级 overrides > 行快照 > 文章字段;theme 快照=上次推送所用主题 id,重推沿用,空=渠道默认)/`attempts/last_error?(截 500)/synced_at?`;`data jsonb?`(M49 迁移 `20261026100000_publish_channel_data` 预埋的渠道扩展载荷,文章侧未来渠道用,wechat 行为不变)
- `publish_media_cache`(转存防重推):`channel+source_key` 唯一;`source_key` 前缀分区:`b:<sha1 源字节>`(站内正文图)/`u:<sha1 url>`(外链图)/`m:<sha1 源字节>`(封面,`remote_media_id` 有值);`remote_url`(uploadimg 回传 mmbiz 链,永久有效无 TTL)/`remote_media_id?`(add_material 回传);缓存命中零上传,公众号频控友好

**搜索 Drawer 会话表已落地(2026-10-07 K2.5 批①迁移 `20261006190159_search_agent_session`,交互见 [arch/04 §3](04-ai-agent.md))**:

- `search_agent_session`(会话索引行):`id varchar(40) PK`(会话 id = LangGraph thread_id,建会话即定;**两种形态**:成员 = uuid(36),游客 = `g_<uuid>`(38,kind 标记前缀)——列宽须容得下最长形态;2026-11-17 由 varchar(36) 放宽,此前游客行 upsert 必然超长失败、**从未落库**:后台「会话管理」游客行恒空、#274 的访客标识(uuid)没生效、游客的会话累计 tokens 也不落库(累计闸对游客实际不生效));`visitor_id varchar(36)`(成员会话=归属键:匿名 cookie `ah_av` 或 `admin:<sub>`,归属校验锚——非本人 404 不泄露存在性;;`title? varchar(40)`(首条用户消息前 20 码点,run 收尾回填仅空行);`tokens_total int 默认 0`(会话累计护栏口径);`created_at/last_message_at`(touch 于每次 run 收尾);索引 `(visitor_id, last_message_at DESC)` 列表 + `last_message_at` 30 天日清扫描。**消息轨迹不在本表**——存 LangGraph checkpoint 表框架(`setup()` 自管,不进 Prisma migrations,§1 边界);删除 = 行+checkpoint 同删(用户 DELETE 路由 / worker 日清 `purge-agent-session` 双入口,checkpoint 删失败不反噬)
- `ai_usage_log.session_id`(K2.6 迁移 `20261007045121_ai_usage_log_session_id` 增列):`varchar(40)?` 会话/线程锚 + `idx_ai_usage_log_session`——Agent 台账行记 threadId(后台会话管理聚合口径,游客线程 `g_<uuid>` 也落此锚),他类调用缺省。游客线程 thread_id=`g_<uuid>`,归属 Redis `search:agent:gthread:{id}`(2h 滑动 TTL,不入库;**M58 批⑤ 后续起同 id 落匿名会话行**,行与内容按 30 天日清,归属键只决定能否继续追问);无留档行的历史线程 checkpoint 仍按「键已消失」日清扫;后台游客统计 = 本表按 session_id 聚合 ∪ 留档行(标题/tokens 以行为准)

**账号邮箱通道与支付域已落地(2026-10-08 M21 批⓪/批①迁移 `20261008221317_m21_batch0_email_auth` + `20261008143451_m21_batch0_email_config` + `20261008145247_m21_payment_schema`,方案定稿 M21 付费阅读提案 v1.6,批⑦ 落 arch/09)**:

- `user_account` 增列(批⓪,D1 邮箱通道——注册→邮件认证→用户名/邮箱/手机号任一标识登录):`username? varchar(100)` 唯一(`uq_user_account_username`)/`email? varchar(255)` 唯一(`uq_user_account_email`)/`email_verified_at?`
- `user_verification_token`(批⓪,一次性令牌):`user_id+purpose+token_hash char(64)`(sha256,原始令牌只出现在邮件链接)/`expires_at/consumed_at`;purpose 枚举 `register_verify|bind_email|password_reset`(应用层管控);单次消费 + 同 purpose 重签作废未消费旧令牌;索引 `(user_id, purpose)`
- `email_config`(批⓪,SMTP 配置单行语义——2026-10-08 拍板入数据库,不入 env,与网关凭据同规则):`host/port(默认 465)/username/password/from_addr/enabled 默认 false`;password 只写不读(API 永不回传,留空=保留),明文不入日志;消费方 transport 按 `id:updated_at` 换新,保存即时生效
- `pay_order`(订单):`order_no varchar(32)` 唯一(幂等键)/`user_id`(**无 FK,支付域与账号域解耦,应用层归属校验**)/`status varchar(16)` 枚举 `pending|paid|closed|refunded`(显式状态机,提案 §5.2 只允许图中迁移)/`amount decimal(10,2)`(**金额全程 Decimal 禁 float**)/`gateway varchar(24)` 枚举 `xunhu|mock|legacy_xunhu`/`gateway_transaction_id?`(微信流水,对账锚点——旧系统缺失项)/`gateway_open_order_id?`(虎皮椒内部单号)/`paid_at?/closed_at?/refunded_at?/expires_at`(pending 超时关单依据)/`client_ip?/operator_note?`;索引 `(user_id,status)` + `(status,expires_at)`(对账 job 扫描路径)
- `pay_order_item`(订单行):`order_id` FK→pay_order(唯一 FK,默认名);`post_id` 标量无 FK/`title varchar(200)`(下单时标题快照)/`unit_price decimal(10,2)`/`quantity 默认 1`;索引 `post_id`
- `content_post_purchase`(付费权益):`(user_id,post_id)` 唯一(一文一用户一条,授予=upsert `revoked_at=null`);`order_id?`(仅 order 来源必有,import/manual/admin_restore 可空)/`source varchar(16)` 枚举 `order|import|manual|admin_restore`/`revoked_at?/revoked_reason?`(退款 CD 回调软撤销,审计可恢复);索引 `post_id`
- `pay_notify_log`(回调留痕):`order_no/gateway_status varchar(8)` 枚举 `OD|WP|CD|RD|UD`/`sign_valid/payload jsonb`(回调原文全量存,可追溯伪造尝试)/`handled 默认 false`(是否触发状态迁移);索引 `order_no`
- `pay_gateway_config`(网关凭据,2026-10-08 拍板入数据库):`gateway varchar(24)` 唯一(枚举 `xunhu|mock`)/`app_id/app_secret`(明文列,admin 专属页唯一写入口——批⑤,读取一律脱敏,明文不进日志/API 响应/git;日后可升级应用层加密)/`api_base`(主用 `https://api.dpweixin.com`,2026-10-08 线上实证)/`api_base_backup?`(备用域)/`enabled 默认 false`(收银台总开关)
- `content_post` 增列(批①):`is_purchasable bool 默认 false`(付费解锁开关)/`purchase_price? decimal(10,2)`(解锁价 CNY,仅开关开启时有意义)
- `content_post` 增列(M71,迁移 `20261113120000_m71_post_author`):`author_id? bigint` FK→`user_account(id)` ON DELETE SET NULL(归属可空、父行删除后文章留档;FK 列自建索引 `idx_content_post_author`);**只在建稿时落一次**——作者=首创者,后续人工/agent 改稿不改作者(审稿人另由审核流记录);154 篇迁移旧文与存量稿保持 NULL

**短信认证通道已落地(2026-10-31 M65 迁移 `20261031180000_m65_user_sms_config`,链路见 [arch/05 §3.4](05-services.md))**:

- `user_sms_config`(阿里云 PNVS 短信认证配置单例 `id=1`,get-or-create,镜像 `email_config` / `admin_feishu_config` 形态——2026-10-31 拍板凭据入数据库不入 env):`access_key_id varchar(100)` 默认 `''`(空=未配置)/`access_key_secret_enc?/access_key_secret_mask?`(secret-box AES-256-GCM 同箱,只写不读、留空=保留原值)/`sign_name varchar(50)`(PNVS 签发签名名,可轮换故不入 env)/`template_code varchar(50)` 默认 `100001`(PNVS 预置模板:100001 登录/注册,100002/100004/100005 绑定场景)/`enabled bool 默认 false`(**通道总开关,同时是登录页短信页签的唯一门控**——关闭或凭据不全时端点 503、页签隐藏)/`daily_limit int` 默认 200(日发送预算熔断)/`last_test_*` 四件套(后台下发探针留痕);**验证码由服务商托管,本站不落库、不缓存**

**飞书免登域两表已落地(2026-10-14 M29 批①迁移 `20261014160000_admin_feishu_sso`,交互与兑换链见 [arch/05 §3.1](05-services.md))**:

- `admin_feishu_config`(应用凭证单例 `id=1`,get-or-create,镜像 `email_config`/`publish_wechat_config` 形态;2026-10-14 拍板凭证入数据库不入 env):`app_id varchar(50) 默认 ''`/`app_secret_enc?/app_secret_mask?`(secret-box AES-256-GCM 同箱,AUTH_SECRET 轮换失效重录)/`enabled 默认 false`(免登兑换总开关——绑定/appId 下发只要求凭证齐,enabled 可后开)/`last_test` 四件套(探测 app_token+jsapi_ticket 双链路)
- `admin_feishu_binding`(免登白名单本体,fail-closed:兑换仅 unionId 精确命中行放行):`user_id bigint` 唯一(`uq_admin_feishu_binding_user`,一账号一身份)/`union_id varchar(64)` 唯一(`uq_admin_feishu_binding_union`,一身份一账号)/`open_id varchar(64)`/`feishu_name? varchar(100)`(兑换时姓名快照);**无 DB 外键,应用层完整性**(跨锚冲突 409;目标账号 role/status 兑换时复核,失配拒绝)

**Agent 技能表已落地(2026-10-14 M30 批①迁移 `20261014200000_agent_skill`,机制与工具面见 [arch/04 §3 K2.8 补注五](04-ai-agent.md))**:

> **退役(2026-11-15,M72 瘦身 B7 / D7)**:`agent_skill` 表已随迁移 `20261115094500_b7_drop_agent_skill` 删除,后台「写作技能」页与 `/api/agent-skills/**` 一并下线——真相源改为仓库 `skills/writing/*.md`(MCP `list_skills`/`get_skill` 与素材包导出读同一份)。`topic.skill_key` 列保留(soft ref),PATCH 存在性核改判仓库 md 是否有该 key。下文为历史落库记录。

> **专题(创作台账)域整体退役(2026-11-15,M72 瘦身,用户拍板「彻底删」)**:迁移 `20261115103000_remove_topic_system` 删除 `topic` / `topic_item` / `writing_sample_image` 三表,并去掉 `content_pin.topic_id` 列与 `idx_content_pin_topic_updated` 索引 —— 创作职责已整体外移线下 Claude Code(MCP 25 只工具 + 仓库 `skills/writing/*.md`),站内的「素材攒集 + 写作配置 + 关联稿」台账不再是取料必需(线下走 `list_signals` / `search_site` / `get_telegram_item` 直接取料)。存量规则不丢:价格表稿的公众号「阅读原文」落点原由 `topic.skill_key` 判别(M55 批E),迁移里按 topic 关联回填为文章标签 `slug=model-pricing`,判别载体随之换标签。下文为历史落库记录。

- `agent_skill`(通用技能表——写作指南/分发流程等知识型流程纪律,后台「模型配置→Agent 技能」页签建改即时生效零发版):`key varchar(50)` 唯一(`uq_agent_skill_key`,agent 稳定引用,**建后不可改**)/`name varchar(100)`/`scenario varchar(200)`(一行,agent 选 skill 时对号场景)/`guide_md text`(指南正文 markdown,可引用既有工具名)/`enabled bool 默认 true`(停用后 agent 侧 list/get 即时不可见);key 格式 `^[a-z0-9]([a-z0-9-]{0,48}[a-z0-9])?$` 应用层 Zod 管控
- `topic.skill_key`(批②迁移 `20261014210000_topic_skill_key` 增列):`varchar(50)?` 绑定技能稳定引用——**soft ref 无 FK**(skill 删/停后合成写稿降级为按场景自动匹配,不阻塞);PATCH 存在性+启用核验 400

**系统出口代理单例已落地(2026-10-14 M33 批B迁移 `20261014220000_system_proxy_config`,网关接线与代理语义见 [arch/05 §4.4](05-services.md))**:

- `system_proxy_config`(全局单点家宽出口,采集网关全部出站过境;**id=1 锚点 get-or-create,镜像 `admin_feishu_config` 形态**):`proxy_url_enc? varchar(500)`(secret-box AES-256-GCM,AUTH_SECRET 轮换失效重录)/`proxy_url_mask? varchar(60)`(`scheme://host:port` 脱敏冗余列,凭据段剥除永不回显)/`enabled 默认 false`(总开关,关闭=全部直连配置保留)/`last_test` 四件套(经网关 `/proxy-test` 探 B 站一跳);**网关零密钥不变**——worker 解密后随网关请求携带,代理地址不落网关不进日志

**任务运行台账已落地(2026-10-19 验收二批③迁移 `20261019120000_job_run_log`,调度接线与读侧页签见 [arch/05 §4](05-services.md))**:

- `job_run`(系统周期/手动批任务运行记录——BullMQ removeOnComplete 只留近几次,挂死/失败/耗时无处可查;学习 ai-invest collector_log 单一写入口形态):`job_key varchar(60)`(`queue/jobName` 稳定键,如 `insight/fetch`)/`queue varchar(40)`/`job_name varchar(60)`/`trigger varchar(10)` 枚举 `cron|manual`(jobId 带 `-manual-` 即 manual)/`status varchar(10)` 枚举 `running|success|failed`(**先落 running 行再执行——挂死立即停留可见,不必等超时**)/`started_at/finished_at?/duration_ms?`/`summary jsonb?`(处理器返回值,超 4000 字符截为 `{truncated,preview}`)/`error? text`(截 4000);索引 `idx_job_run_recent(started_at DESC)` + `idx_job_run_key_recent(job_key,started_at DESC)`。**单一写入口=worker 分发器包装**(worker/job-run#withJobRunLog,白名单 14 批任务 ≈400 行/日;tick 心跳与请求驱动单元任务不入账);30 天保留,04:47 日清批顺带把 running 超 24h 的崩溃残留代标 failed 收口

**配图工坊三表已落地(2026-10-22 M40 批 B 迁移 `20261022090000_m40_illustration_studio`,队列纪律与契约见 [arch/05 §4.7](05-services.md);forward-only,三 FK 无 onDelete 默认 RESTRICT 语义显式声明)**:

- `ai_illu_version`(版本链,编辑评审史):`media_path varchar(500)`(整图站内路径)/`parent_version_id?`(自引用 FK `SET NULL`,根版本 null;单链逐级回溯)/`origin varchar(20)` 枚举 `original|text_edit|erase|redraw`(应用层 Zod 管控)/`name? varchar(200)`(展示名,登记时从提示词派生前 40 字,链内随根继承;NULL=历史行展示兜底「配图 #id」,2026-10-23 F13/F14 对齐批加列)/`source? varchar(20)` 枚举 `agent|studio`(登记口:agent 会话生图/工坊直出;NULL=历史行不显来源)/`edit_instruction? varchar(1000)/edit_bbox? varchar(40)`(normalized `"x1 y1 x2 y2"`);索引 parent + media_path(`ensureStudioRoot` get-or-create 查询锚)
- `ai_illu_layer_group`(图层组=一次拆层运行):`version_id` FK **RESTRICT**/`base_media_path?`(干净底板,ready 后回填)/`status varchar(12)` 枚举 `processing|ready|failed`/`error? varchar(500)`(人话失败原因)/`model_id`(溯源列入队时定格,绑定主备选边同 resolver 口径,无绑定 0);索引 `(version_id, created_at)`(取最新组)
- `ai_illu_layer`(图层行):`group_id` FK **CASCADE**(重拆清旧组连图层)/`z_index/name varchar(200)/description? varchar(500)`/`bbox_x1..bbox_y2 int`(normalized 0-999,左上原点)/`media_path`(bbox 区域高分重提透明 PNG)/`visible bool 默认 true`(显隐组合持久化,导出前端合成);索引 `(group_id, z_index)`

**贴图三表已落地(2026-10-22 M41 迁移 `20261022150000_m41_content_pin`,队列与接口见 [arch/05 §4.8](05-services.md)、URL 终态见 [arch/07 §2](07-frontend.md);forward-only)**:

- `content_pin`(贴图主实体,公众号「小绿书」newspic 图片帖):`title varchar(64)`(≤32 码点公众号硬上限,VarChar 留字节数余量)/`content text 默认 ''`(轻文字纯文本,禁 Markdown/内联 HTML,≤2 万码点)/`topic_id?`(专题 soft ref,应用层完整性不设跨域 FK,同 `topic.linked_post_id` 口径)/`status varchar(20) 默认 draft` 枚举 `draft|pending|synced|published`(应用层 Zod,人工迁移表 `PIN_MANUAL_TARGETS` 收敛)/`read_more_url? varchar(500)`(阅读原文,http(s) 白名单)/`crop_spec varchar(40) 默认 1_1`(封面裁剪档 `1_1|16_9|2.35_1`,随 draft/add 透传)/`reference_media_path? varchar(500)`(M42 生图采纳的参照图,见下)/`synced_at?/published_at?`(首进 published 落,回退再上架不覆盖);索引 `(status, updated_at DESC)`(工作台页签)
- `content_pin_image`(有序图片,首张即封面——公众号 `image_list` 顺序 = sort_order,站点瀑布流封面同源):`pin_id` FK **CASCADE**(删贴图连图)/`version_id?`(引用 `ai_illu_version` soft ref 不拷文件不回写,本地上传为 null)/`media_path varchar(500)`(**挂载时快照**——工坊后续改字产新版本不篡改已挂序列,升版由人工在组装台重挂)/`width?/height?`(本地上传取自然尺寸;工坊引用缺省)/`sort_order`;索引 `(pin_id, sort_order)`
- `content_pin_channel`(渠道留痕,每贴图×渠道一行,`@@unique([pinId, channel])`,循 `publish_channel` ensure 形态):`channel varchar(20)`(wechat\|xiaohongshu——M49 批X1' 放行 xiaohongshu,小红书笔记载体=贴图,发布锚存笔记 URL)/`status varchar(20) 默认 pending` 枚举 `pending|synced|failed`/`media_id?/publish_id?`(公众号草稿/发布锚(小红书=笔记 URL),重推 update 以 media_id 定位)/`attempts`(含人工重试)/`last_error? varchar(500)`(人话)/`synced_at?`;`pin_id` FK **CASCADE**

**创作中心域扩列已落地(2026-10-22 M42 迁移 `20261022180000_m42_studio_output`,概念重构见 [arch/05 §1](05-services.md)、创作台信息架构见 [arch/07 §2](07-frontend.md);forward-only,全部 ADD COLUMN 带缺省不锁表)**:

- `topic.output_type varchar(20) 默认 article`:主意图枚举 `article|pin`(应用层 Zod `TOPIC_OUTPUT_TYPES`)——**只决定新建默认面板与 agent 分支,不限制另一种产出**(产出区恒有「生成长文」「生成贴图」两个动作);回填规则幂等:无 `linked_post_id` 且已有 `content_pin` 挂靠的存量行标 `pin`
- `topic.pin_positioning? varchar(1000)`:贴图配置条款文本(张数/比例/首图裁剪/风格/参照图 + `【补充要求】` 块),与长文 `positioning` **独立列、互不派生**(各自 `writing-config.ts` / `writing-pin-config.ts` 往返,未识别行无损收进补充块)
- 关系口径(均 **soft ref,应用层完整性**):长文 1:1 走 `topic.linked_post_id`;**贴图 N:1 走 `content_pin.topic_id`**(不新增关联表,删创作由编辑侧改挂)
- `content_pin.reference_media_path? varchar(500)`:本次生图采纳的参照图(站内 `/wp-content/uploads/` 路径,soft ref;缺省回落创作样例图/素材封面),让「按素材出图」可追溯可复现
- 索引 `idx_content_pin_topic_updated (topic_id, updated_at DESC)`:创作台按创作聚合贴图产出

**洞察 v2 数据域已落地(2026-10-30 M58 三批迁移 `20261030100000_m58_signal_lang_region` / `20261030120000_m58_entity_event` / `20261030130000_m58_leaderboard_snapshot`;表名于 M62 归一为域前缀写法 `insight_entity_event` / `insight_leaderboard_snapshot`;口径见 [arch/01 §3](01-data-source.md);forward-only,枚举一律 varchar 由应用层 Zod 收口)**:

- `insight_signal` 增列(批①,中文化基座):`lang? varchar(10)`(zh/en/…,源级声明、混合源逐条覆盖)/`region? varchar(10)`(cn/global)/`translated_text? text`(中文译文;原文恒在 `raw_text`)/`translation_status varchar(10) 默认 none`(none|pending|done|failed);`cluster.region? varchar(10)`(按成员多数派回写 cn|global|mixed)
- `insight_entity_event`(批②,厂商事件层):`source varchar(30)`(`vendor-<key>`,与洞察 source 同口径)/`vendor varchar(30)`(注册表 key)/`entity_type varchar(12)`(model|product|org)+ `entity_key varchar(120)`(实体规范名,如 deepseek-v4)/`event_type varchar(20)` 枚举 `release|price_change|open_source|funding|deprecation|benchmark_change`/`title varchar(300)`/`summary? varchar(1000)`/`url varchar(500)`/`occurred_at`/`dedupe_key char(40)` **唯一**(sha1(source|url|eventType|entityKey),同 URL 多实体不互相吞并)/`meta jsonb?`;索引 `(vendor, occurred_at DESC)` + `(event_type, occurred_at DESC)` + `idx_insight_entity_event_entity_recent (entity_key, occurred_at DESC)`(M59 增,实体聚合列表与详情时间线共用)。事件同时按 dedupeKey 作 refId 进洞察池(`source=vendor-<key>`),可回溯到事件行
- `insight_leaderboard_snapshot`(批③,榜单时序):`source varchar(30)`(注册表 key)/`board varchar(40)`(榜单展示名)/`entity_key varchar(200)`(模型 slug·arXiv id·owner/repo)/`entity_name varchar(300)`/`entity_type varchar(12)`(model|paper|repo)/`vendor? varchar(60)`/`rank int`/`score? float8`/`score_unit? varchar(20)`/`captured_date date`(北京日界 UTC 零点)/`meta jsonb?`(`{url, sourceId}`);唯一键 `(source, board, entity_key, captured_date)`(同日重跑整表覆盖),索引 `(source, board, captured_date DESC)`(读侧取最新与上一可用日期)。名次变动**不落库**,读时相减
- 批④(社区需求语料)**无 schema 变更**:四源统一落 `insight_signal`(`source=community-<key>`,`ref_id` 直接复用唯一键作幂等锚);日预算走 Redis(`insight:community:quota:<key>:<北京日>`,不落库);取数原文复用 `crawl_snapshot`
- 批⑤(站内问句清洗复活)**无 schema 变更**:`source=internal-agent` 复用 `insight_signal`(refId=sessionId,游客为 `g:<threadId>`);入口标签进 `meta.surface`;游客首问判定键走 Redis(`search:agent:ask-recorded:<threadId>`,TTL 6h,不落库、不存 visitorId)
- M59(洞察浏览与实体层)**无 schema 变更**,仅一迁移 `20261030160000_m59_entity_key_index` 增上述 `idx_insight_entity_event_entity_recent`:实体聚合视图(`/admin/insight/entities/`)只基于 `insight_entity_event` 分组,**不 join** `insight_leaderboard_snapshot`(后者 entityKey 口径不同);实体↔厂商信号关联走 `insight_signal.meta.entityKey`(JSON 路径等值),社区/热榜信号未挂实体;M64 起 AA / HF 两榜快照另有 `entity_id` 直连实体,其余源仍不关联
- M60(实体分层/覆盖矩阵/未命名治理)迁移 `20261030200000_m60_entity_registry`,实体注册表落地:
  - `insight_entity`(实体主表):`key varchar(120)` **唯一**(规范键,展示/URL 用)/`match_key varchar(120)` **唯一**(分隔符归一的去重锚,`gpt-6.1-terra` 与 `gpt-6-1-terra` 同锚)/`display_name varchar(120)`(保留大小写,如 `Qwen3-Embedding`)/`entity_type varchar(12)`(`org|line|model|product`)/`vendor_key? varchar(30)`(所属厂商;org 自身为 null)/`parent_id? bigint`(自关联,`ON DELETE SET NULL`)/`status varchar(10)` 默认 `active`(`active|merged`)/`merged_into_id? bigint`(归并去向留痕);索引 `(vendor_key)`、`(parent_id)`
  - `insight_entity_alias`(别名表):`alias_key varchar(120)` **唯一**(`normalizeEntityKey` 原样产物)/`entity_id`(Cascade)/`origin varchar(10)`(`seed`=建表回填/`rule`=写入解析/`manual`=人工归并)/`confidence? float8`;索引 `(entity_id)`。归并只改指向、不改历史键
  - `insight_entity_event` 增 `entity_id? bigint`(FK → `insight_entity`,`ON DELETE SET NULL`)+ 索引 `idx_insight_entity_event_entity_id`;`entity_key` 原样保留——`dedupe_key` 唯一锚不动,归并不改写历史键
  - 口径见 [arch/01 §3.3](01-data-source.md);存量回填 `scripts/ops/insight-entity-backfill.ts`(`npm run insight:entity-backfill`,幂等)
- M62(数据库命名规范化与结构收口)迁移 `20261031120000_m62_db_naming`,不新增表,只把既有结构收口到 [standard/03-db-naming](../standard/03-db-naming.md) 规范态:
  - 表重命名 `entity_event → insight_entity_event`、`leaderboard_snapshot → insight_leaderboard_snapshot`(手写 `ALTER TABLE RENAME`,连带 PK/FK/唯一/索引改名)
  - 5 处 Prisma 默认名唯一索引改 `uq_*`;3 个 pgvector HNSW 索引补 `idx_` 前缀;`content_post_like` / `content_post_comment_like` 唯一索引改复合主键
  - 补 15 处真实引用的 FK(3 处已在),并补齐对应 9 个 FK 索引;`ai_cover_candidate.model_id` 放宽为可空
  - 5 张明细表补 `created_at`(`pay_order_item` / `content_post_tag` / `content_media_ref` / `github_repo_post` / `insight_cluster_member`),按父表时间回填
  - 刻意不加 FK 的多态/聚合引用与类型例外登记在 standard/03 §7
- M64(榜单口径与实体层打通)迁移 `20261031160000_m64_leaderboard_entity`,`insight_leaderboard_snapshot` 增 `entity_id? bigint`(FK → `insight_entity`,`ON DELETE SET NULL`)+ 索引 `idx_insight_leaderboard_snapshot_entity`:仅 Artificial Analysis / Hugging Face 两源在采集写入时解析挂接(`src/lib/insight/entities/leaderboard.ts` 为唯一出口,只读、未命中留 null 不阻塞采集),`entity_key` 原样保留;实体归并时同事务把快照改指目标实体。存量回填 `scripts/oneoff/leaderboard-entity-backfill/run.ts`(默认 dry-run,幂等)

**渠道入站会话域六表(2026-11-01 M66 立项,方案见线下开发计划(过程性方案文档,不入库);新前缀 `channel_` 已登记 [standard/03 §2](../standard/03-db-naming.md))**:

- `channel_wechat_mp_config`(公众号入站单例 `id=1`,get-or-create):`token varchar(32)`、`encoding_aes_key_enc? varchar(200)` + `encoding_aes_key_mask? varchar(20)`(secret-box 密文 + 脱敏冗余)、`enabled`、`greeting_text`/`fallback_text`/`handoff_text`、`handoff_keywords text[]`、`daily_answer_limit int 默认 200` + `last_test` 四件套;**`appid`/`appsecret` 不复制**——一律经 `publish_wechat_config` 单源读取(同号同凭据)
- `channel_wechat_mp_user`(公众号侧用户,openid 锚):`openid varchar(64)` 唯一、`unionid?`、`user_id?` FK→`user_account`(`ON DELETE SET NULL`,一次性绑定码建立)、`nickname?`/`avatar_url?`、`is_subscribed`/`subscribed_at`/`unsubscribed_at?`、`last_message_at?`、`message_count`、`is_manual_pending`;索引 `(user_id)`(FK 必配)、`(last_message_at DESC)`
- `channel_wechat_mp_message`(问答明细,append-only 仅 `created_at`):`channel_user_id`(Cascade)、`wechat_msg_id varchar(100)` **唯一**(微信 `MsgId`,事件用 `FromUserName+CreateTime` 派生,幂等锚)、`direction`(in/out)、`msg_type`(text/event)、`event?`、`content text`、`reply_kind?`(keyword/rag/timeout/continue/handoff/fallback/welcome/help)、`answer_status?`(ok/no_evidence/error/truncated)、`latency_ms?`、`ai_usage_id?` FK→`ai_usage_log`(SetNull);索引 `(channel_user_id, created_at DESC)`、`(created_at)`(180 天清理)、`(ai_usage_id)`
- `channel_wechat_mp_lead`(转人工线索):`channel_user_id`(Cascade)、`message_id?`(SetNull)、`reason varchar(200)`、`status`(open/handled)、`note? text`、`handled_at?`;索引 `(status, created_at DESC)`、`(message_id)`、`(channel_user_id)`
- `channel_wechat_mp_keyword`(关键词直连):`keyword varchar(50)` 唯一、`post_id?` FK→`content_post`(SetNull)、`reply_text?`、`is_enabled`、`hit_count`;索引 `(post_id)`
- `channel_feishu_alert_config`(站务通知单例 `id=1`):`app_id varchar(64)`、`app_secret_enc?` + `app_secret_mask?`、`chat_id varchar(100)`、`chat_name varchar(100)`、`enabled`、`is_notify_handoff`、`is_notify_daily`、`daily_summary_hour int 默认 9` + `last_test` 四件套。**凭据只入库**(用户裁定:不 hardcode、不入 env);与 M29 免登飞书应用互不相干

表外状态全走 Redis(不落库):绑定码 `channel:wxmp:bind:<code>`(10min)、待继续指针 `channel:wxmp:pending:<openid>`、答案缓存 `channel:wxmp:reply:<msgId>`(30min)、当日答案配额 `channel:wxmp:quota:<北京日>`。

**牌价策展域两表已落地(2026-10 M55 批C 起;2026-11-14 M73 补 `is_pinned`)**:

- `model_pricing`(模型牌价):`vendor + model_key` 唯一;`currency`(CNY|USD,**随价格走**,防「¥ 数字配 $ 符号」的跨通道脏态)/`input_price`/`output_price` decimal(12,4)(每百万 tokens;null=未公布不臆测)/`free_tier?`/`context_window?`/`note`(溯源注记与「待复核」打标共用列)/`data_as_of`/`source_url`/`region`(cn|intl)/`status`(pending|enabled|disabled)/`sort_order`;索引 `(status, region, sort_order)`
- `coding_plan`(Coding Plan 订阅套餐):`vendor + plan_name` 唯一;`monthly_fee`/`quarterly_fee`/`yearly_fee` decimal(12,2)(周期展示价,口径不归一随原文)/`billing_note?`(周期价格口径原文)/`benefits` jsonb(string[],官方页序)/`quota_desc`(额度口径原文)/`peak_rate?`/`off_peak_rate?`/`best_for?`/`note`/`data_as_of`/`source_url`/`status`/`sort_order`;索引 `(status, sort_order)`
- **两表共有 `is_pinned boolean default false`**(M73,迁移 `20261114112350_pricing_is_pinned`):人工定稿闸 —— 采集能否覆盖**只看此列**,与 `status`(展示态)解耦。此前「终审行(enabled/disabled)采集不覆盖」这条规则借 `status` 表达,把「是否展示」与「是否人工定稿」挤进一列,于是「停用展示但希望价格跟随官方价」无法表达、过期价格只能人工改库(2026-11-14 用户纠正:这类问题该由后台界面提供入口,不该直改库)。落库规则(M73):行不存在→建 pending;`is_pinned=false`→刷新(**不论展示态**);`is_pinned=true`→不覆盖(人工定稿)。存量回填:`status='enabled'` 的行置 `is_pinned=true`(保持「采集不覆盖已展示价格」的现状语义),其余行 false。采集台账入日志 `pricing.curated_persisted`(`untouched`=因人工定稿未覆盖的行数,此前 tally 被丢弃、「采集成功但价格没变」在日志里看不出来)

**牌价归一层三表已落地(2026-11-15 M74 批A,迁移 `20261115114118_m74_pricing_schema`)**:

牌价行的 `vendor` 是各采集器写死的自由文本(同一厂商多种写法,如「月之暗面 Moonshot」与
「月之暗面 Kimi」),既无法按厂商聚合,也无法区分「一手厂商价」与「聚合平台挂牌价」——
后者正是「找全网最便宜提供方」的关键维度。批A 落三张字典/档位表,不动既有采集行为:

- `model_pricing_provider`(厂商字典):`key` 唯一(规范键,`aliyun-bailian`/`baidu-ciyuansuo` …)/
  `name`(展示名)/`display_order`/`region`(cn|intl)/`source_kind`(official 一手厂商 | aggregator
  聚合交易平台)/`homepage_url?`/`status`;索引 `(status, display_order)`。
  种子 10 家在 `src/lib/pricing/provider-registry.ts`,worker 启动幂等种入
  (`syncPricingProviders`,**只补缺不改值**——名称/排序/官网归人工维护)。
  `VENDOR_KEY_ALIASES` 是采集器 vendor 字符串 → 规范键的桥,**采集侧改写 vendor 字符串时必须同步**
- `model_pricing_model`(模型字典):`model_key` 唯一(规范键,跨源可比对)/
  `match_key` 唯一(归一锚,摘日期快照与别名后缀:`gpt-4o-2024-08-06` → `gpt-4o`)/
  `display_name`/`family?`(产品线,`deepseek-flash` → `deepseek`)/`modality`(text|text+vision|image|
  audio|video|embedding|rerank)/`status`;索引 `(family)`。
  归一**唯一出口** `src/lib/pricing/model-registry.ts#getOrCreateModel`(model_key/match_key 任一命中即复用);
  归一规则(`normalizeModelKey`/`normalizeMatchKey`/`deriveFamily`)在 `src/lib/pricing/normalize.ts`,
  纯函数零库依赖,与洞察域 `normalizeEntityKey` 同一套口径
- `model_pricing_tier`(价格档位):一行两价承载不了真实定价——阶梯价(按上下文分档)、缓存价
  (命中/未命中)、峰谷价(时段)、模态计价(按张/秒/分钟)压成两个 decimal 就是在说谎。
  `model_pricing_id` + `tier_label` 唯一;`input_price?`/`output_price?`/`cache_price?` decimal(12,4)/
  `min_tokens?`/`max_tokens?`(阶梯边界)/`unit`(per_1m_tokens|per_1k_tokens|per_image|per_second|
  per_minute)/`currency`/`data_as_of`/`source_url`/`note?`;索引 `(model_pricing_id)`;
  `onDelete: Cascade`(档位随牌价行消亡)
- `model_pricing` 增列(M74):`provider_id?` FK→`model_pricing_provider`(`SetNull`,索引)/
  `model_id?` FK→`model_pricing_model`(`SetNull`,索引)——**同一模型在不同提供商的牌价行不去重**,
  靠 `model_id` 归一后并排比价;`is_free boolean default false`(索引)=**完全免费**
  (所有档位价均为 0;与 `free_tier`「有免费额度」语义分离,缺价 null 不当免费)
- **M74 批B1 落库口径**(2026-11-15,`src/lib/pricing/model-persist.ts`):采集写入时一并完成
  ①**归一关联**(`provider_id`/`model_id`;厂商认不出 → `provider_id` 留 null,不猜);
  ②**档位写入**(源解析出阶梯/缓存/峰谷/模态时,整行档位替换落 `model_pricing_tier`;
  行上两价仍是「基准价」——多时段价取**最高**价,不把优惠窗当常态价);
  ③**免费双标识**(`is_free` 完全免费 = 行价与全部档位价均为 0,缺价 null 不当免费;
  `free_tier` 免费额度原文,采集侧起采,与「完全免费」是两种语义);
  ④**下线墓碑**(成功采集且本次有行时:本源超 3 天未被刷新 = 采集没再解析到它 →
  `status=disabled` + note 打「源已下线」;人工定稿行 `is_pinned=true` 不参与)
- **档位订正入口**(M74 批C2):`PUT /api/pricing/models/[id]/tiers` 整行档位替换
  (与采集侧 replaceTiers 同口径:档位集按源整批刷新,不增量合并);档位唯一键是
  (牌价行, 档位名),故同名档位拒绝提交;采集下一轮会用源里的完整档位集覆盖,
  人工改的值要长期生效需在行上打开**人工定稿**闸(is_pinned)
- **源健康度读侧**(M74 批C2):`src/lib/pricing/health.ts` 装配每源的健康状态与
  连败、最近/下次采集、产出行分布(待终审/已上架/**待复核**)、最近一次采集快照
  的结论(解析状态 + 错误原文)。源与行按 **vendor** 对应(不靠 URL——渠道 URL 会被
  后台改,历史默认 URL 迁移过);「待复核」(采集失败整源打标)与「待终审」(pending)
  是两回事,分列
- 存量归一回填:`scripts/oneoff/m74-pricing-backfill/run.ts`(一次性,dry-run 默认,幂等)。
  **认不出的厂商不动**(`provider_id` 留 null)并在报告里点名——猜错厂商比不归一更糟
- 上下文长度不落字典表:各家截断不同(同一模型在官方与聚合平台给的上下文不一样),
  按行给在 `model_pricing.context_window`,筛选时解析
- **行级计价单位**(M74 批G,迁移 `20261116230844_m74_pricing_price_unit`):
  `model_pricing.price_unit`(per_1m_tokens|per_1k_tokens|per_image|per_second|
  per_minute,默认 per_1m_tokens)。此前单位只在档位表,主行两价被隐式当成
  百万 token 价——按张/按秒价(文生图/文生视频)混进 token 比价就是污染。
  非 token 行:生成价(单价格)落 `output_price`,`input_price` 为 null
  (百炼按张双价形态例外:`input_price`=按张输入价);**排序/比价/散点必须
  按单位分口径**(前台批G 落地)。采集侧三源已按表级单位闸识别
  (volcengine 表头单位、siliconflow 行 id 分区+单位标签、bailian 表头/首行
  元/张·元/秒),单位不明的表整表跳过——宁可少收不可错收
- **火山视频口径**(M80,2026-11-27 实探):方舟牌价页的视频表是「模型 | 价格口径 |
  480p | 720p | 1080p | 4K」,每模型两行——「视频单价（元/个）」(按片价,随视频
  时长变动)与「**折合价格（元/秒）**」(官方自己给的每秒口径)。**行价取折合价**,
  各分辨率折合价落档位(档名=分辨率),`price_unit=per_second`——与百炼/百度按秒
  价同口径,可比价、可算场景成本;按片价只进 `note`(不进行价:同型号不同时长价
  不同,一个数说不清)。另有一张「视频价格范围（元/个）」表(如 480p 3.63～14.12),
  那是同一每秒价按时长展开的区间(3.63/0.672 ≈ 5.4s、14.12/0.672 = 21s),
  不另立口径、不采
- **模态判定**(M74 批G):`src/lib/pricing/modality.ts` 模型名关键词保守推断
  (seedream→image、seedance/t2v→video、bge→embedding…,认不出返回 null 不猜);
  优先级 源显式标注(siliconflow 行 id 分区 / bailian 按张表) > 关键词 > 字典现值
  > text;`getOrCreateModel` 对既有字典行只做 **text→非text 单向升级**(绝不降级,
  避免与人工订正打架),存量行下轮日采自愈,无需订正脚本
- **变更史**(M74 批F,迁移 `20261118162500_m74_pricing_change`):
  `model_pricing_change` 表,采集刷新行时对比库中现值、变了就在**同一事务**里多写一行
  (append-only,每次变价一行;`(model_pricing_id, changed_at)` 唯一键防同刻重写)。
  记 old/new 的输入输出价与**币种、计价单位**两口径列——跨币种/跨单位不可比,
  `change_kind` 记 `currency_changed`/`unit_changed`,**永不计入降价**;同币种同单位
  按代表价(token=输入价、非 token=生成价)判 `drop`/`rise`。价没变、价未公布(null)、
  新建行、人工定稿行都不写。**只记采集侧**:后台人工改价不留痕(口径边界,前台
  降价视图 `/pricing/changes/` 注明「采集口径」)。判定纯函数在
  `src/lib/pricing/change.ts`(零库依赖),写库组装在 `change-log.ts`,钩子在
  `model-persist.ts#persistModelRows`(旧价经 `listExisting` 的 select 收进闭包,
  不动通用编排 `curated-persist.ts` 的接口);`source_key` 记注册表规范键
  (`SOURCE_DEFS.key`,稳定;不靠 source_url——渠道 URL 会被后台改)。
  FK `onDelete: Cascade`(牌价行删除历史随之消亡);公开读侧
  `changes-read.ts#listPublicPriceChanges` 只外露 enabled 行、近 90 天、上限 100 条

**AI 智能指数日表已落地(2026-11-27 迁移 `add_ai_index_daily` + `add_intelligence_index`,支撑 `/ai-index/` 看板与首页卡片)**:

- `ai_index_daily`(日粒度一行):`date` 唯一(`uq_ai_index_daily_date`);`capability` = 当日能力基线(Epoch Capabilities Index 归一化 0–100);`velocity` = 当日冲击分(净冲击在滚动 180 天窗口内的经验分布百分位 0–100);`acceleration` = 冲击分日环比差(百分位差);`intelligence_index` = AI 智能指数(能力基线 + 冲击加成,加成上限 5 分,`AI_INDEX_PULSE_BONUS`);`event_count` = 当日入池的 AI 相关事件数;`top_events` jsonb = 当日 Top5 事件`[{title,url,score,signed,dimension,direction,relevance}]`;`dimensions` jsonb = 维度分布
- 口径:新闻侧先过**相关性闸**(只留 AI 相关条目,非 AI 资讯不打分不落库),再按 impact×方向(正 +1/负 −1)×置信度×相关性权重(core 1 / adjacent 0.5)算带符号贡献——**负向事件拉低当日净冲击**,不做只加不减;能力侧取 Epoch ECI 能力前沿(每刷新一次历史最高分的模型记一条)
- 数据源:Epoch `eci_scores.csv`(CC BY 4.0,258 个模型,含 90% 可信区间);**已接 worker 定时自动更新,不再手工跑脚本**

**AI 智能指数能力层与自动更新(2026-11-27 迁移 `add_ai_index_eci_tables`,ECI 真相源从源码快照迁到库)**:

- `ai_index_eci_model`(逐模型 ECI,能力层真相源):`model` 唯一(`uq_ai_index_eci_model_model`);`eci`/`ci_low`/`ci_high` = 分数与 90% 可信区间;`eci_date` = 该分数的基准日期;`organization`/`country`/`accessibility`/`accessibility_group` = 上游维度列;`source_hash` = 写入该批时的内容指纹(定位哪一批改的);`@@index([eci_date])`
- `ai_index_eci_sync`(拉取台账,每次拉取一行):`status` = ok/no_change/rejected/failed;`http_status`/`content_hash`/`model_count`/`frontier_eci`/`changed_models`/`duration_ms`/`error`;`@@index([fetched_at])`
- `ai_index_event_score`(事件评分台账,每条电报一行):`telegram_id` 唯一(`uq_ai_index_event_score_telegram_id`);`impact_score`/`confidence`/`dimension`/`relevance`/`direction`/`scorer`;`summary`/`source_name` 必留(规则兜底打分用 summary、可信源加成用 source_name,缺了重放结果会漂);**不建 FK**——电报明细有清理周期,评分台账独立留存
- 更新链路:`ai-index` 队列每日 05:07 `eci-fetch` 拉上游 → 校验闸门 → 指纹比对 → 全量 upsert 模型表 + 落台账;05:17 `daily-aggregate` 打分新电报 → 读台账 → 合成日表(重算最近 30 天,更早不回填)
- 事件打分:优先 Jev(`insight_judge` 绑定的 systemone 模型)四问(impact/dimension/relevance/direction),未绑定或调用失败回落规则打分,`scorer` 字段留痕。**wire 纪律(2026-11-27 生产踩坑)**:Jev 的 `score` 型问答 `criteria` 必须是**档位数组**(传字典被判 422),应答 `score` 是**档位下标**(0..n-1 的概率加权位置)而非百分制,落到 0–100 要自己按档位区间插值(`src/lib/ai-index/score.ts#impactFromBandIndex`);判分失败会打 `ai_index.jev_score_failed` 警告——「整批静默退化成规则兜底」不能没人看见
- **上游限速**:决策端点 60 请求/分钟/key(429 实测),客户端按最小间隔节流(`DECISION_API_RATE_LIMIT_PER_MIN`,`src/lib/ai/decisions-client.ts`)+ 429 退避重试一次。不节流的话批量判分会大面积 429 → 静默退化成规则兜底,指数口径就废了
- 打分窗口:取电报流近 30 天可见条目,上限 `AI_INDEX_SCORE_MAX_ITEMS` 须**覆盖整个窗口**(取少了,窗口外的旧条目永远进不了打分队列,曲线只剩最近几天);worker 每轮只打 `AI_INDEX_SCORE_BATCH_LIMIT` 条(短任务,发版 SIGKILL 安全),积压靠次轮继续(台账幂等),手动补跑可调大批量(`npm run ai-index:run daily 600`)
- **校验闸门**(纯函数 `src/lib/ai-index/epoch-source.ts#validateEciDataset`,任一不过 → 拒收并保留旧数据):表头必需列齐全 / 行数 ∈[50, 5000] / `eci ∈ [0, 1000]` / `ci_low ≤ eci ≤ ci_high` / 日期 ∈[2020-01-01, 今天+1] / 相对上次:模型数跌幅 >20% 拒 / 前沿 ECI 跌幅 >10% 拒。**只拒跌不拒涨**——上游真出大突破不该被误拒
- 「有没有变」用**解析后模型行的规范化哈希**(不用原文字节,换行/空白/行序差异不算变更)
- 冷启动:worker boot 时 `ai_index_eci_model` 为空 → 用仓库快照 `src/lib/ai-index/epoch-data.ts`(`npm run ai-index:fetch` 刷新)播种一次,之后由日采接管
- 域内常量(上游入口、闸门阈值、聚合口径、滞后判定)统一在 `src/lib/ai-index/constants.ts`,别在各处硬编码
- 可观测:MCP 健康域 `aiindex`(连败≥3 → critical,滞后>7 天/拒收/无数据 → warning)+ 前台 `/ai-index/` 顶部滞后标记

## 3. Prisma 模型约定

> 命名细则(表前缀、列名、约束/索引模板、`onDelete` 裁定、反例与新表 checklist)见
> [standard/03-db-naming](../standard/03-db-naming.md);本节只保留与 schema 写法强相关的约定。

- 模型名 PascalCase 领域名 + `@@map` 到 snake 表名;字段 camelCase + `@map` 到 snake 列名——**TS 侧全 camel,DB 侧全 snake,映射只此一处**
- Prisma client 单例 `lib/db.ts`(dev 环境 globalThis 缓存防热更像);**禁止第二实例**
- 关系:Post↔Tag 显式多对多表(`content_post_tag` 用 `@@id([postId, tagId])` 复合主键建模),不用 Prisma 隐式 m2m(保 SQL 可控)
- 约束/索引命名:unique 与普通索引经 schema `map` 直接落 `uq_<table>_<cols>` / `idx_*` 规范(如 `uq_content_post_slug`);**PK/FK 保留 Prisma 默认名**(`content_post_pkey` / `*_fkey`)——Prisma schema 层无法表达 FK 命名,硬改会导致 introspect 断言(CI 重放守卫)永久报差异;一致性校验优先于命名美学(2026-09-29 实施定)
- 引用完整性:真实引用的 `*_id` 列须建 FK(schema relation + 迁移 `ADD CONSTRAINT`),`onDelete` 按真实删除路径裁定;刻意不加 FK 的多态/聚合引用登记在 standard/03 §7.3
- 枚举字段(`status`/`role`/`kind`/`storage`/`source_class` 等)统一 VARCHAR + 注释枚举,**不加 DB CHECK 约束**:合法值由应用层 Zod 边界校验管控,演进免改库约束;`chk_` 前缀规范随之废止(2026-09-30 定)
- 禁止 `prisma db push`、禁止 `interceptDataLayer` 外的裸 SQL(迁移脚本除外)

## 4. 数据订正规范(生产修数)

- 订正一律走**一次性 TS 脚本**放 `scripts/oneoff/`(pg Pool + SQL,可评审可重放);**禁止直连生产 psql 手改**,禁止在应用运行时热修数据
- 脚本结构:先打印影响行预览(默认 dry-run,显式传参才执行)→ 单事务执行 → 打印结果;**破坏性订正(批量 UPDATE/DELETE)执行前先 `pg_dump -Fc -t <表>`** 落 `workspace/backups/`
- 订正不改变 schema 语义——涉及表/列/约束的变更走 §1 迁移,不得以订正绕过;订正脚本应用完成后从仓库删除,git 历史存档溯源

**答案卡问答留档表已落地(2026-11-17,迁移 `20261117052108_search_answer_log`)**:

- `search_answer_log`(检索会话族,与 `search_agent_session` 同前缀):搜索 AI 答案卡是
  单轮问答无线程语义,此前只有 `ai_usage_log` 计量、内容仅 Redis 缓存 1 天——站长裁定
  留档补全「用户在问什么」的反馈闭环。列:`visitor_id? varchar(36)`(ah_av uuid,fresh
  游客无 cookie 为 null)/`question varchar(120)`/`answer text?`(ok/degraded=全文防御
  截 20000;failed=null)/`cites jsonb`(`{items: AnswerCite[], followUps}`)/
  `model_key`/`duration_ms`/`status`(ok|degraded|failed)/`ai_usage_session_id?`
  (回链台账,recordAiUsage sessionId 锚)/`created_at`;索引 `created_at`。
  写入在 `src/lib/search/answer-service.ts` 三态收尾(缓存命中/无 LLM 早退不落,
  **写失败只告警不反噬 SSE 流**);90 天滚动清理(worker `purge-answer-log`,04:41
  错峰 cron);量级被配额钉死(答案卡站级 100 次/日,顶格 ≈73MB/年)。
  后台读侧在 `src/lib/agent/admin-sessions.ts`(会话页「答案卡」段)。
