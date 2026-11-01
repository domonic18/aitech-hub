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

### 3.1 admin 密码登录(一期鉴权;短信登录见 §3.4)

> 2026-09-30 收缩:运营商个人签名资质停发,用户短信登录延后三期(requirement §3.3);一期鉴权仅服务后台 admin,前台无登录入口。
> 2026-10-31 M65 反转:阿里云**号码认证服务(PNVS)短信认证**对个人实名开放(无需企业资质/ICP/自申签名),短信验证码登录/注册合一提早落地,见 §3.4。

```
POST /api/auth/login    { phone, password } → bcrypt.compare → 下发会话 Cookie
POST /api/auth/logout                 → 吊销会话(Redis 删登记)
GET  /api/auth/session                → 当前用户(客户端 hydrate 用)
```

- admin 账号经 `npm run admin` 交互式创建/重置(手机号 + 密码,bcrypt 10 轮,`role=admin` upsert;重跑即改密);不预置 seed
- **`legacy_phpass` 永不参与校验**(纯审计)
- **爆破防护**(Redis 计数,阈值进 env):同账号连错 5 次锁 15min;同 IP 日失败上限 50 次;超限 429——失败提示不区分"锁定"与"密码错",不给人枚举面
- 日志安全:手机号掩码(`138****1234`);密码/哈希永不落日志;登录成功/失败/锁定/登出记 `auth` 事件(pino,后台可视化属 M5+)
- 三期启用短信登录时恢复原设计(sms-code 频控同号 60s/次日 10 条、腾讯云下发、未注册自动注册);**已被 M65 取代**:通道改阿里云 PNVS(§3.4),频控与自动注册口径随之下沉到该节

**飞书工作台免登(M29,2026-10-14 立项;批①② 已上线;2026-10-16 免登修复:SDK 死链换新、废弃 getAuthCode 签名流换 requestAccess、v1 OIDC 换 v2 兑换,仿 acore-manager 实证)**:

- **流程**:飞书工作台 H5 打开 `/admin`(已入可信域名)→ 登录页 UA 判飞书容器 → h5sdk 脚本(bytegoofy 官方 CDN 1.5.26)ready → `tt.requestAccess`(appId 取 `GET /api/auth/feishu/status`,免 config 签名鉴权;客户端 ≥6.9.0,旧客户端静默丢弃新 API → 8s 无响应回退 `tt.requestAuthCode`)→ `POST /api/auth/feishu/exchange` 服务端 OAuth v2 兑换(authen/v2/oauth/token → user_info)→ `admin_feishu_binding` 按 unionId 精确命中(白名单本体,fail-closed)→ 目标账号复核 role=admin + status=active → 签发既有 jose 会话 Cookie(**不新造会话机制**,§3.2 同款)→ 跳 `/admin/`
- **绑定**:密码登录后在 `/admin/settings/feishu`(系统设置「飞书」页签,侧栏精简批①;旧 /admin/feishu 308 承接)自绑/换绑/解绑——凭证配置与绑定同页;绑定只要求凭证齐(`enabled` 单独控制兑换通道);跨锚冲突(unionId 已绑他人)409
- **凭证**:`admin_feishu_config` 单例入数据库(不入 env,与邮件/支付同规则),secret-box AES-256-GCM 加密,write-only 脱敏回显;`app_access_token` Redis 缓存(expire 预留 5min 余量,缓存故障降级直连;仅 admin 探针消费——v2 兑换以 client_id/secret 直换不取 app_token)
- **防滥用**:status 仅透传 appId(非密,本就进客户端请求参数),凭证不齐 403 fail-closed;exchange IP 30/h + Origin 校验;授权码 5 分钟单次;未绑定一律模糊 403 不给探测面
- **回落**:非飞书环境 / 未配置 / 未启用 / 兑换任一步失败 → 登录页密码表单兜底,零回归;PC 端 OAuth 扫码授权留二期

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

### 3.4 手机号验证码登录/注册(M65,2026-10-31;替代原三期腾讯云方案)

```
POST /api/auth/sms-code   { phone }                → 触发下发(恒定应答,不暴露号码是否注册)
POST /api/auth/sms-login  { phone, code, agreed }  → 校验通过 → 登录(已存在)或自动建号(不存在)
```

- **通道 = 阿里云号码认证服务 PNVS「短信认证」**(`src/lib/sms/`):个人实名可用,签名与 5 个预置模板(100001 登录/注册、100002 改绑、100003 重置密码、100004 绑新号、100005 验证绑定)由阿里云预置,无企业资质/ICP/自申签名。仅中国大陆 +86、仅验证码场景。
- **验证码不落库**:PNVS 服务端生成与托管(缺省 300s 有效、60s 重发间隔、新码覆盖旧码、`returnVerifyCode=false`),本站无 OTP 表。预置模板内容含两个变量,`TemplateParam` 须为 `{"code":"##code##","min":"<有效期分钟>"}`——只传 `code` 会回 `isv.INVALID_PARAMETERS`「请检查模板内容与模板参数是否匹配」(2026-10-31 调试台实证);`min` 由适配器按 `validTime` 推导,不与模板文案脱钩。
- **入库配置**:`user_sms_config` 单例(AccessKey + Secret + 签名名 + 模板编码 + 开关 + 日预算),admin「系统设置 → 短信」维护;Secret AES-256-GCM 加密、write-only 回显,不入 env(与邮件/支付/飞书同规则)。关闭或凭据不全时端点 503、登录页页签隐藏。
- **合一语义**(用户裁定):号码已存在即登录;不存在自动建号(`username` 空、昵称「用户+手机尾号 4 位」、`role=user`)——老站仅手机号账号因此恢复登录能力,53 位 pending_binding 不做特殊处理。
- **admin 禁短信登录**(安全红线):迁移老账号手机号来自 WP 自助填写、从未验证,且含 admin 主账号。下发端点对 admin 号码静默按成功应答(不发、不计数、不泄漏角色);登录端点验证码通过后仍 403。
- **频控与熔断**(`src/lib/sms/limit.ts`,阈值常量进代码):同号 60s 冷却 / 5 次每时 / 10 次每日;同 IP 10 次每时 / 30 次每日;全局日预算(admin 可配,缺省 200)先占位后发送、失败归还、80% 预警;校验错 5 次锁 15 分钟。
- **合规**:请求须 `agreed: true`(邮箱注册同规),登录页与注册页勾选框不预选;隐私政策 §五 增第三方短信服务商条款。
- **会话**:复用 §3.2 机制,不新造。`/account/*` 页面与写接口改用 `requireAccountPage` / `requireAccountRequest`(JWT 验签 + Redis `jti` 登记双查),封住「已吊销会话在 token 到期前仍可用」的窗口。
- **账号中心绑定/换绑**(P1,同分支落地):`POST /api/account/phone/code|verify`(服务端状态机 `src/lib/sms/account-phone.ts`,请求契约 `src/lib/sms/scenes.ts` 客户端安全)。未绑定走 `bind`(100004 发新号,验码即落库);已绑定走**两步** `rebind_old`(100005 发当前号——**目标号由服务端从会话取,客户端传号无效**)→ Redis 放行标记 10 分钟 → `rebind_new`(100002 发新号;缺标记 409,不可跳步)。**发送时不预检号码归属**(否则登录态可探测任意号码是否注册),新号占用只在落库时判(409「已绑定其他账号」);admin 与停用账号一律 403;频控/日预算/校验锁定与登录链共用 `sendSmsCodeGuarded`(`send.ts`)+ `limit.ts`。`/account/settings` 第四卡渲染 `PhoneForm`(admin 不显示)。

## 4. 异步任务(worker/ + BullMQ)


### 4.1 队列与纪律

- 单 Redis,队列按域命名:`media`(一期)、`crawler`、`interpreter`(M9)、`summarizer`(M12)、`github`(M11)、`backup`(M19)、`embed-content`(M20)、`discovery`(M25)、`pay`(二期启用)
- **请求内禁做秒级以上处理**(arch/00-overview §7):一切转码/压缩/抓取/同步 enqueue 后立即返回 `{ jobId }`
- 任务幂等:所有 processor 以业务键去重(jobId 用 `media-{sha1}-process` 连字符形态),可重复投递。**custom jobId 禁含冒号**(BullMQ 直接抛 "Custom Id cannot contain :",2026-10-04 实修——interpret/media 旧冒号键致入队 500)
- worker 独立进程 `worker/index.ts`:注册 processors、优雅退出(SIGTERM 排空)、失败重试(指数退避,上限 3 次)+ 死信记录

### 4.2 一期任务清单

