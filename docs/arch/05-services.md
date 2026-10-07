# 服务层与异步任务设计(src/lib/ + worker/)

> 单体架构下没有独立后端应用,本文定义**业务库层**(`src/lib/`,被 RSC 页面与 Route Handlers 共用)与**异步任务**(`worker/`,BullMQ)的设计。分层纪律承袭 ai-invest-assisstant:薄处理、重服务、事务边界清晰。

## 1. 分层

```
页面(RSC)/ Route Handler  →  service(lib/content, lib/media, lib/auth, lib/ai, lib/telegram ...)  →  Prisma(db.ts)
```

- **页面与 Handler 只做协议层**:参数解析(Zod)、鉴权、响应包络、状态码;**禁止页面/Handler 内出现裸 Prisma 调用**(一律经 service)——保住"业务只有一份实现"的单体底线
- service 可互相组合;**service 之上才有 revalidatePath / enqueue 等副作用编排**
- `lib/db.ts` Prisma 单例、`lib/redis.ts` Redis 单例,全项目唯一

## 2. 事务边界(强制,范例项目同款)

- Prisma 交互式事务 `prisma.$transaction(async tx => ...)` 只出现在 **service 层**;页面/Handler 禁止开事务
- 写操作成功后再做副作用:`revalidatePath`、`queue.add()`——**先提交事务后发副作用**,失败补偿靠幂等(任务可重跑、revalidate 可重放)
- 批量写:分批 + 单条容错(捕获记录继续,参照范例 begin_nested 精神);迁移脚本走裸 SQL UPSERT 自管事务
- 禁止 `prisma.$executeRaw` 出现在 service 之外的任何地方(统计聚合等复杂查询集中 `lib/content/queries.ts` 并注释说明)

## 3. 认证与会话(src/lib/auth/)

### 3.1 admin 密码登录(一期唯一鉴权;短信登录设计保留三期启用)

> 2026-09-30 收缩:运营商个人签名资质停发,用户短信登录延后三期(requirement §3.3);一期鉴权仅服务后台 admin,前台无登录入口。

```
POST /api/auth/login    { phone, password } → bcrypt.compare → 下发会话 Cookie
POST /api/auth/logout                 → 吊销会话(Redis 删登记)
GET  /api/auth/session                → 当前用户(客户端 hydrate 用)
```

- admin 账号经 `npm run admin` 交互式创建/重置(手机号 + 密码,bcrypt 10 轮,`role=admin` upsert;重跑即改密);不预置 seed
- **`legacy_phpass` 永不参与校验**(纯审计)
- **爆破防护**(Redis 计数,阈值进 env):同账号连错 5 次锁 15min;同 IP 日失败上限 50 次;超限 429——失败提示不区分"锁定"与"密码错",不给人枚举面
- 日志安全:手机号掩码(`138****1234`);密码/哈希永不落日志;登录成功/失败/锁定/登出记 `auth` 事件(pino,后台可视化属 M5+)
- 三期启用短信登录时恢复原设计(sms-code 频控同号 60s/次日 10 条、腾讯云下发、未注册自动注册);BullMQ 周期任务实现注见 §4(upsertJobScheduler)

### 3.2 会话机制(httpOnly Cookie,单体自然形态)

- **单会话 Cookie(2026-09-30 定稿;双 token 方案移三期用户中心)**:jose 签名 JWT 装入 `ah_at` httpOnly + SameSite=Lax Cookie(`secure` 生产开启),有效期 7d,载荷 `{ sub, role }` + `jti`
- `jti` 登记进 **Redis 会话表**(TTL 对齐 7d):登出即删、可单点吊销;校验 = JWT 本地验签 + `jti` 登记存在性双查(封住"签发后即吊销"窗口)
- **滑动续期**:剩余有效期 <1d 时随响应下发新 Cookie(滚动 7d),连续活跃不掉线
- `middleware.ts`:/admin 路径做 Cookie 存在性 + JWT 本地有效期预检(**不查 Redis**——middleware 运行环境约束;完整校验仍在 service/Handler,防伪不靠 middleware)
- 并发登录共存:多处登录各持独立 jti,吊销互不影响(不做"单点踢下线",YAGNI)
- admin 判定:`role==='admin'` + `requireAdmin()` 在 admin 端点逐个叠加(不信任 middleware)