| 队列 | 任务 | 触发 | 内容 |
|------|------|------|------|
| media | `media.process` | 上传成功后 enqueue | sharp:主图 WebP 副本 + 缩略图(thumb_path)、宽高回填、sha1 入库 |
| media | `media.transfer` | md 导入对外链图 enqueue | 抓取外链图片 → MediaStorage 入库(sha1;后端随 `MEDIA_STORAGE`,arch/08 §1)→ 链式复用 media.process;失败标 error 供编辑器提示 |
| media | `media.audit` | 每日定时(upsertJobScheduler,同 §3.1 实现注) | 孤儿/断链/重复扫描,更新 status 与统计(arch/08-media §3) |
| stats | `stats.flush` | 每 60s(upsertJobScheduler) | 日缓冲 RENAME→HGETALL→聚合表 UPSERT(visit/referrer/page/client/post_view_daily + views_count 累加);失败还原缓冲下轮重试(`lib/stats/service.ts`) |
| stats | `purge-visit-log` | 每日 04:14(同队列 upsertJobScheduler pattern,job.name 分流) | `stats_visit_log` 清 7 天前行(全量 IP 短留存,arch/03 §2.4;`purgeVisitLogs`);2026-10-06 起同 job 顺带 `purgeSearchLogs` 清 `stats_search_log` 180 天前行(搜索词明细,arch/03 §2.4);M28 批① 起再顺带 `purgeClickLogs` 清 `stats_click_log` 180 天前行(条目点击明细,arch/03 §2.4) |
| backup | `run`(**db-backup**,M19 批②,2026-10-08) | 每日 03:23(upsertJobScheduler `DB_BACKUP_CRON`,Asia/Shanghai;手动验收 `npm run backup:run` 入队) | `pg_dump -Fc`(libpq 兼容连接串:`src/lib/backup/db-backup.ts` 白名单剔除 Prisma `connection_limit` 等参数)→ `workspace/backups/` 留最近 3 份 → 上传备份桶 `backups/db/<stamp>.dump`(CosBucket;桶侧 lifecycle 30 天,一次性设置已完成,cos-setup 脚本 2026-10-09 随迁移完结清理,git 历史可查);顺带 tar `workspace/ssl` → `backups/misc/`(失败仅 warn 不致命);日志 `db.backup_done`(size/key/耗时)。**Redis 不备份**(队列/调度器 upsert 幂等自愈,语义可重建)。镜像需 pgdg `postgresql-client-16`(bookworm 缺省 15 < 服务端 16);恢复步骤见 standard/02 §6 |
| embed-content | `reconcile`(**embedding 对账**,M20 批②,2026-10-08) | 每 15 分钟(upsertJobScheduler `EMBED_RECONCILE_CRON` `7,22,37,52 * * * *` 错峰;手动回填 `npm run embed:run` 入队并轮询至完成) | 混合检索内容向量自愈(arch/04 §3.2):孤儿向量清理(下架/隐藏/回草稿)→ `findStaleEmbedSources` 扫缺/陈旧(三域 UNION;源时钟 post/repo=`updated_at`,telegram 无 updated_at 取 `COALESCE(ai_ran_at, created_at)`)→ 未绑定 embedding 角色 = 功能关闭记日志跳过 → 三域文本构造(标题/摘要前置,markdown 轻清洗截 4k)→ 批量 embed(16/次,用量逐次落 ai_usage_log role=embedding)→ upsert `search_embedding`(25/语句);单批失败不抛,下轮重扫自愈;编排 `src/lib/search/embed-reconcile.ts` |
| discovery | `discovery-hotwords` / `discovery-bili`(**优质内容发现**,M25,2026-10-12) | 日频 05:37 / 周一 06:13(upsertJobScheduler;手动 `POST /api/discovery/trigger {job}` 入 manual 一次性 job) | 联想词日频回灌词库(新词 pending 人工确认)+ B站双窗找博主/热点视频(L0 预筛落 discovery_candidate);队列纪律与编排见 §4.5,管道详设 arch/02 §3.3 |
| insight | `translate`(**海外信号中文化**,M58 批①,2026-10-30) | 非中文源 ingest 即时入队(按 signalId 幂等 jobId,`removeOnFail: true` 防确定性 jobId 静默去重)+ 每 10 分钟扫尾捞漏(upsertJobScheduler `INSIGHT_TRANSLATE_CRON` `5,15,25,35,45,55 * * * *`,jobRunKey `insight/translate`) | 只翻 `translation_status=pending` 的行(重复 job 幂等跳过):sha1 缓存命中直接落 `done`;未绑定 `translate` 角色返回 unbound 保持 pending(24h 降级兜底);成功=译文顶替 `normalizedText` + `embedding` 置空待重嵌(幂等不重复计费),失败重试 ≤2 后落 `failed` 保留原文;状态机与成本口径见 arch/01 §3.1,编排 `src/lib/insight/translate.ts` |
| insight | `extract-event`(**厂商事件抽取**,M58 批②,2026-10-30) | 厂商渠道(`crawl_source.type=vendor`)每轮采集逐篇入队(随机 jobId;去重靠 Redis 已处理标记 30 天 + `insight_entity_event.dedupeKey` 唯一索引,`removeOnFail: true` 使失败后下轮可重投;并发 1) | 单篇 LLM 抽取(role=insight)`{events:[...]}`,单篇 ≤3 事件、时间越界丢弃;`insight_entity_event` upsert(幂等)+ 事件按 dedupeKey 作 refId 入洞察池(`source=vendor-<key>`);未绑定模型=释标记跳过;失败只记 job 失败并释标记,**不回写采集源健康度**(抓取成功即健康);采集/解析/注册表见 `src/lib/insight/vendor/`(arch/01 §3.3);抽取后经 `resolveEntity` 落 `entity_id`(M60,arch/01 §3.3) |
| insight | `label`(**洞察打标小批**,M60 批C) | 每 30 分钟(upsertJobScheduler `INSIGHT_LABEL_CRON` `12,42 * * * *`,jobRunKey `insight/label`;无参=配额内小批,`data.clusterId`=后台手动补标单簇) | 批路径 `runLabelBatch(40)`(`src/lib/insight/label.ts`):未绑定 insight 模型整批跳过;候选数 = `min(剩余日配额, 40)`,只取成员 ≥`LABEL_MIN_MEMBERS`(3) 的未打标簇,逐簇成败混计(单簇抛错自吞记 failed 不中断整批);配额按 `countTodayRoleUsage`/`getRoleDailyMax`(role=insight)钳制,日批 03:57 仍以 `runLabelBatch(24)` 兜底收尾。单簇路径 `labelClusterNow`:共用 `labelReadiness` 前置门(未绑定/配额尽/簇不存在/成员不足 → 不触 LLM),失败上抛交 job 层记 failed;入口 `POST /api/insight/clusters/[id]/label`(admin 仅会话,PAT 拒绝,见 §5 接口清单) |

二期任务(立项时补设计):`distribute.*`(微信公众号等渠道分发,publish_channel 状态机)、`pay.*`(对账轮询);agent 触发类长任务设计落点 arch/04-ai-agent。**`crawler.*` 已交付**:文字渠道(M7,`crawl-{id}-{nextRunAt}`)+ 视频博主(M8,`crawl-video-{id}-{nextRunAt}`,编排见 `src/lib/telegram/ingest-video.ts`;调度器同一 `crawler-tick` 每 60s 扫描,`crawlDueSources` 排除平台行、`enqueueDueVideoAccounts` 扫 `social_account`);设计落点 arch/02-data-collection。**`leaderboard` 渠道已交付**(M58 批③,2026-10-30):复用同一 `crawler-tick` 生态(`crawl_source.type=leaderboard`,默认 1440 分钟),`config.boardKey` 路由 `src/lib/leaderboard/registry.ts` 取数+解析 → `insight_leaderboard_snapshot` 按 `(source, board, entityKey, 北京日)` upsert、同日重跑整表覆盖;解析 0 条计源失败不写空数据,原文经 `CrawlSnapshot` 归档;公开页 `/leaderboards/` ISR 3600s(arch/01 §3.2、arch/07 §1)。**`community` 渠道已交付**(M58 批④,2026-10-30):同为注册表型 `crawl_source.type=community`,`config.communityKey` 路由 `src/lib/insight/community/registry.ts`(HN/V2EX/百度下拉/OSS Issues 四源),worker 启动幂等种子 `community:<key>`;取数原文经 `CrawlSnapshot` 归档 → `l0Screen` 确定性准入(过短/纯符号/营销导流/批内重复)→ 按 `refId` 前置去重 → Redis 日预算(北京自然日,重复轮次不消耗额度)→ 逐条 `ingestInsightSignal`(source=`community-<key>`,非中文自动入翻译队列);解析 0 条计源失败不静默空跑(arch/01 §2.3/§2.4、plan §7)。**`interpret-video` 已交付**(M9,`interpreter` 队列并发 1/lockDuration 600s;ASR→LLM 管道编排 `src/lib/telegram/interpret-video.ts`,管道详设与红线见 arch/02 §3.2 落地注记)。**`summarize-text` + AI 补扫已交付**(M12 批③,2026-10-05):`summarizer` 队列(默认并发 2,lockDuration 300s——纯 LLM 秒级调用,与视频长任务分队列防阻塞)跑 `summarize-text` job(文字电报轻解读:一句话中心思想 + 要点 + 3-5 关键词(禁泛词,批⑥ 契约 v2),复用 `ai_*` 列;编排 `src/lib/telegram/summarize-text.ts`,ingest 落库即入队,治理台「摘要/重摘要」按钮经 POST `/api/telegram/[id]/summarize` 手动触发与重新生成);**AI 存量补扫** `ai-backfill` job 借 `crawler` 队列 tick 生态(`ai-backfill-tick` 每 5min,`worker/index.ts` 调度;扫 `ai_status IS NULL` 且 7 天内可见行每类 5 条,按 mediaType 分流入 interpreter/summarizer,入队前移除遗留 jobId + 先标 pending;对应模型未绑定的类整轮跳过防空转;编排 `src/lib/telegram/ai-backfill.ts`)。**`github.sync` 已交付**(M11,2026-10-05):`github` 队列,`github-tick` 每 5min 扫 `github_repo.next_sync_at` 到期白名单仓逐仓 fanout(`github-sync-{id}-{nextSyncAt}`,调度器见 worker/index.ts;sync 编排 `src/lib/github/sync.ts`——meta 条件写防 updatedAt 空转、README sha 跳写、动态去重裁剪;Unavailable/限频不计连败,Upstream 计连败 ≥3 → error;手动「立即同步」经 repos-admin 入队 `github-sync-{id}-manual-{ts}`)。**`seo-batch` 已交付**(M16 批⑤,2026-10-06):`seo-batch` 队列(并发 1,lockDuration 600s)跑单 job 顺序逐篇批量 SEO 补全——仅写空缺字段(seoTitle/seoDescription 均空才整篇生成,已有值一律保留),复用 `suggestSeo`(role="seo" 台账逐篇落行),单篇 catch 记 `failedIds` 继续;`POST /api/posts/seo-suggest-batch` 入队前 `resolveAiModel(summarize)` 前置校验(缺失 400,不产生无效 job),`GET …/[jobId]?token=` 轮询进度(cover-generate token 模式);编排 `src/lib/ai/seo-batch.ts`。**`wechat-sync`/`wechat-batch` 已交付**(M17 批③,2026-10-06):`distribute` 队列(**并发 1 全局串行**,lockDuration 900s——微信频控兜底,900s 覆盖单批 30 篇 × ~15s)跑两 job:单篇 `wechat-sync`(attempts 2,微信 API 瞬断重试一次;编排 `src/lib/distribute/wechat-sync.ts`——封面 add_material 永久素材 → 正文图 uploadimg 转存(publish_media_cache 按 sha1 缓存命中零上传,WebP 魔数嗅探转 jpeg;单图失败整篇终止列 src 清单,防公众号内裂图)→ markdown-it 全内联样式 HTML(`wechat-html.ts`)→ draft/add 首推或 draft/update 重推(`publish_channel.media_id` 锚定);content 超 2 万码点报错不截断;失败落 `publish_channel.status=failed` + last_error 人话)+ 批量 `wechat-batch`(attempts 1 篇级隔离已内置,`wechatBatchJob` 顺序逐篇 + `updateProgress{processed,total,failedIds}` 快照 + 篇间 `WECHAT_SYNC_GAP_MS` 1.5s);token 经 Redis 缓存(`distribute:wechat:token` EX=expiresIn-200,NX 锁防击穿,40001/42001 DEL 强刷重试一次,`wechat-client.ts`);发布自动钩子挂 `publishPost`(`maybeEnqueueAutoWechat` 永不抛,渠道关/旧文/缺封面/synced/pending 静默跳过,默认关)。**正文主题已交付**(主题扩展批⑦⑧,2026-10-07,仿 md.openwrite.cn):`wechat-themes.ts` 六款主题注册表(默认/青绿/暖橙/蔚蓝/雅紫/朱红,强调元素=标题/加粗/引用框/行内码/链接角标随主题变色,正文深灰与代码块暗底不随主题;客户端安全零 IO),`wechat-html.ts` 冻结样式常量改为 `stylesFor(theme)` 经渲染 env 注入(未知 id 回退默认,渲染永不抛);主题解析 overrides > 行快照(重推沿用)> 渠道默认,成功随行落快照;`POST /api/distribute/wechat/preview` 按文章 Markdown 以指定主题纯渲染(与推送管线同函数,不触微信 API 不写库),同步弹窗双栏同屏(左:标题/摘要/封面/主题色板,右:实时预览)。**`wechat-copy` 已交付**(M31 批④,2026-10-15):「复制公众号格式」备用通道——`distribute` 队列第三 job,`enqueueWechatCopy` 入队(资格前置=已配置+正文为 Markdown;**缺封面不拦**,无码点门、不写 publish_channel 状态机),`wechatCopyJob`(`wechat-copy-run.ts`)与同步同转存管线(封面 add_material 入永久素材库+正文图 uploadimg,共享 publish_media_cache sha1 缓存)产 mmbiz 图链内联样式 HTML 走 job returnvalue 交弹窗轮询,用户粘贴公众号编辑器正文区即得成品(图片零再传;封面从素材库选择)——承接超 API 2 万码点门的富稿。二期任务清单中 `distribute.*` 至此部分交付(公众号);`pay.*` 仍留池。