### 3.3 安全红线

- 外部输入一律 Zod 边界校验;上传类型+大小白名单,文件名重生成(sha1)
- Origin/Host 校验:所有 mutation 类 Route Handler(arch/07-frontend §4)
- CORS:Next 同源架构默认无跨域;若未来开放 API 再显式配置白名单
- 安全事件记录:登录尝试/爆破锁定/权限拒绝/上传拒绝(pino `auth` 事件)

## 4. 异步任务(worker/ + BullMQ)

### 4.1 队列与纪律

- 单 Redis,队列按域命名:`media`(一期)、`crawler`、`interpreter`(M9)、`summarizer`(M12)、`github`(M11)、`pay`(二期启用)
- **请求内禁做秒级以上处理**(arch/00-overview §7):一切转码/压缩/抓取/同步 enqueue 后立即返回 `{ jobId }`
- 任务幂等:所有 processor 以业务键去重(jobId 用 `media-{sha1}-process` 连字符形态),可重复投递。**custom jobId 禁含冒号**(BullMQ 直接抛 "Custom Id cannot contain :",2026-10-04 实修——interpret/media 旧冒号键致入队 500)
- worker 独立进程 `worker/index.ts`:注册 processors、优雅退出(SIGTERM 排空)、失败重试(指数退避,上限 3 次)+ 死信记录

### 4.2 一期任务清单

| 队列 | 任务 | 触发 | 内容 |
|------|------|------|------|
| media | `media.process` | 上传成功后 enqueue | sharp:主图 WebP 副本 + 缩略图(thumb_path)、宽高回填、sha1 入库 |
| media | `media.transfer` | md 导入对外链图 enqueue | 抓取外链图片 → LocalDiskProvider 入库(sha1)→ 链式复用 media.process;失败标 error 供编辑器提示 |
| media | `media.audit` | 每日定时(upsertJobScheduler,同 §3.1 实现注) | 孤儿/断链/重复扫描,更新 status 与统计(arch/08-media §3) |
| stats | `stats.flush` | 每 60s(upsertJobScheduler) | 日缓冲 RENAME→HGETALL→聚合表 UPSERT(visit/referrer/page/client/post_view_daily + views_count 累加);失败还原缓冲下轮重试(`lib/stats/service.ts`) |
| stats | `purge-visit-log` | 每日 04:14(同队列 upsertJobScheduler pattern,job.name 分流) | `stats_visit_log` 清 7 天前行(全量 IP 短留存,arch/03 §2.4;`purgeVisitLogs`);2026-10-06 起同 job 顺带 `purgeSearchLogs` 清 `stats_search_log` 180 天前行(搜索词明细,arch/03 §2.4) |

二期任务(立项时补设计):`distribute.*`(微信公众号等渠道分发,publish_channel 状态机)、`pay.*`(对账轮询);agent 触发类长任务设计落点 arch/04-ai-agent。**`crawler.*` 已交付**:文字渠道(M7,`crawl-{id}-{nextRunAt}`)+ 视频博主(M8,`crawl-video-{id}-{nextRunAt}`,编排见 `src/lib/telegram/ingest-video.ts`;调度器同一 `crawler-tick` 每 60s 扫描,`crawlDueSources` 排除平台行、`enqueueDueVideoAccounts` 扫 `social_account`);设计落点 arch/02-data-collection。**`interpret-video` 已交付**(M9,`interpreter` 队列并发 1/lockDuration 600s;ASR→LLM 管道编排 `src/lib/telegram/interpret-video.ts`,管道详设与红线见 arch/02 §3.2 落地注记)。**`summarize-text` + AI 补扫已交付**(M12 批③,2026-10-05):`summarizer` 队列(默认并发 2,lockDuration 300s——纯 LLM 秒级调用,与视频长任务分队列防阻塞)跑 `summarize-text` job(文字电报轻解读:一句话中心思想 + 要点 + 3-5 关键词(禁泛词,批⑥ 契约 v2),复用 `ai_*` 列;编排 `src/lib/telegram/summarize-text.ts`,ingest 落库即入队,治理台「摘要/重摘要」按钮经 POST `/api/telegram/[id]/summarize` 手动触发与重新生成);**AI 存量补扫** `ai-backfill` job 借 `crawler` 队列 tick 生态(`ai-backfill-tick` 每 5min,`worker/index.ts` 调度;扫 `ai_status IS NULL` 且 7 天内可见行每类 5 条,按 mediaType 分流入 interpreter/summarizer,入队前移除遗留 jobId + 先标 pending;对应模型未绑定的类整轮跳过防空转;编排 `src/lib/telegram/ai-backfill.ts`)。**`github.sync` 已交付**(M11,2026-10-05):`github` 队列,`github-tick` 每 5min 扫 `github_repo.next_sync_at` 到期白名单仓逐仓 fanout(`github-sync-{id}-{nextSyncAt}`,调度器见 worker/index.ts;sync 编排 `src/lib/github/sync.ts`——meta 条件写防 updatedAt 空转、README sha 跳写、动态去重裁剪;Unavailable/限频不计连败,Upstream 计连败 ≥3 → error;手动「立即同步」经 repos-admin 入队 `github-sync-{id}-manual-{ts}`)。**`seo-batch` 已交付**(M16 批⑤,2026-10-06):`seo-batch` 队列(并发 1,lockDuration 600s)跑单 job 顺序逐篇批量 SEO 补全——仅写空缺字段(seoTitle/seoDescription 均空才整篇生成,已有值一律保留),复用 `suggestSeo`(role="seo" 台账逐篇落行),单篇 catch 记 `failedIds` 继续;`POST /api/posts/seo-suggest-batch` 入队前 `resolveAiModel(summarize)` 前置校验(缺失 400,不产生无效 job),`GET …/[jobId]?token=` 轮询进度(cover-generate token 模式);编排 `src/lib/ai/seo-batch.ts`。**`wechat-sync`/`wechat-batch` 已交付**(M17 批③,2026-10-06):`distribute` 队列(**并发 1 全局串行**,lockDuration 900s——微信频控兜底,900s 覆盖单批 30 篇 × ~15s)跑两 job:单篇 `wechat-sync`(attempts 2,微信 API 瞬断重试一次;编排 `src/lib/distribute/wechat-sync.ts`——封面 add_material 永久素材 → 正文图 uploadimg 转存(publish_media_cache 按 sha1 缓存命中零上传,WebP 魔数嗅探转 jpeg;单图失败整篇终止列 src 清单,防公众号内裂图)→ markdown-it 全内联样式 HTML(`wechat-html.ts`)→ draft/add 首推或 draft/update 重推(`publish_channel.media_id` 锚定);content 超 2 万码点报错不截断;失败落 `publish_channel.status=failed` + last_error 人话)+ 批量 `wechat-batch`(attempts 1 篇级隔离已内置,`wechatBatchJob` 顺序逐篇 + `updateProgress{processed,total,failedIds}` 快照 + 篇间 `WECHAT_SYNC_GAP_MS` 1.5s);token 经 Redis 缓存(`distribute:wechat:token` EX=expiresIn-200,NX 锁防击穿,40001/42001 DEL 强刷重试一次,`wechat-client.ts`);发布自动钩子挂 `publishPost`(`maybeEnqueueAutoWechat` 永不抛,渠道关/旧文/缺封面/synced/pending 静默跳过,默认关)。**正文主题已交付**(主题扩展批⑦⑧,2026-10-07,仿 md.openwrite.cn):`wechat-themes.ts` 六款主题注册表(默认/青绿/暖橙/蔚蓝/雅紫/朱红,强调元素=标题/加粗/引用框/行内码/链接角标随主题变色,正文深灰与代码块暗底不随主题;客户端安全零 IO),`wechat-html.ts` 冻结样式常量改为 `stylesFor(theme)` 经渲染 env 注入(未知 id 回退默认,渲染永不抛);主题解析 overrides > 行快照(重推沿用)> 渠道默认,成功随行落快照;`POST /api/distribute/wechat/preview` 按文章 Markdown 以指定主题纯渲染(与推送管线同函数,不触微信 API 不写库),同步弹窗双栏同屏(左:标题/摘要/封面/主题色板,右:实时预览)。二期任务清单中 `distribute.*` 至此部分交付(公众号);`pay.*` 仍留池。