**专题合成不入队(M26 批④,2026-10-12)**:compose 走**同步 Route Handler**(admin 专题详情页点击触发,单次 LLM 调用 ≤15s,超时受绑定模型 timeoutSec 约束),编排 `src/lib/topics/compose.ts`;实测超限时再演进 BullMQ 入队(方案 §5 预留),当前不设队列不加 worker 任务。

### 4.4 数据网关 sidecar(services/douyin-gateway/,2026-10-04 M8 新增;M49 起兼小红书发布)

Python 3.11 + FastAPI **独立镜像独立容器**,平移自实战项目(签名 a_bogus + curl_cffi Chrome TLS 指纹 transport + Playwright 签名驱动 + Cookie jar 轮换/冷却/风控归因)。存在理由:抖音 WAF 按 TLS 指纹拦截标准 HTTP 客户端,只有 curl_cffi impersonate 实战验证有效(技术栈决策与平移记录见 memory `douyin-gateway-stays-python`);Node 侧只做编排与落库。

- **HTTP 契约**(compose 内网,无鉴权不暴露公网;Node 每次携带解密后的明文 jar,PG 为真相源,网关零密钥零持久化。**契约真相源**:TS 侧 Zod 镜像 `src/lib/telegram/adapters/video/gateway-contract.ts` + 黄金样本 `services/douyin-gateway/contract/*.json`,双侧对拍——网关改形状则 pytest 红,重生成 fixture 则 vitest 红,逼同步;/sign 仅网关内部消费不入契约):
  - `POST /sign {path,query,user_agent,cookies}` → `{params,user_agent}`
  - `POST /posts {platform?=douyin,sec_uid,cookies[],max_pages?=1}` → `{videos[],has_more,max_cursor}`(归一化 video_id/caption/topic_tags/cover_url/play_url/duration/published_at/digg/comment/share;play_url 仅日志调试禁止落库;**M24 起 platform 分发**——bilibili 时 `sec_uid`=纯数字 mid(1-16 位,per-platform validator),VideoOut 增 `play_count`(douyin 恒 null),B 站 vlist 无直链故 play_url 恒 null)
  - `POST /profile {platform?=douyin,sec_uid,cookies[],proxy?}` → `{sec_uid,nickname,avatar_url}`;`POST /resolve {platform?=douyin,url,proxy?}` → `{sec_uid}`(短链展开;B 站含 b23.tv)
  - **`proxy?` 字段(M33 批B,四请求模型通用)**:出口代理 URL(worker 从 `system_proxy_config` 解密后随请求携带,网关零密钥不变——不落盘不打日志;/health 只出 `egress_proxy` 布尔)。缺省=直连;transport 单例 `set_proxy()` 热切换不重建(jar 冷却态保留);代理/网络层故障归一 `EgressError` → **503 `{detail}`**(请求未达对端=基建错误,jar 不冷却,Node 侧 `GatewayUnavailableError` 顺延不计连败);CDN 视频直链下载不走代理(worker 侧直连,B 站 Referer 防盗链不变)
  - `POST /proxy-test {proxy}` → `{ok,latency_ms,detail}`(**M33 批B**:治理台「测试」按钮经此用待验代理访问 B 站首页一跳,ok = 0<status<500(4xx=通,风控墙另计);真正的消费方是网关 curl_cffi,由它测才测得准;10s 超时)
  - `POST /play-url {platform:"bilibili",video_id(BV 号),cookies[]}` → `{video_id,play_url|null}`(**M24 新增**:网关内 view→cid→playurl 三跳现查——B 站取直链必须 per-video 两跳,不能 listing 顺带;未登录 qn=32 360p mp4;durl 空且无 v_voucher → `play_url=null` 走 Node 侧既有 missing_transcript 降级;**v_voucher 软风控(code=0 无 durl,2026-10-11 实测)按风控归一**——归因矩阵就地 jar 冷却 + 502 RiskControlError;Node 侧 interpret 遇 RiskControl 与 NoJarAvailable **延迟重投顺延跨门**(M30 批A 起节奏 20min → 2h → 放弃重试降级「基于文案概括」missing_transcript,行留 processing;2026-10-14 生产实证:单视频 voucher 门 3 天 48 趟、每趟冷却唯一 jar 连带 9 博主采集连败——无上限顺延=全天候喂门训练,节奏必须有终点;终态可治理台「重解读」恢复);play_url 版权红线仅 job data 过境即焚;douyin 请求 422)
  - `POST /subtitle {platform:"bilibili",video_id(BV 号),cookies[],proxy?}` → `{video_id,subtitle_text|null,lang|null}`(**M33 批C 新增,字幕优先**:网关内 view→cid→`/x/player/wbi/v2`(wbi 签名)→`subtitle.subtitles[]` 择优(ai-zh > zh-CN > zh-Hans > 首个)→ 字幕 JSON 下载并拼纯文本——登录态(SESSDATA)才见 AI 字表,游客拿不到 → `subtitle_text=null` 走 Node 侧直链+ASR 既有管道;RiskControl/池耗尽照常上抛走既有风控门顺延;字幕 JSON 下载失败 = StructureDrift(不冷却 jar);**字幕文本与转写同红线:是「转写输入非资产」,禁落库,仅 job 内存消费**;douyin 请求 422)
  - `GET /health` → `{status,driver,warm_slots,in_use,last_error,jars_total,jars_available,egress_proxy,+platforms:{douyin:{jars_total,jars_available},bilibili:{…,wbi_age_seconds?}}}`(**永远 200**,浏览器/池态异常在 body 里表达——Node 侧探测不靠状态码;**M24 起 platforms per-platform 段**,顶层 `jars_*` 保留 = douyin 段,旧 TS zod 兼容;**M33 批B 起 `egress_proxy` 布尔**=网关内存有出口代理,永不出 URL)
  - 错误包络:适配层异常 `{error,detail}`(404/502);pydantic 校验/签名未就绪 `{detail}`(422/503,detail 兼容数组);B 站异常类与抖音**同名双端镜像**(RiskControlError/NoJarAvailableError/AccountInvalidError/StructureDriftError,Node 归因零感知)