### 4.4 视频采集网关 sidecar(services/douyin-gateway/,2026-10-04 M8 新增)

Python 3.11 + FastAPI **独立镜像独立容器**,平移自实战项目(签名 a_bogus + curl_cffi Chrome TLS 指纹 transport + Playwright 签名驱动 + Cookie jar 轮换/冷却/风控归因)。存在理由:抖音 WAF 按 TLS 指纹拦截标准 HTTP 客户端,只有 curl_cffi impersonate 实战验证有效(技术栈决策与平移记录见 memory `douyin-gateway-stays-python`);Node 侧只做编排与落库。

- **HTTP 契约**(compose 内网,无鉴权不暴露公网;Node 每次携带解密后的明文 jar,PG 为真相源,网关零密钥零持久化。**契约真相源**:TS 侧 Zod 镜像 `src/lib/telegram/adapters/video/gateway-contract.ts` + 黄金样本 `services/douyin-gateway/contract/*.json`,双侧对拍——网关改形状则 pytest 红,重生成 fixture 则 vitest 红,逼同步;/sign 仅网关内部消费不入契约):
  - `POST /sign {path,query,user_agent,cookies}` → `{params,user_agent}`
  - `POST /posts {sec_uid,cookies[],max_pages?=1}` → `{videos[],has_more,max_cursor}`(归一化 video_id/caption/topic_tags/cover_url/play_url/duration/published_at/digg/comment/share;play_url 仅日志调试禁止落库)
  - `POST /profile {sec_uid,cookies[]}` → `{sec_uid,nickname,avatar_url}`;`POST /resolve {url}` → `{sec_uid}`(短链展开)
  - `GET /health` → `{status,driver,warm_slots,in_use,last_error,jars_total,jars_available}`(**永远 200**,浏览器/池态异常在 body 里表达——Node 侧探测不靠状态码)
  - 错误包络:适配层异常 `{error,detail}`(404/502);pydantic 校验/签名未就绪 `{detail}`(422/503,detail 兼容数组)
- **错误归因两分**(Node 侧消费约定,**按状态码分流**):网络层失败与 `503`(签名服务未就绪)= `GatewayUnavailableError` = 基础设施故障,顺延下轮**不计**博主连败;其余非 2xx(`404/422/502`)与响应不合契约(`ContractDrift`)= `GatewayUpstreamError` = 计入 `consecutive_fails` + `last_error`
- 部署:compose 服务 `douyin-gateway`(prod 内网无 ports、tmpfs 指纹目录、mem_limit 1g、healthcheck urllib 探 /health、warm_slots=1 适配 2C4G);本地 `127.0.0.1:8010` 便于冒烟;发布段见 standard/02-cicd-deployment。env:`DOUYIN_GATEWAY_URL`(default `http://127.0.0.1:8010`)

### 4.3 本地与部署形态

- 本地:`npm run worker`(tsx 直跑);生产:compose `worker` 服务,**与 web 同镜像**,command 覆盖为 `node dist/worker/index.js`(构建期 tsc 编译,outDir=dist)
- worker 内存上限 512m(sharp 处理大图吃内存),并发 = 2 起步,按服务器余量调

## 5. 一期接口清单(Route Handlers)