- **错误归因三分**(Node 侧消费约定,**按状态码+error 字段分流**):网络层失败与 `503`(签名服务未就绪)= `GatewayUnavailableError` = 基础设施故障,顺延下轮**不计**博主连败;`502` 且 `error=NoJarAvailableError`(M30 批A 拆分:池耗尽≠真风控——请求未发出、不冷却任何 jar,2026-10-14 实证单视频门冷却唯一 jar 连带 9 博主连败)= 采集侧 **15min 短延重探不计连败**、解读侧同路顺延等同一份冷却;其余非 2xx(`404/422/502`)与响应不合契约(`ContractDrift`)= `GatewayUpstreamError` = 计入 `consecutive_fails` + `last_error`
- **小红书发布面(M49,`app/xhs/`:publisher 浏览器生命周期 + steps 命名步骤库 + support 现场/错误 + settings 选择器与节奏参数)**:
  - `POST /xhs/publish {pin_id|pinId,title,content,images:[{name,dataB64}]}` → `{ok,note_url|null}`;图片字节下发(worker 经 mediaStorage.get 读桶 base64 过内网,gateway 落临时文件供 set_input_files 后即清,保持零密钥),`decode_publish_images` 契约解码(dataB64 主读/data 别名兼容,**空字节即刻 400**——2026-10-27 字段名错位实弹:0 字节文件被平台静默忽略,上传假通过);错误包络:`400` XhsStateError 人话(登录态)/`500` detail=步骤人话+现场目录,worker 解析落 lastError
  - `POST /xhs/cookies {cookie_header}`:F12 串解析→裸 context 验证登录(首配 storage_state 未存自举,7d1c863)→落盘 storage_state;`GET /xhs/state`:登录态+页面结构地标(creator_tab 计数,平台改版早发现)
  - 发布流程=PUBLISH_STEPS 权威序(开页→切「上传图文」tab→上传→填标题正文(回读校验重填)→发布(closed shadow root 按宿主断言+绝对坐标点击)→确认成功信号(无响应周期补击));重试 3 次指数退避 30s→60s→120s(worker 侧),终态 failed 界面「重新发布」复位重入队
  - 韧性纪律:选择器/节奏一律 settings.py 集中(实证注释随常量,纯代码常量不入 env);失败现场=截图+DOM+URL+录屏 `debug/<ts>_<步>/` 滚动留 5 份(成功删视频);登录态唯一入口=分发中心渠道卡 Cookie 弹窗。适配 Runbook 与完整设计见 docs/plan/xhs-auto-publish-design.md §6.2/§8
- **B 站适配面(M24,`app/adapters/bilibili/`)**:wbi 纯算法签名(MIXIN_KEY_ENC_TAB 重排 + md5;nav 匿名接口取 img/sub key,12h 缓存 + 陈旧兜底,无 a_bogus 故 Playwright signer 子系统不参与);curl_cffi 同款 Chrome 指纹 transport;jar 池与抖音共用 `adapters/common/jar_pool.py`(平台独立实例)。**B 站错误主流形态是 HTTP 200 + body code≠0**(异于抖音):-352/-412/-116 → RiskControl(冷却 jar);-404/-400 → AccountInvalid;未知码 → StructureDrift;**code=0 但 data 带 v_voucher(无 durl)→ 同 RiskControl**(软风控挑战不走非零码,2026-10-11 实测;durl 并存时放行不误伤);HTTP 412/403 → RiskControl 即冷却不重试(风控墙确定性,重试加速拉黑);429/5xx/空 200 body → 重试预算 (1,2,5)s 不冷却。**观测事件**:网关侧留痕适配层错误 `social_bilibili_adapter_error`、软风控门 `social_bilibili_voucher_gate`、playurl 结果 `social_bilibili_playurl`(只记事件形态,直链值禁落日志)。**环境信誉门禁(2026-10-09 真机实测)**:`arc/search` 对 headless/数据中心上下文整段 -352(同请求 headed 浏览器过、headless 被拦,HTML 挑战页),与请求形状无关(wbi 参数/cookie/dm_img_* 复刻均无效)——登录态 jar 是生产答案(与抖音 ttwid-only 空响应同类运营缺口),游客 buvid3 仅够 nav/view/playurl
- 部署:compose 服务 `douyin-gateway`(prod 内网无 ports、tmpfs 指纹目录、mem_limit 1g、healthcheck urllib 探 /health、warm_slots=1 适配 2C4G);本地 `127.0.0.1:8010` 便于冒烟;发布段见 standard/02-cicd-deployment。env:`DOUYIN_GATEWAY_URL`(default `http://127.0.0.1:8010`)

### 4.3 本地与部署形态

- 本地:`npm run worker`(tsx 直跑);生产:compose `worker` 服务,**与 web 同镜像**,command 覆盖为 `node dist/worker/index.js`(构建期 tsc 编译,outDir=dist)
- worker 内存上限 512m(sharp 处理大图吃内存),并发 = 2 起步,按服务器余量调

### 4.5 优质内容发现队列(`discovery`,2026-10-12 M25 新增)

- **纪律**:`concurrency: 1` + `lockDuration 900s`(B站风控全局串行,双窗全词约 5-10 分钟)+ `attempts=1`(B站退避在 processor 内实现,队列层不自动重试防风控风暴);管道详设与风控纪律见 arch/02 §3.3,方案锚 docs/plan/discovery-plan.md
- **两 repeatable job**(upsertJobScheduler,Asia/Shanghai):`discovery-hotwords` 日频 `37 5 * * *`(错峰 03:23 backup / 03:41 audit / 04:52 usage purge)+ `discovery-bili` 周一 `13 6 * * 1`;每轮 active 词上限 20(`DISCOVERY_MAX_WORDS_PER_ROUND`,LRU 顺延)
- **手动触发**:`POST /api/discovery/trigger {job:"hotwords"|"bili"}` 入同名一次性 job(jobId `manual-` 前缀 + 时间戳,removeOnComplete/Fail 200);真触发不入 e2e(worker 在场即真出网)
- 编排:`src/lib/discovery/`(suggest 源插件化/l0.ts/discover.ts/hotwords.ts/keywords·candidates 仓储);状态常量单源 `src/lib/discovery/status.ts`(客户端安全,治理台组件共用)

### 4.6 卡片渲染 sidecar(services/card-renderer/,2026-10-17 M31 新增)

Node 20 + Playwright chromium **独立镜像独立容器**(node:20-slim + fonts-noto-cjk/fonts-noto-color-emoji),渲染内核=浏览器以保全任意 CSS(agent 编排的富排版 HTML → PNG 卡图)。与 douyin-gateway 同款 sidecar 模式:compose 内网无 ports,web 容器经 `CARD_RENDERER_URL` 调用;业务语义(preset 模板/消毒/媒体改写)全在 app 侧 `src/lib/card/`,本服务纯引擎零业务。**生产部署合并后另批请批**。

- **HTTP 契约**(无鉴权不暴露公网):
  - `POST /render {html, width?=900, scale?=2, maxHeight?=4000, timeoutMs?=12000}` → `200 image/png`(`X-Card-Width`/`X-Card-Height` = 逻辑像素;`scale`=deviceScaleFactor 出 2x 清晰图)/ `400` 入参校验 / `413` 高度超限(提示拆卡)/ `429` 忙 / `504` 超时 / `500` 渲染失败——错误体 `{error}` 人话短句,agent 直接转述
  - `GET /health` → `200 {ok:true,browser:"up"}`(compose healthcheck,node fetch;浏览器拉起失败 `503 {ok:false}`)
  - `POST /snapshot {url, timeoutMs?, settleMs?, clickText?, screenshot?}`(M56 批A,采集侧取原文)→ `{html, finalUrl, httpStatus, png?}`;导航到 **RENDER_ALLOWED_HOSTS 白名单** URL(未配置=403),JS 开启、子资源照常(与 /render 相反——目标是真实公开站点),`clickText` 切 tab 态。**整页截图口径(2026-10-29 实测修正)**:SPA 常把正文塞进 `overflow:auto` 内部容器,此时 `documentElement.scrollHeight` 只有视口高(1440×900),`fullPage` 会截成半张——故先量「文档/body/全部元素 scrollHeight」最大值,把视口撑到该高度(上限 15000px)再截;懒加载滚底一轮同时下滚内部滚动容器(只滚 window 对中栏布局等于没滚)
- **渲染安全三层收口**(渲染面 SSRF/外联归零):① app 侧 cheerio 白名单消毒(`src/lib/card/sanitize.ts`,自由模入服务前唯一闸,违规整体报错交 agent 自纠);② 服务侧请求级硬闸 `context.route` **仅放行 data:/about:blank**,其余(导航/图片/字体/XHR)全 abort,`javaScriptEnabled=false` `<script>` 天然不执行;③ 站内引图 `file:///…` 在 **Node 侧读盘内联 data-URI**(`inlineLocalMedia`:路径包含校验 `isInsideMediaRoot` 防遍历 + 8MB 上限,失败降级 1x1 透明占位)——chromium 不触文件系统(about:blank 源默认禁 file:// 子资源,直读路线不可行)
- **资源形态**:浏览器常驻单例(崩溃惰性重启,冷启动即预热);并发信号量 `MAX_CONCURRENT=2` 满员即刻 429(fail-fast,排队让 agent 工具白等不如提示重试);RAW 请求体 6MB / HTML 400k 上限;compose `tmpfs /tmp/card-renderer` + `mem_limit 768m` + `start_period 60s`(chromium 首启慢)+ 媒体卷 `./workspace/media:/app/media:ro` 只读挂载(引图直读)
- **env 三处一致红线**:服务 `MEDIA_ROOT`(default `/app/media`)= compose 挂载容器路径 = app 侧 `CARD_RENDERER_MEDIA_ROOT`(default `/app/media`);app `CARD_RENDERER_URL`(default `http://127.0.0.1:8011` 本地裸跑,compose 内 `http://card-renderer:8011`)。本地 `127.0.0.1:8011` 便于冒烟;CI 增 card-renderer 单测 job(`node --test` 零依赖直跑)+ `docker-release-card-renderer` 发布段(`aitech-hub-card-renderer` 镜像,develop-\<sha\>/latest 双 tag,见 standard/02)
- **业务层 preset 体系**(M36,app 侧 `src/lib/card/`):preset 模板=zod 校验数据(~300-600 token/卡,报错人话供自纠)→ `templates/` 双主题 HTML——深空蓝紫系=观点/数据(quote/points/stats)、马卡龙浅色系=流程/方法(compare/steps/flow/timeline,flow=泳道全景:lanes×phases×steps 编号流转);全部文本经转义无注入面,`min-height:600px` 硬口径防渲染器 600px 视口下限露白带;自由 HTML 模走消毒(见上①)。admin 可视化调试台 `/admin/cards`(M36 模板库页:7 卡型清单/示例数据 JSON 实时预览——客户端 `renderPreset` 纯函数与 agent 同 zod 口径/「渲染 PNG」走真管线),`POST /api/card-presets/preview` **只渲不入媒体库**(与 render_card 工具的关键差异,零副作用)。写作指南文本真相源 `src/lib/ai/writing-guides.ts`(seed 与 oneoff 同源;blogger-video 指南 M36 改版=卡型路由表+文卡交错节奏,黑白灰内联笔记卡模板退役)

### 4.7 配图工坊队列(`illustration-studio`,2026-10-22 M40 批 B 新增)

generate_illustration 出图后的**手动拆层精修通道**:Seedream 同端点 `layer_decomposition` 拆层(1 干净底板 + N 透明 PNG 图层,各带 normalized 0-999 bbox)→ 编辑器 `/admin/illustration/[id]` 显隐组合导出与三条交互编辑回路(改字必选/消除笔/自由重绘,统一 bbox+指令 → 交互编辑 → 新整图,预览态确认制落版本链)。入口两路(2026-10-22 验收反馈补后台固定入口;IA v2 起「创作·配图工坊」,2026-10-23 创作域对齐批):侧栏「创作·配图工坊」→ 列表页 `/admin/illustration`(根版本倒序网格,server component 直查零新 API;?q= 对 name/mediaPath 双列模糊搜索)+ agent 回执链接直达编辑器。spike 实证契约与产物锚 docs/plan/development-plan.md M40 行(探针 workspace/tmp/spike-illustration-studio/)。**F13/F14 UI 对齐(2026-10-23)**:列表页两行结构(pageHead+toolbar)+3 列信息卡(链尾最新版本图 + 派生名称 + 「vN · MM-DD · N 层」,点卡进链尾编辑器);编辑器头部名称+来源 chip、版本链 v 序号 chips+「＋ 新版本」引导定位编辑面板、右栏三卡与画布 hint/尺寸 label 贴板(Ardot 739246438907714)。

- **纪律**:`concurrency: 1` + `lockDuration 600s`(spike 实测拆层 ~75s,慢调用)+ `attempts=1`(生图计费不自动重试,同 cover 口径);jobId `illu-decompose-<groupId>` 锚自增组 ID 天然唯一(冒号禁用同 §4.1);手动触发 `POST /api/illustration/studio/[id]/decompose`,同版本已有 processing 组 409 人话拒(防重复计费双拆)
- **拆层契约**(执行核心 `src/lib/ai/illustration-decompose.ts`,不走 generateImages——响应行携带图层元数据,单模块自带请求与行解析):POST `{baseUrl}/images/generations` body `{model, image(data URL ≤6MB), layer_decomposition: true, size: "2K", response_format: "url"}`,prompt 不传=自动拆层;超时专用 180s 档(不走模型 60s 常规档);官方 URL 24h 过期前逐层下载转存站内媒体;底板缺失/全层转存失败判组失败(failed+人话 error),单层失败跳过不废整组;计费=每调用 1 行 usage(拆层单价待用户核实后设置补录——M40 五决策)
- **编辑回路**(执行核心 `src/lib/ai/illustration-edit.ts`,复用 generateImages 的 image 参照通道):三回路 prompt 模板单源 `buildEditPrompt`,`<bbox>x1 y1 x2 y2</bbox>`(normalized 0-999 左上原点)+指令,size "2K" 同步 ~15s 返候选整图(uploadMedia 直入库;弃用即闲置不回收,同 generate_illustration 未选用口径;确认走 `/versions` 落版本链)
- **版本链治理**(服务层 `src/lib/ai/illustration-studio.ts`):agent 出图即登记根版本(`ensureStudioRoot` get-or-create,免费 DB 行,工具回执带 `/admin/illustration/<id>` 链接;拆层本身纯手动计费——M40 五决策);改字确认后旧图层组过期,重拆=新组(手动);表结构见 arch/03 §2.4 配图工坊三表。**登记名/来源(F13/F14 对齐批 2026-10-23)**:`ensureStudioRoot` 可选参 `{name, source}`——name=`deriveIllustrationName(prompt)`(trim 折叠空白取前 40 字,空回落 null),source 两口各记 `agent`(agent 工具)/`studio`(工坊直出 job);仅 create 时落(复用根不覆盖),编辑确认新版本随 parent 继承;列表卡名称/「vN · 日期 · N 层」meta 与编辑器头部名称+来源 chip 均按此展示,NULL 兜底「配图 #id」/来源不显
- **导出**:显隐组合合成在编辑器前端 canvas(底板+可见层按 normalized bbox 定位缩放;底板=抠净元素的干净底,藏层即元素真消失)→ `POST /api/media` 入库;官方水印「AI生成」烙在底板上,导出恒带(合规自动闭环)

### 4.8 贴图公众号同步队列(`pin-wechat-sync`,2026-10-22 M41 新增)

贴图(newspic「小绿书」图片消息)推送公众号草稿箱的异步通道,执行核心 `src/lib/distribute/pin-wechat-sync.ts`。job `DISTRIBUTE_JOB_PIN_WECHAT`(`pin-wechat-sync`)落 `QUEUE_DISTRIBUTE`——与文章图文同步共享 `concurrency: 1` 串行(微信频控同源);attempts=2(失败落行不抛,worker 重试兜底瞬态抖动)。入口两路:组装台「同步至公众号草稿箱」按钮 + agent/脚本 `POST /api/pins/[id]/sync`。

- **入队资格前置**(全 400 人话,先判后建):未配置公众号 / 贴图 draft 未验收(点明先提交验收)/ 无图( newspic 至少 1 张)/ 渠道行 pending 拒重——**建行前先判**,零入队零落行(防僵尸 pending 首单教训,同文章 sync 口径);synced 有 mediaId 重推放行(draft/update 增量改)
- **管线**:逐张 `add_material` 换永久 MediaID(ensureCoverMedia 复用,publish_media_cache `m:<sha1>` 缓存命中零重传;任一张失败整单终止——裂图比不同步更糟)→ 组 newspic 载荷(image_list ≤20 首张即封面 / crop_percent_list 三档 / content_source_url 阅读原文缺省不带)→ 首推 `draft/add`(mediaId 锚定落行)、重推 `draft/update`(行 mediaId 定位,不动站点发布态)→ 41039 content_source_url 域名校验拒 → 去阅读原文字段重试一次(同图文口径,落 warn 留痕)。同步侧兜底校验(缺图/标题超 32 码点/轻文字超 2 万码点)failed 落行人话——不信任上游
- **状态机**:渠道行 pending→synced/failed(人话进 last_error ≤500,attempts 递增),成功事务内贴图 pending→synced(首推时;重推已 published 不动站点态);失败返回不抛由 job 包装上抛(attempts 兜底)
- **参照图入参(M42 批③)**:`POST /api/pins/[id]/generate` 可选 `referencePath`(仅站内 `/wp-content/uploads/` 路径,Zod `isUploadsPath`)→ `IllustrationGenerateJobData.referencePath` → `generateIllustrations({ referencePath })` 全链透传;装载失败如实回 `referenceError` 不阻塞出图(同 §4.7 降级口径)

### 4.9 创作中心服务编排(同步,不入队,2026-10-22 M42)

创作台的落库与选材均为**毫秒级事务/查询**,不进队列(秒级红线只约束请求内长任务);AI 出图仍复用 §4.7 `illustration-studio` 队列。

- **`searchMaterials({ kind?, q?, limit? })`**(`src/lib/topics/materials.ts`,agent `search_materials` 工具的服务层):电报(视频须已解读 / 文本须 visible 且摘要非空)+ 历史文章(未软删)`contains` 检索,按 `aiRanAt/publishedAt` 倒序(详情页挂载候选显式 `aiRanAt DESC NULLS LAST`:文本素材无 `aiRanAt`,PG 的 DESC 缺省 NULLS FIRST 会把整批文本顶到首页、新解读视频沉到末页);`mountMaterial`/`unmountMaterial` **幂等**(重复挂载返回 `{created:false}` 不报错),写侧仍走既有唯一键与素材资格校验
- **`resolveTopicReferences(topic, opts?)`**(`src/lib/topics/references.ts`):参照候选装配,优先级 `样例图(sample_image)→ 素材视频封面 → 挂载文章正文图 → 本创作已有贴图`;去重、仅站内 uploads、上限 10;详情页渲染**不发起外链转存**(视频封面在生成期由 agent 转存后进候选,避免页面加载外呼)
- **`createPinWithImages(input)`**(`src/lib/pins/assemble.ts`,agent `save_topic_pin` 的服务层):单事务建 `content_pin` + 有序 `content_pin_image`(sortOrder 落序)、写 `referenceMediaPath`、创作状态 collecting→drafted;失败整体回滚。硬闸与贴图组装台同源(`PIN_TITLE_MAX/PIN_CONTENT_MAX/PIN_IMAGES_MAX` 码点口径、图片仅 uploads、重复 path 拒);**阅读原文缺省回填本贴前台自链**(2026-10-24 验收批二:`absoluteUrl(pinPath(id, asciiSlugFromTitle(title)))` id 锚定,未发布先落链、发布后即达;同事务补写,手工 `repo.createPin` 同口径;显式传入覆盖);create-only;既有贴图文字修改走 agent `update_topic_pin`(2026-10-24 验收批,归属按 topic 校验、`pinUpdateSchema` 码点单源、repo `updatePin` 守 synced/published 红线),图片序列编辑仍在组装台
- **`createTopicFromCluster(clusterId)`**(`src/lib/insight/topic-gen.ts`,`POST /api/insight/clusters/[id]/topic`,2026-10-24 验收批二 洞察→创作联动,F25/F26「生成选题」落地):洞察簇一键转创作选题——簇 label(未打标退首关键词)/概括/关联词建题(outputType 缺省 article),成员信号里 telegram-ai 源(refId=telegram 行 id)按成员权重降序**自动挂载电报素材**(封顶 5,单条不合格自吞跳过不回滚建题,`mountMaterial` 幂等可重入);返回 `{topic_id, mounted, scanned, admin_url}` 供详情页就地跳转创作中心

### 4.10 公众号私信入站队列(`wechat-mp`,2026-11-01 M66 新增)

被动回复 **5 秒硬约束**下的双段式生成链路:Route Handler 只做验签/幂等/轮询,生成在 worker(方案见 [plan/wechat-mp-bot-plan](../plan/wechat-mp-bot-plan.md))。

- **`wechat-mp.answer`**:入站文本 → `searchAll(q)` → `chatJson`(`{canAnswer,answer,citeIds}`,summarize 角色)→ 引用越界丢弃 → ≤1800 字节截断 → 写 Redis `channel:wxmp:reply:<msgId>`(TTL 30min)+ 落 `channel_wechat_mp_message`。jobId `wxmp-<messageId>`(落库消息 id 纯数字;**BullMQ 自定义 jobId 禁冒号**,入站 `dedupeKey` 形如 `msg:<MsgId>` 不可直接拼接,否则 `add` 抛错、L1 链路整条降级成错误话术)。**检索 0 命中或 `canAnswer=false` 不调模型**,直接落固定话术;系统错误(队列/模型/检索)另用 `texts.error` 话术,不与「没找到」混用
- **`wechat-mp.purge`**:每日 04:24(`upsertJobScheduler`),清 180 天前 `channel_wechat_mp_message`(口径同 `stats` 明细清理,用户/线索行保留)
- **请求内等待的例外**:`/api/wechat/mp` 在请求内轮询 Redis 结果键 ≤4.2s(100ms 间隔)——不承担生成,只为贴合平台 5 秒窗口;超时回 `【答案正在生成,请稍等几秒后回复「继续」获取】`,worker 算完仍落缓存供回捞
- **「继续」短轮询**:入队即写在途指针 `channel:wxmp:active:<openid>`;用户发「继续」时若答案尚未生成,请求内再轮询结果键 ≤3.4s(生成实测 3–8s,用户多在超时回执后数秒内就发「继续」),取到即回答案并清指针,仍未好才回「答案还在生成中」
- 关注欢迎语、关键词直连、「继续」回捞、转人工回执、人工答复投递均为**同步毫秒级**,不入队
- **转人工闭环(2026-11-01)**:认证订阅号无客服消息权限(`48001`),无法主动推送——命中转人工词只落 `channel_wechat_mp_lead` + 飞书站务卡;**AI 不暂停**(线索只驱动待办角标)。站长在后台会话详情写「人工答复」→ 存 `channel_wechat_mp_user.manual_reply/manual_reply_at`(一次一条,覆盖式)→ 该用户**下次任意发言**时由 `dispatch` 最前置分支取走(条件更新保证只投递一次),带 `【站长答复】` 前缀发出、`reply_kind='manual'`,并把其 `open` 线索转 `replied`;超过 7 天(`WECHAT_MP_MANUAL_REPLY_TTL_SECONDS`)未发言则静默作废(用户刚发的是新问题,陈年答复比不答更糟)。线索状态机:`open`(待回复)→ `replied`(答复已送达待处置)→ `handled`(已归档,全部 handled 才清 `is_manual_pending`)。**要真·实时客服需微信客服 API(企业/组织主体),本号不适用**,取舍登记于此
- 队列 opts:`concurrency 1`、`lockDuration 120s`(与站内问答争 summarize 角色,串行保口碑);后台处置面=`/admin/wechat-mp/`(会话 / 关键词 页签,侧栏「分发 → 公众号会话」),接入配置在「系统设置 → 公众号」(`/admin/settings/wechat-mp/`,2026-11-01 由 `/admin/wechat-mp/config/` 迁入,旧路径 308),站务通知凭据在「系统设置 → 站务通知」

## 5. 一期接口清单(Route Handlers)

**响应包络**:一律经 `apiEnvelope`(`src/lib/http/response.ts`)返回 `{code,message,data}`,code=0 → 200,其余 code 兼作 HTTP 状态。**豁免**(非业务协议,不得套包络;2026-11-01 批D 登记,此前散落无记录):
- `/api/health`(compose healthcheck 只要 2xx,返回值仅人读)、`/api/mcp`(MCP JSON-RPC 协议体)、`/api/view`·`/api/stats/bot`·`/api/stats/click`(beacon 恒 204 无响应体,客户端不消费)
- 二进制/文本直出:媒体、`.md`/`.txt`/`.xml` RSS 与 llms、`/wp-content/*`、`/legacy/*`
- SSE 端点(`/api/search/answer`、`.../runs/stream`)业务降级走事件帧而非状态码(arch/04 §3.4)

`/api/internal/revalidate` 不属豁免:内部运维协议同样走包络(2026-11-01 收口,此前成功分支裸 `{revalidated}`、失败分支手搓 `{code,message}` 无 data)。

| 域 | 端点 | 鉴权 |
|----|------|------|
| auth | login / logout / session、`GET /api/auth/feishu/status`(M29:下发 `{enabled, appId}` 供 H5 `tt.requestAccess`;凭证齐即可,enabled 透传不设门——兑换由 exchange 把关;凭证不齐 403)、`POST /api/auth/feishu/exchange`(M29:免登授权码兑换会话;白名单命中 + role/status 复核 + IP 30/h;未启用 403,未绑定模糊 403,upstream 502 不外吐细节)、`POST /api/auth/sms-code`(M65:触发验证码下发;恒定应答不暴露号码是否注册,admin 号码静默不发)、`POST /api/auth/sms-login`(M65:登录/注册合一,须 `agreed:true`;admin 403;错 5 次锁 15min) | login/session/exchange/status 公开(exchange 有防滥用,status 零外呼零签名);sms-code/sms-login 公开(频控 + Origin 校验) |
| account(手机号) | `POST /api/account/phone/code`(按场景发码:bind 100004 / rebind_old 100005 / rebind_new 100002)、`POST /api/account/phone/verify`(验码:bind/rebind_new 落库,rebind_old 只置 10 分钟放行标记;M65 P1) | 登录会话(`requireAccountRequest`,admin 403;Origin 校验;频控与日预算同 §3.4) |
| sms(管理) | `GET/PUT /api/sms-config`(单例脱敏视图/保存,secret 留空=保留;启用须凭据齐)、`POST /api/sms-config/test`(实调下发探针,落 last_test;M65) | admin 仅会话(§3.4) |
| feishu(管理) | `GET/PUT /api/admin/feishu/config`(脱敏视图/保存,secret 留空=保留)、`POST /api/admin/feishu/test`(探测 app_token 链路,落 lastTest)、`GET /api/admin/feishu/bind`(当前绑定视图)、`POST /api/admin/feishu/bind`(授权码自绑/换绑,跨锚 409)、`DELETE /api/admin/feishu/bind`(自解绑,幂等) | admin 仅会话(mutation Origin 校验,§3.1) |
| content | `GET /api/posts`(管理列表,草稿含;q 搜索)、`PUT /api/posts`(发布 API upsert:slug 幂等,原始 md 服务端解析 frontmatter,图片随文 base64 复用 M5-b 上传管线,publish=true 直发;legacy 纯 HTML 旧文 409 保真)、`POST/PUT/DELETE /api/posts/[id]`、`publish/unpublish`(POST 建文 slug 缺省由标题派生 ASCII、冲突自动追加 `-2…-9` 后缀、纯中文标题 → NULL;显式指定冲突仍 409;PUT 可改 slug——URL 由 id 锚定不破链)、`POST /api/posts/seo-suggest`(SEO 字段一键 LLM 补全,复用 summarize 绑定同步轻调用,M14 批④)、`POST /api/posts/seo-suggest-batch` + `GET /api/posts/seo-suggest-batch/[jobId]?token=`(文章列表多选批量 SEO 补全:仅补空缺不覆盖已有值,入 `seo-batch` 队列顺序逐篇 + 单篇失败隔离 `failedIds`;summarize 绑定缺失 400 前置拒绝不产生无效 job;ids 上限 50,M16)、`GET /api/posts/cover-candidates/[id]/raw`(agent 封面候选预览:token 走 x-cover-token 头(技术债批④,不落访问日志),hold 临时件按字节回图,已入库行 302 正式路径;会话鉴权,M31;hold/adopt 见 arch/04 封面候选 HITL;hold 孤儿目录(悬空中断/顶替遗留)由 cover-gen 队列 `temp-sweep` job 日频清扫,24h 过期回收) | admin(管理路会话或 PAT 双路,§3.1;seo-suggest* 仅会话) |
| pats | `GET/POST /api/pats`、`POST /api/pats/[id]/revoke`(仅会话——PAT 不得自我增殖;明文仅签发时返回一次,库存 sha256) | admin |
| mcp | `POST /api/mcp`(Streamable HTTP stateless,每请求新建 transport;Bearer PAT 鉴权在 MCP 协议层之前;六工具 upsert_article/upload_media/get_article/list_articles/publish/unpublish,一律 slug 为键;GET/DELETE 405;接入串 arch/04 §2) | admin(PAT) |
| content | `GET /api/search?q=`、`GET /api/search/answer/?q=`(AI 答案卡 SSE,arch/04 §3.4:四事件 meta/delta/done/unavailable,业务降级走 `unavailable` 事件不占 HTTP 状态——仅 q 校验 400、IP 频控 429 用状态码;nginx `location ^~ /api/search/` `proxy_buffering off`)、`GET/POST /api/search/agent/threads`(K2.5 Drawer 会话列表/新建;K2.6 身份分流——admin(ah_at role=admin)走会话行(列表/新建 20/日/visitor),游客(ah_av cookie)列表恒空、新建 `g_<uuid>` 线程只绑 Redis 归属键(2h 滑动 TTL),run 收尾落**匿名会话行**(`visitor_id='guest'`,M58 批⑤ 后续;内容 30 天留档))、`DELETE /api/search/agent/threads/[threadId]`(admin 行+checkpoint 同删;游客解绑 Redis 键+删 checkpoint,归属校验 404)、`GET /api/search/agent/threads/[threadId]/state`(values.messages 扁平序列化,切线程恢复历史;游客查 Redis 归属,过期 404 前端自愈)、`POST /api/search/agent/threads/[threadId]/runs/stream`(langgraph 协议 SSE 核心:input 只收单条 human 文本 ≤2000;admin 会话累计 ≤50k 前置拒绝 / 游客 3 问/日+30 问/日/IP 双闸 429 / IP 10 次/分频控;业务降级走 `error` 帧不占 HTTP 状态;客户端断开即中止 agent;nginx 同上已覆盖) | 公开(身份分流归属绑定防越权;mutation 同源校验) |
| agent-sessions | `GET /api/agent-sessions?page&kind=all\|member\|guest&q`、`GET /api/agent-sessions/[threadId]`(K2.6 后台会话管理:成员=会话行+台账 runs 计数,游客=匿名留档行(`visitor_id='guest'`)∪ ai_usage_log 按 session_id 聚合+Redis 活跃态;详情 meta+checkpoint 消息时间线,归属键消失不删内容、内容按 30 天留档,清退后仅 meta 标「已过期」;页面 `/admin/usage/sessions`(AI 用量「会话」页签,侧栏精简批②;旧 /admin/agent-sessions 308 承接)) | admin **仅会话**(PAT 拒绝,同 users 套路) |
| stats | `POST /api/view { path, referrer?, q? }`(同源校验 + bot/管理员过滤)、`POST /api/stats/bot`(2026-10-07 方案B:middleware 对已命名爬虫的 HTML GET 按 UA 名单(`lib/stats/bots.ts`,AI/搜索两类)识别后 waitUntil 打此端点;x-original-ua 端点侧二次分类不信任调用方声明;`ingestBotFetch` 写入与真人同一 ref 日缓冲 `source_class='bot'`,只记 PV 不去重,复用既有 flush 落 `stats_referrer_daily` 零新表;未识别 UA 204 不入账,伪造面与 beacon 相同)、`POST /api/stats/click { surface, kind, ref, target }`(M28 批① 条目点击 beacon:同源校验 + bot/管理员过滤同 /api/view 门;ref 字符集白名单 `^[A-Za-z0-9_-]{1,100}$`;target 只用于服务端解析外链域名不落原文;行级直插 `stats_click_log` 失败仅 warn 恒 204;presence 心跳同挂 ingestView 尾部——5 分钟滑窗 Redis ZSET,M28 批②) | 公开(IP+UA 哈希日去重;文章 PV 另设 1h 去重窗,Redis 缓冲 60s 批量落库);2026-10-06 起 /search 页带 q 时行级直插 `stats_search_log`(搜索词排行,过同一 bot/管理员门,口径 = /search counted PV);bot 类目不进流量来源卡,后台统计页单独「爬虫流量」卡(AI 爬虫/搜索爬虫细分 + 真人 PV 对照) |
| media | `POST /api/media`(上传;M16 修 compose web 容器媒体卷 ro 挂载遗留——写盘 EROFS 500 根因,摘 ro 改读写与 worker 口径一致;畸形 multipart 400 映射)、`POST /api/media/import`(外链图批量转存,enqueue 返回 jobId,前端轮询取映射;M16 起 jobId 连字符禁冒号同 §4.1 口径,queue.add 包 try/catch 映射 502 不再静默)、`GET /api/media`(列表/过滤)、`DELETE /api/media/[id]`、`GET /api/media/{orphans,duplicates,stats}`、`POST /api/media/dupes/merge`(重复 sha1 分组合并,M14 批①)、`GET /api/media/pick`(封面选图轻列表:24/页 createdAt 倒序 + 文件名模糊搜,不碰引用索引,M14 批⑤) | admin(管理路会话/PAT 双路,§3.1;**pick 仅会话**——编辑器交互面;2026-10-07 上传日志补 actor 归因,nginx `client_max_body_size 12m` 配套媒体直传) |
| users | `GET/PUT /api/me/profile`、`PUT /api/me/password`(三期用户体系启用)、`GET /api/users`、`PUT /api/users/[id]/status`(后两者仅会话,§3.1;不能变更当前登录账号;禁用即吊销该用户全部 PAT) | user / admin |
| comment | `GET/POST /api/post-comments`(M23 前台评论:GET 分页 visible+liked 随身份,IP 读限 120/分;POST 登录发评,**先发后审** status=visible 即时可见——屏蔽词 scope=comment 命中 400、双闸限流 用户 10 条/时 + IP 30 条/时 429,两级封顶父校验 400)、`PUT/DELETE /api/post-comments/[id]`(治理:隐藏/恢复两态互切;物理删连带直接子与点赞行,不可逆)、`POST/GET /api/post-like`、`POST/GET /api/comment-like`(点赞 toggle:identityKey `"u:<userId>"｜"v:<ah_av>"` 单列去重,身份 60 次/时 + IP 240 次/时;先删后建收敛并发——PG 唯一冲突即中止事务,事务内 catch P2002 再删必 25P02) | GET/点赞 公开(游客可赞;身份解析 §3.2,首响应种 ah_av);发评=登录会话(401 人话);治理=admin **仅会话**(PAT 拒);屏蔽词复用 blocklist 表 scope 扩值 `comment`(arch/02 §4) |
| telegram | `GET/POST /api/channels`、`PUT /api/channels/[id]`、`PUT /api/channels/[id]/status`(启停)、`POST /api/channels/[id]/crawl`(手动采集;渠道凭证存 config 展示一律脱敏,M7 批④a)、`POST /api/channels/[id]/debug`(一键调试拉取,M14 批②)、`PUT /api/telegram/[id]`(条目人工修正/状态迁移 title≤500/summary≤1000/三态,批④b)、`GET/POST /api/blocklist`、`PUT/DELETE /api/blocklist/[id]`(批④b)、`GET /api/telegram/public`(前台公共流:limit≤50/after 增量锚/source 过滤/`media=all\|text\|video` 白名单,M8 批④,`no-store`,BigInt 出参字符串化,M7 批⑤;M15 批① 起仅出 AI 解读终态行、after 锚 `aiRanAt` 变可见时刻,见 arch/02 §3.2 M15 注记) | 除 public 外 admin **仅会话**(PAT 禁管渠道/治理电报流,§3.1);public 公开只读 visible |
| bloggers | `GET/POST /api/bloggers`(登记:主页链接/口令/sec_uid 三态,经网关 resolve+profile,重复 409)、`PUT /api/bloggers/[id]`、`PUT /api/bloggers/[id]/status`(启停)、`POST /api/bloggers/[id]/crawl`(手动采集;均 PAT 拒绝)、`GET/POST/DELETE /api/bloggers/cookies`(Cookie 池:脱敏视图/导入 AES-256-GCM 落库(校验 ≥3 对含 ttwid)/清空,platform 白名单 douyin\|xhs\|bilibili;`?platform=` 查询,平台行不存在 404;M8 批③)、`POST /api/bloggers/[id]/backfill`(向前深扫 30 天补采,平台行停用 409) | admin **仅会话**(PAT 禁管博主与 Cookie) |
| crawl-snapshots(采集快照) | `GET /api/crawl-snapshots/[id]?f=view\|raw\|png`(M56 P0 回溯档案:采集原文/整页截图读取;`view` 响应带 `Content-Security-Policy: sandbox` + 后台 iframe `sandbox=""` 双闸,`raw`=text/plain,`png`=image/png;对象已按保留策略清理 404 人话) | admin **仅会话** |
| discovery | `GET/POST /api/discovery/keywords`(词库分段列表 status/page / 人工添加:添加即 `origin=manual, status=active, confirmedAt=now`,撞 word 唯一 409 人话不覆盖不复活)、`PUT /api/discovery/keywords/[id]`(三态流转:active 记 confirmedAt/pending 清之)、`GET /api/discovery/candidates`(候选分段列表)、`PUT /api/discovery/candidates/[id]`(终审三态可逆,人工结论不因重复发现回退;**批准博主类型候选自动登记进博主管理**,M26 批③追加,登记失败不阻塞批准可重试)、`POST /api/discovery/trigger`(手动触发 hotwords\|bili 入 manual 一次性 job;均 M25 批③) | admin **仅会话**(PAT 拒绝管理发现域;mutation Origin 校验) |
| insight | `GET/POST /api/insight/taxonomy`(M54 批A 领域词表:GET 全量含停用;POST 建 kind/key/label/parent/sortOrder,key 形态与 parent 关系校验,撞唯一 409 人话)、`PUT/DELETE /api/insight/taxonomy/[id]`(PUT label/排序/启停/子域 parent,key 禁改;DELETE 在用守卫——被信号/簇引用 409 建议停用替代)、`POST /api/insight/trigger`(洞察日批手动触发)、`POST /api/insight/clusters/[id]/topic`(洞察→创作联动,§4)、`POST /api/insight/clusters/[id]/label`(单簇立即打标,M60 批C:先过 `labelReadiness` 前置门——未绑定 409/配额尽 429/成员不足 409/簇不存在 404,通过才入队 `insight.label` 带 clusterId)、`POST /api/insight/entities/merge`(实体手工归并,M60 批A:Zod `{fromKey,toKey}` 均须规范键形态,单事务迁移别名+回写 `insight_entity_event.entity_id`+源实体置 merged/`merged_into_id`;同键 400、成环 400、实体不存在或已同一实体 404) | admin **仅会话**(PAT 拒绝管理词表与洞察域) |
| topics | `GET/POST /api/topics`(列表分段 + `?output=article\|pin` 主意图过滤 + 新建,POST 收 `outputType`)、`GET/PATCH /api/topics/[id]`(详情含 items / 定位·贴图配置·关联文章·绑定技能·状态流转,流转矩阵 repo 层校验非法 409,collecting→drafted 仅产出落库驱动;M30 批② PATCH skillKey 存在性+启用核验,不存在/停用 400;M42 增 `pinPositioning` ≤1000 码点)、`GET /api/topics/[id]/studio-state`(M44 生成态轮询:裸 select `{status,updatedAt,linkedPostId}` + `listPinIdsByTopic`,零水合;创作中心在途生成 5s 轮询比对落库完成,完成信号按 kind 分——post updatedAt/linkedPostId,pin pinIds 集合)、`POST /api/topics/[id]/items`(挂载:telegram 视频须 aiStatus=done、文本须 visible 且有摘要(M42),post 须未软删,唯一键 409)、`PATCH/DELETE /api/topics/[id]/items/[itemId]`(批注·排序/卸载)、`POST /api/topics/[id]/compose`(M26 批④ 同步 LLM 起草专题文档:无素材 400/未绑 compose 模型 400 人话;重合成保护 409 needConfirm→`{confirm:true}` 覆盖;落 content_post 草稿 contentOrigin=ai_assisted 并锚定 composedAt,详情见 arch/02 §3.2 M26 注记;M42 起创作台产出走 agent 工具) | admin **仅会话**(PAT 拒绝管理创作域;mutation Origin 校验) |
| ai | `GET/POST /api/models`(模型台账,脱敏视图)、`PUT/DELETE /api/models/[id]`(Key write-only 留空=保留;被绑定引用删 409 先解绑)、`PUT /api/models/[id]/status`(启停)、`POST /api/models/[id]/test`(openai/anthropic 探针,结果落 last_test)、`GET/PUT /api/asr-config`(单例 get-or-create)、`POST /api/asr-config/test`(openai/minimax 正弦波实调)、`GET/PUT /api/model-bindings`(四角色主备;purposes 不匹配/主备相同 400,模型不存在 404;均 M8 批⑥)、`GET/POST /api/agent-skills` + `PUT/DELETE /api/agent-skills/[id]` + `PUT /api/agent-skills/[id]/status`(M30 批① Agent 技能 CRUD:key 格式/重名 400,更新侧不含 key——建后不可改;机制见 arch/04 §3 K2.8 补注五)、`POST /api/usage/purge`(手动清 90 天前 ai_usage_log,与 worker 日清同口径,M14 批⑦;模型/ASR 牌价经模型与 ASR 配置既有 PUT 携带 priceIn/priceOut/pricePerImage/pricePerHour)、`POST /api/card-presets/preview`(M36 模板库预览:preset+data → PNG 二进制只渲不落媒体库,失败 502 人话;§4.6 preset 体系) | admin **仅会话**(PAT 禁管 AI 服务配置) |
| distribute | `GET/PUT /api/distribute/wechat-config`(配置单例掩码视图/更新,secret 留空=保留)、`POST /api/distribute/wechat-config/test`(实调 `/cgi-bin/token` 探针落 last_test,40164 IP 白名单人话透出 errmsg 自带出口 IP)、`POST /api/distribute/wechat/sync`(单篇入队 202 `{jobId,token}`;未配置/旧文/缺封面/pending 400 人话前置)+ `GET …/sync/[jobId]?token=`(轮询终态)、`POST /api/distribute/wechat/batch`(多选批量入队,ids ≤30 去重;逐篇预检 skipped 随 202 携回人话,eligible 0 不产生 job)+ `GET …/batch/[jobId]?token=`(进度 processed/total/failedIds)、`POST /api/distribute/wechat/preview`(正文按主题预览纯渲染,返回 `{html,theme}`,theme=请求指定 > 行快照 > 渠道默认)、`POST /api/distribute/wechat/copy`(「复制公众号格式」入队 202,无码点门;M31 批④)+ `GET …/copy/[jobId]?token=`(轮询 `{ok,html,chars,coverReady,reason}`)、`POST /api/distribute/records/[id]/reset`(清 publish_channel.media_id 绑定——公众号侧草稿被人工删后重推回落 draft/add;无绑定 400,记录不存在 404;均 M17) | admin **仅会话**(PAT 禁管内容分发) |
| channel(公众号入站) | `GET/POST /api/wechat/mp`(微信服务器回调:GET 验签回显 echostr;POST 验签 → 兼容/安全模式 AES 解密 → XML 解析 → `MsgId` 幂等 → XML 回复;L0 直答 <100ms,其余 enqueue 后轮询 Redis ≤4.2s,超时回「继续」话术;出站 ≤1800 字节;M66)、`GET/PUT /api/wechat-mp-config`(单例脱敏视图/保存,EncodingAESKey 留空=保留;appid/appsecret 复用 `publish_wechat_config` 单源)、`POST /api/wechat-mp-config/test`(签名形态自检)、`GET /api/wechat-mp/sessions`、`GET /api/wechat-mp/sessions/[id]`(用户 + 消息时间线 + 线索)、`POST /api/wechat-mp/sessions/[id]/handoff`(线索置 handled,可附备注)、`POST/DELETE /api/wechat-mp/sessions/[id]/reply`(人工答复入队/撤销:无客服消息权限,只能等用户下次发言时被动回复带出一次,§4.10)、`GET/POST /api/wechat-mp/keywords` + `PUT/DELETE /api/wechat-mp/keywords/[id]`(关键词直连) | 回调**公开**(微信签名校验,无会话/无 Origin 要求);其余 admin **仅会话**(PAT 拒绝,mutation Origin 校验) |
| channel(站务通知) | `GET/PUT /api/feishu-alert-config`(单例脱敏视图/保存,secret 留空=保留)、`POST /api/feishu-alert-config/test`(发 interactive 卡片落 last_test;与 M29 免登飞书应用相互独立;M66) | admin **仅会话**(mutation Origin 校验) |
| account(公众号绑定) | `POST /api/account/wechat-mp/bind-code`(生成 8 位一次性绑定码,Redis TTL 10min)、`GET /api/account/wechat-mp/bind`(绑定状态脱敏视图)、`DELETE /api/account/wechat-mp/bind`(解绑;M66) | 登录会话 |
| site | `GET/PUT /api/site-config`(站点 kv 设置;PUT zod 校验,成功 `revalidatePath("/", "layout")` 使首页 ISR 立即再生;M10 批②,首键 `band.item_count` 1..50) | admin **仅会话**(PAT 禁管站点配置) |
| illustration(配图工坊) | `GET /api/illustration/studio/[id]`(版本+根→当前链+最新图层组)、`POST …/decompose`(手动拆层入队,processing 重复 409)、`POST …/edit`(三回路交互编辑,同步 ~15s 出候选)、`POST …/versions`(候选确认落版本链)、`PATCH /api/illustration/layers/[id]`(图层显隐;均 M40 批 B,§4.7) | admin **仅会话**(PAT 不能驱动编辑器;mutation Origin 校验) |
| pins(贴图) | `GET/POST /api/pins`(分页列表 status/q/topic 过滤;新建缺省「未命名贴图」)、`GET/PATCH/DELETE /api/pins/[id]`(详情含 images+channels;PATCH 字段组与 status 组独立解析任一命中,同 topics 口径;DELETE 级联删图与渠道行)、`POST/PUT/DELETE /api/pins/[id]/images`(工坊版本挂载 versionIds 或本地上传 mediaPath 快照 / 全量重排 / 移除单张)、`POST /api/pins/[id]/generate`(AI 生成入队,复用 generate_illustration 管线出图直挂序列;M42 增可选 `referencePath` 仅站内 uploads,§4.8)、`POST /api/pins/[id]/sync`(公众号 newspic 入队 202 `{jobId}`,资格前置 400 人话;均 M41,§4.8) | admin **仅会话**(PAT must not manage pins;mutation Origin 校验) |
| legacy | `GET /legacy/[...path]`(web 内部路由,非 REST) | - |
| system | `GET /api/health` | compose healthcheck |
| internal | `POST /api/internal/revalidate`(缓存失效;空 body = `revalidatePath("/","layout")` + SEO 路由,`scripts/warm-isr.mjs` 启动预热用;`{paths:[...]}` = 只失效白名单路径,当前仅 `/leaderboards/`,由 worker 在榜单采集/汇率日采成功后反调。token = `sha256(AUTH_SECRET + ":revalidate")` 走 `x-internal-token`,定长 `timingSafeEqual`;响应走 `apiEnvelope`;**白名单是红线,端点不得成为任意路径清除器**) | 内部 token(无会话) |

二期预留:`/api/pay/*`(虎皮椒:创建订单 + 异步 notify 回调,回调端点独立鉴权白名单 + 验签)、`/api/github/*`。

## 6. 日志与可观测

- pino 结构化 JSON;`instrumentation.ts` 注册 request id 中间件,响应头回写 `X-Request-Id`
- 慢请求(>500ms)warn 级;`/api/health` 供 compose healthcheck
- worker 日志带 `queue/jobId`;一期不接日志平台,`docker compose logs` 排障
- **批任务运行台账(2026-10-19 验收二批③,表结构见 [arch/03 §1 job_run](03-data-model.md))**:worker 分发器包装(`worker/job-run#withJobRunLog`)对白名单 14 个周期/手动批任务(洞察三件套/发现双件/备份/体检/支付日对账/清理四件/封面清扫/AI 补扫)统一落账——先落 `running` 行再执行(挂死立即停留可见),终态回写 summary/error/耗时;admin「数据中心→运行」新增**日志**(明细过滤分页)与**健康**(24h/7d 成功率、连败 ≥2 标红、running 超 1h 挂起疑似)两页签。tick 心跳(crawler/github/stats-flush/pay-sweep)与请求驱动单元任务不入账;台账 30 天保留(04:47 日清批顺带把 running 超 24h 崩溃残留代标 failed)