| 域 | 端点 | 鉴权 |
|----|------|------|
| auth | login / logout / session | 公开(login 有爆破防护,§3.1) |
| content | `GET /api/posts`(管理列表,草稿含;q 搜索)、`PUT /api/posts`(发布 API upsert:slug 幂等,原始 md 服务端解析 frontmatter,图片随文 base64 复用 M5-b 上传管线,publish=true 直发;legacy 纯 HTML 旧文 409 保真)、`POST/PUT/DELETE /api/posts/[id]`、`publish/unpublish`(POST 建文 slug 缺省由标题派生 ASCII、冲突自动追加 `-2…-9` 后缀、纯中文标题 → NULL;显式指定冲突仍 409;PUT 可改 slug——URL 由 id 锚定不破链)、`POST /api/posts/seo-suggest`(SEO 字段一键 LLM 补全,复用 summarize 绑定同步轻调用,M14 批④)、`POST /api/posts/seo-suggest-batch` + `GET /api/posts/seo-suggest-batch/[jobId]?token=`(文章列表多选批量 SEO 补全:仅补空缺不覆盖已有值,入 `seo-batch` 队列顺序逐篇 + 单篇失败隔离 `failedIds`;summarize 绑定缺失 400 前置拒绝不产生无效 job;ids 上限 50,M16)、`POST /api/posts/cover-generate` + `GET /api/posts/cover-generate/[jobId]`(AI 文生图封面:入 cover-gen 队列 attempts=1 + 轮询进度,M14 批⑥;`prompt` 入参随请求下发——前端 LLM 建议或手填,空回退服务端模板,M16;生图响应 b64_json/url 双形态都收,url 由服务端转存不入外链,候选不足按轮补齐(智谱单图契约);`ai_model.extra_params` 浅合并进请求体(保留键不可覆盖,水印开关等),M16;三条均仅会话)、`POST /api/posts/cover-prompt`(封面弹窗「AI 生成提示词」:LLM 依标题/摘要/标签/正文取样产文生图 prompt 填入前端框,复用 summarize 绑定同步轻调用,role="cover-prompt" 台账,M16) | admin(管理路会话或 PAT 双路,§3.1;seo-suggest*/cover-generate 仅会话) |
| pats | `GET/POST /api/pats`、`POST /api/pats/[id]/revoke`(仅会话——PAT 不得自我增殖;明文仅签发时返回一次,库存 sha256) | admin |
| mcp | `POST /api/mcp`(Streamable HTTP stateless,每请求新建 transport;Bearer PAT 鉴权在 MCP 协议层之前;六工具 upsert_article/upload_media/get_article/list_articles/publish/unpublish,一律 slug 为键;GET/DELETE 405;接入串 arch/04 §2) | admin(PAT) |
| content | `GET /api/search?q=`、`GET /api/search/answer/?q=`(AI 答案卡 SSE,arch/04 §3.4:四事件 meta/delta/done/unavailable,业务降级走 `unavailable` 事件不占 HTTP 状态——仅 q 校验 400、IP 频控 429 用状态码;nginx `location ^~ /api/search/` `proxy_buffering off`)、`GET/POST /api/search/agent/threads`(K2.5 Drawer 会话列表/新建;K2.6 身份分流——admin(ah_at role=admin)走会话行(列表/新建 20/日/visitor),游客(ah_av cookie)列表恒空、新建 `g_<uuid>` 线程只绑 Redis 归属键(2h 滑动 TTL)不落行)、`DELETE /api/search/agent/threads/[threadId]`(admin 行+checkpoint 同删;游客解绑 Redis 键+删 checkpoint,归属校验 404)、`GET /api/search/agent/threads/[threadId]/state`(values.messages 扁平序列化,切线程恢复历史;游客查 Redis 归属,过期 404 前端自愈)、`POST /api/search/agent/threads/[threadId]/runs/stream`(langgraph 协议 SSE 核心:input 只收单条 human 文本 ≤2000;admin 会话累计 ≤50k 前置拒绝 / 游客 3 问/日+30 问/日/IP 双闸 429 / IP 10 次/分频控;业务降级走 `error` 帧不占 HTTP 状态;客户端断开即中止 agent;nginx 同上已覆盖) | 公开(身份分流归属绑定防越权;mutation 同源校验) |
| agent-sessions | `GET /api/agent-sessions?page&kind=all\|member\|guest&q`、`GET /api/agent-sessions/[threadId]`(K2.6 后台会话管理:成员=会话行+台账 runs 计数,游客=ai_usage_log 按 session_id 聚合+Redis 活跃态;详情 meta+checkpoint 消息时间线,游客过期仅 meta 标「已过期」;页面 `/admin/agent-sessions`) | admin **仅会话**(PAT 拒绝,同 users 套路) |
| stats | `POST /api/view { path, referrer?, q? }`(同源校验 + bot/管理员过滤)、`POST /api/stats/bot`(2026-10-07 方案B:middleware 对已命名爬虫的 HTML GET 按 UA 名单(`lib/stats/bots.ts`,AI/搜索两类)识别后 waitUntil 打此端点;x-original-ua 端点侧二次分类不信任调用方声明;`ingestBotFetch` 写入与真人同一 ref 日缓冲 `source_class='bot'`,只记 PV 不去重,复用既有 flush 落 `stats_referrer_daily` 零新表;未识别 UA 204 不入账,伪造面与 beacon 相同) | 公开(IP+UA 哈希日去重;文章 PV 另设 1h 去重窗,Redis 缓冲 60s 批量落库);2026-10-06 起 /search 页带 q 时行级直插 `stats_search_log`(搜索词排行,过同一 bot/管理员门,口径 = /search counted PV);bot 类目不进流量来源卡,后台统计页单独「爬虫流量」卡(AI 爬虫/搜索爬虫细分 + 真人 PV 对照) |
| media | `POST /api/media`(上传;M16 修 compose web 容器媒体卷 ro 挂载遗留——写盘 EROFS 500 根因,摘 ro 改读写与 worker 口径一致;畸形 multipart 400 映射)、`POST /api/media/import`(外链图批量转存,enqueue 返回 jobId,前端轮询取映射;M16 起 jobId 连字符禁冒号同 §4.1 口径,queue.add 包 try/catch 映射 502 不再静默)、`GET /api/media`(列表/过滤)、`DELETE /api/media/[id]`、`GET /api/media/{orphans,duplicates,stats}`、`POST /api/media/dupes/merge`(重复 sha1 分组合并,M14 批①)、`GET /api/media/pick`(封面选图轻列表:24/页 createdAt 倒序 + 文件名模糊搜,不碰引用索引,M14 批⑤) | admin **仅会话**(pick 是编辑器交互面,PAT 拒绝) |
| users | `GET/PUT /api/me/profile`、`PUT /api/me/password`(三期用户体系启用)、`GET /api/users`、`PUT /api/users/[id]/status`(后两者仅会话,§3.1;不能变更当前登录账号;禁用即吊销该用户全部 PAT) | user / admin |
| telegram | `GET/POST /api/channels`、`PUT /api/channels/[id]`、`PUT /api/channels/[id]/status`(启停)、`POST /api/channels/[id]/crawl`(手动采集;渠道凭证存 config 展示一律脱敏,M7 批④a)、`POST /api/channels/[id]/debug`(一键调试拉取,M14 批②)、`PUT /api/telegram/[id]`(条目人工修正/状态迁移 title≤500/summary≤1000/三态,批④b)、`GET/POST /api/blocklist`、`PUT/DELETE /api/blocklist/[id]`(批④b)、`GET /api/telegram/public`(前台公共流:limit≤50/after 增量锚/source 过滤/`media=all\|text\|video` 白名单,M8 批④,`no-store`,BigInt 出参字符串化,M7 批⑤;M15 批① 起仅出 AI 解读终态行、after 锚 `aiRanAt` 变可见时刻,见 arch/02 §3.2 M15 注记) | 除 public 外 admin **仅会话**(PAT 禁管渠道/治理电报流,§3.1);public 公开只读 visible |
| bloggers | `GET/POST /api/bloggers`(登记:主页链接/口令/sec_uid 三态,经网关 resolve+profile,重复 409)、`PUT /api/bloggers/[id]`、`PUT /api/bloggers/[id]/status`(启停)、`POST /api/bloggers/[id]/crawl`(手动采集;均 PAT 拒绝)、`GET/POST/DELETE /api/bloggers/cookies`(Cookie 池:脱敏视图/导入 AES-256-GCM 落库(校验 ≥3 对含 ttwid)/清空,platform 白名单 douyin\|xhs\|bilibili;`?platform=` 查询,平台行不存在 404;M8 批③)、`POST /api/bloggers/[id]/backfill`(向前深扫 30 天补采,平台行停用 409) | admin **仅会话**(PAT 禁管博主与 Cookie) |
| ai | `GET/POST /api/models`(模型台账,脱敏视图)、`PUT/DELETE /api/models/[id]`(Key write-only 留空=保留;被绑定引用删 409 先解绑)、`PUT /api/models/[id]/status`(启停)、`POST /api/models/[id]/test`(openai/anthropic 探针,结果落 last_test)、`GET/PUT /api/asr-config`(单例 get-or-create)、`POST /api/asr-config/test`(openai/minimax 正弦波实调)、`GET/PUT /api/model-bindings`(四角色主备;purposes 不匹配/主备相同 400,模型不存在 404;均 M8 批⑥)、`POST /api/usage/purge`(手动清 90 天前 ai_usage_log,与 worker 日清同口径,M14 批⑦;模型/ASR 牌价经模型与 ASR 配置既有 PUT 携带 priceIn/priceOut/pricePerImage/pricePerHour) | admin **仅会话**(PAT 禁管 AI 服务配置) |
| distribute | `GET/PUT /api/distribute/wechat-config`(配置单例掩码视图/更新,secret 留空=保留)、`POST /api/distribute/wechat-config/test`(实调 `/cgi-bin/token` 探针落 last_test,40164 IP 白名单人话透出 errmsg 自带出口 IP)、`POST /api/distribute/wechat/sync`(单篇入队 202 `{jobId,token}`;未配置/旧文/缺封面/pending 400 人话前置)+ `GET …/sync/[jobId]?token=`(轮询终态)、`POST /api/distribute/wechat/batch`(多选批量入队,ids ≤30 去重;逐篇预检 skipped 随 202 携回人话,eligible 0 不产生 job)+ `GET …/batch/[jobId]?token=`(进度 processed/total/failedIds)、`POST /api/distribute/wechat/preview`(正文按主题预览纯渲染,返回 `{html,theme}`,theme=请求指定 > 行快照 > 渠道默认)、`POST /api/distribute/records/[id]/reset`(清 publish_channel.media_id 绑定——公众号侧草稿被人工删后重推回落 draft/add;无绑定 400,记录不存在 404;均 M17) | admin **仅会话**(PAT 禁管内容分发) |
| site | `GET/PUT /api/site-config`(站点 kv 设置;PUT zod 校验,成功 `revalidatePath("/", "layout")` 使首页 ISR 立即再生;M10 批②,首键 `band.item_count` 1..50) | admin **仅会话**(PAT 禁管站点配置) |
| legacy | `GET /legacy/[...path]`(web 内部路由,非 REST) | - |
| system | `GET /api/health` | compose healthcheck |

二期预留:`/api/pay/*`(虎皮椒:创建订单 + 异步 notify 回调,回调端点独立鉴权白名单 + 验签)、`/api/github/*`。

## 6. 日志与可观测

- pino 结构化 JSON;`instrumentation.ts` 注册 request id 中间件,响应头回写 `X-Request-Id`
- 慢请求(>500ms)warn 级;`/api/health` 供 compose healthcheck
- worker 日志带 `queue/jobId`;一期不接日志平台,`docker compose logs` 排障
