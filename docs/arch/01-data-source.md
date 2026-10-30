# 数据源设计(渠道矩阵)

> 状态:**渠道矩阵定稿(2026-10-30)**。本文回答「数据从哪来、怎么接、落到哪」;
> 采集执行/调度/合规细则见 [02-data-collection.md](./02-data-collection.md),
> 落地模型见 [03-data-model.md](./03-data-model.md),AI 加工见 [04-ai-agent.md](./04-ai-agent.md)。
> 未接入渠道标注状态,接入时按本文契约落地,不另起管线。

## 1. 定位与边界

- 数据源的终点不是「入库」,而是**可计算的洞察**:信号 → 实体/事件/时序 → 簇 → 结论。
- **零付费**:只接免费公开渠道;不采购数据。
- **真机探先行**:任何渠道契约必须实弹验证后再写适配器(M25 教训:契约不可凭假设写桩)。
- **聚合不做画像**:评论/社区数据只做聚合统计,不做个人级追踪。
- **不做**:时政新闻自采(合规红线,见 02 §1);登录态强风控渠道按单独立项评估。

## 2. 渠道总表

列口径:
- **地域**:cn 国内 / global 海外(海外源需翻译入统一视图,见 §3.1)
- **介质**:money / time / voice / search / ai-record(五介质模型,见 insight-plan §2)
- **获取方式**:rss(RSS/Atom) / api(官方或公开 API) / web(静态网页) / headless(动态渲染,M56 通道) / social(网关 sidecar)
- **质量**:★★★★★ 一手结构化 → ★ 噪声大
- **状态**:现网 / 待接入 / 待探 / 不做

### 2.1 一手源与厂商动态

| 渠道 | 地域 | 介质 | 获取方式 | 质量 | 用途 | 状态 |
| --- | --- | --- | --- | --- | --- | --- |
| OpenAI / Anthropic / Google DeepMind / Meta / Mistral / xAI 官方 News/Blog | global | ai-record | rss/headless | ★★★★★ | 发布、能力变化 | 部分接入(OpenAI/Anthropic/Google AI) |
| DeepSeek / Qwen / 智谱 / Kimi / MiniMax / 字节 Seed 官方站 | cn | ai-record | web/headless | ★★★★★ | 发布、能力变化 | 部分接入(DeepSeek/Qwen/Kimi) |
| 量子位 | cn | ai-record | rss | ★★★★☆ | 资讯 | 现网 |
| 机器之心 | cn | ai-record | rss(token) | ★★★★☆ | 资讯 | 现网 |
| 36氪 / 虎嗅 / InfoQ 中文 / Solidot | cn | ai-record | rss | ★★★☆☆ | 资讯补充 | 待探 |
| TechCrunch / The Verge / VentureBeat / MIT-TR | global | ai-record | rss | ★★★☆☆ | 融资、产品新闻 | 待探 |
| Import AI / Latent Space / Simon Willison | global | ai-record | rss | ★★★★☆ | 趋势与观点 | 待接入 |

> 厂商动态的落点是**事件层**(`entity_event`),不是资讯流;抽取口径见 §3.3。
> 模型牌价(M55/M56)维持现状,不再深入跟进。

### 2.2 榜单与评测

| 渠道 | 地域 | 介质 | 获取方式 | 质量 | 用途 | 状态 |
| --- | --- | --- | --- | --- | --- | --- |
| LMArena | global | time/search | headless | ★★★★☆ | 模型排名 | 不做(2026-10-30 实测 Cloudflare 403,代理亦然) |
| Artificial Analysis | global | time | web(RSC 载荷) | ★★★★☆ | 智能指数/速度 | 现网(免 headless) |
| Hugging Face Hub | global | time/ai-record | api | ★★★★★ | 模型/数据集/Space 热度 | 现网(须经出口代理) |
| arXiv(cs.AI / cs.CL / cs.LG) | global | ai-record | api | ★★★★☆ | 论文热榜 | 现网(cs.AI/cs.CL) |
| GitHub Trending | global | time | web | ★★★★☆ | 开源项目热度 | 现网 |
| Papers with Code | global | ai-record | api(存续性待核实) | ★★★☆☆ | 论文+代码 | 待探 |
| npm / PyPI 下载量 | global | time | api | ★★★★☆ | 工具真实采用度 | 待探 |
| 百度热搜 / 知乎热榜 / B站热搜 | cn | search/voice | api/web | ★★★☆☆ | 热点 | 现网 |

> 榜单落点是 `leaderboard_snapshot` + 公开页,见 §3.2。转载排名前必须核对来源方 ToS/署名要求。

### 2.3 海外社区与媒体

| 渠道 | 地域 | 介质 | 获取方式 | 质量 | 用途 | 状态 |
| --- | --- | --- | --- | --- | --- | --- |
| Hacker News(含 Show HN) | global | voice/search | api(Algolia `search_by_date`,固定 `query=AI`) | ★★★★★ | 海外讨论、需求信号 | 现网(M58 批④) |
| Reddit(r/LocalLLaMA、r/OpenAI、r/ClaudeAI、r/MachineLearning) | global | voice | api/json + 代理 | ★★★★★ | 选型讨论、真实痛点 | 不做(经出口代理 403) |
| Product Hunt | global | ai-record | api(GraphQL token) | ★★★★☆ | 新品与需求 | 待接入 |
| Stack Overflow / Stack Exchange | global | voice/search | api | ★★★☆☆ | 技术痛点 | 待探 |
| YouTube | global | time | api(配额) | ★★★☆☆ | 视频趋势 | 待探 |
| X / Twitter | global | — | 无可行免费方案 | — | — | 不做 |

> **可达性纪律**:arch/02 §7 曾记录 Reddit 在 175 直连超时被墙;M33 批B 起已有
> `system_proxy_config` 家宽出口。海外源统一**复用该代理**(2026-10-30 决策),
> 接入前必须先真机重测,不得沿用旧结论。**重测结果(2026-10-30)**:Reddit 经该代理
> 仍 403(Cloudflare),未接入;Hacker News 直连可达。

### 2.4 国内需求/痛点语料

> 认知修正:**「要开发 XX 程序」类需求在国内公开互联网上极少以订单形式暴露**,
> 更多以「求推荐 / 求工具 / 吐槽现有工具」出现在社区。打法 = **抱怨挖掘 > 订单大厅**。

| 渠道 | 地域 | 介质 | 获取方式 | 质量 | 用途 | 状态 |
| --- | --- | --- | --- | --- | --- | --- |
| 知乎问题/回答 | cn | voice | web | ★★★★★ | 需求原话 | 不做(匿名 403/登录墙,无搜索路由) |
| V2EX | cn | voice | api(节点 `show.json`:openai/claude/deepseek/gemini) | ★★★★☆ | 开发者需求/吐槽 | 现网(M58 批④,经出口代理) |
| 百度下拉 / 相关搜索 | cn | search | web(公开 suggestion,GB18030 JSONP) | ★★★★☆ | 长尾真实需求 | 现网(M58 批④) |
| 第三方热门仓库 Issues/Discussions(Dify、LangChain、n8n、ComfyUI 等) | global/cn | voice | api | ★★★★☆ | 真实痛点、功能诉求 | 现网(M58 批④:两仓跑通,白名单后台可扩) |
| 应用商店评论(App Store / 应用宝) | cn/global | voice | rss/web | ★★★☆☆ | AI App 差评=痛点 | 待探 |
| 掘金 / SegmentFault / OSChina | cn | voice | web/非公开 api | ★★★☆☆ | 技术痛点 | 待探 |
| 豆瓣小组 / 贴吧 | cn | voice | web(部分需登录) | ★★★☆☆ | 非技术用户需求 | 待探 |
| BOSS直聘 / 拉勾 JD | cn | search/time | web(反爬强) | ★★★☆☆ | 技能需求 | 待探 |
| 外包平台(程序员客栈/猿急送/开源众包/云沃客/解放号) | cn | money | web/登录 | ★★★☆☆ | 需求订单 | 待探(量小) |
| 脉脉 | cn | voice | app-only/登录 | ★★☆☆☆ | 职场吐槽 | 不做 |
| 猪八戒 / 闲鱼 / 小红书 / 抖音评论 | cn | — | — | — | — | 搁置 |

> 第三方仓库 Issues 指**外部热门项目**,不是本站自有仓库(自有仓库无数据量)。

> **社区语料通道(M58 批④)**:`crawl_source(type=community, config.communityKey)` 路由
> `src/lib/insight/community/` 注册表,复用统一调度/健康度/限频/快照;入池前过 L0 确定性准入
> (过短/纯符号/营销导流/批内重复),各源日预算见 `COMMUNITY_DAILY_CAPS`。OSS 仓库白名单存
> `config.repos`(后台可改,零发版);详见 plan §7 落码注。

### 2.5 站内存量

| 渠道 | 地域 | 介质 | 状态 | 说明 |
| --- | --- | --- | --- | --- |
| 文章评论 | cn | voice | 现网 | 痛点池现役主进水口 |
| 电报 AI 解读 | cn | ai-record | 现网 | 视频/文字解读产物 |
| 站内 agent 问句 | cn | search | 现网(M58 批⑤) | 上下文黑名单清洗后复活,含游客首问,见 §3.4 |
| 站内搜索词 | cn | search | 搁置 | 当前量太少 |

## 3. 跨切面能力

### 3.1 海外信息中文化(统一视图的前提)

- **字段口径**:`insight_signal` 增 `lang`(zh/en/…)与 `region`(cn/global);
  原文保留在 `rawText`,中文译文落 `translatedText`,翻译态落 `translation_status`。
- **状态机**(`none | pending | done | failed`):中文源 `none`;非中文源 ingest 即
  `pending` 且**不进 embedding**(`findUnembeddedSignals` 过滤);翻译成 `done` 时译文
  顶替 `normalizedText`、`embedding` 置空由下一轮自然重嵌(幂等不重复计费);失败
  `failed` 保留原文照常 embedding(翻译是增强,不阻塞采集);`pending` 超 24h
  自动降级 `failed`,防角色未绑定/队列积压永久卡池。
- **聚类口径**:中文译文进 `normalizedText` 与 embedding,保证跨语言同簇;
  `rawText` 只用于展示与溯源。
- **展示口径**:默认中文,可切换原文;国内/海外筛选;**统一视图**与地域视图并存。
- **翻译角色**:新增独立任务角色 `translate`(2026-10-30 决策),绑定低成本模型,
  与 `insight` 归纳角色解耦,便于单独控预算;只翻非中文,按 `sha1(rawText)` 缓存 7 天,
  单条 ≤1 次成功调用(失败重试 ≤2),用量按 role 记账;ingest 单条入队 +
  每 10 分钟扫尾捞漏(补翻 + 超时降级双保险)。
- **簇的地域**:`cluster.region` 取成员多数派(`cn`/`global`,差距 <20% 记 `mixed`);
  读侧支持按成员地域过滤。

### 3.2 榜单呈现(公开页)

- **数据模型**:`leaderboard_snapshot`(source、board、rank、entityType、entityName、
  vendor、score、scoreUnit、meta、capturedDate),唯一键 `(source, board, entityKey,
  capturedDate)`;`meta.url` 存条目外链,`capturedDate` 为北京日界(存 `@db.Date` UTC 零点)。
- **采集**:`crawl_source.type=leaderboard`,`config.boardKey` 路由
  `src/lib/leaderboard/registry.ts`(一源一榜,解析器纯函数配 golden 单测);渠道行由
  worker 启动幂等种子(`leaderboard:<key>`),URL/启停/周期(默认 1440 分钟)后台可调。
  每轮按分值倒序(名次榜无分值保原序)截断 ≤20 条,同日重跑整表覆盖(先 upsert 本轮、
  再删同日掉榜行);解析 0 条按源失败计,不写空数据,原文经 `CrawlSnapshot` 归档。
  取数形态(2026-10-30 真机):AA 静态 HTML 内嵌 RSC 载荷(**免 headless**)、HF 公开
  JSON API(**须经 `system_proxy_config` 出口代理**,undici 显式 dispatcher)、arXiv
  Atom 与 GitHub Trending 直连;LMArena Cloudflare 403(代理亦然)本批不做。
- **页面**:公开页 `/leaderboards/`,ISR 3600s,全量榜单 SSR 直出进 HTML;榜单切换走
  页内锚点(不读 `searchParams`,保 ISR);行含名次、变动(↑↓/NEW)、实体、厂商、分数、
  来源;顶部「数据截至」,超过 2 天出降级横幅。移动端表格转卡片;空榜出空态。
- **名次变动**:不落库,读时与「上一可用日期」相减(正=上升);同日重跑不产生伪变动。
- **入口**:站内**专题区** `SITE_TOPICS` 增「模型榜单」(2026-10-30 决策),导航与
  `/topics/` 索引自动同步。
- **联动**:名次异动 → 事件 → 簇(如「某模型登顶」自动进热点池)。**未做**:批③ 只落
  榜单快照,异动事件待后续批。
- **SEO**:榜单页为常青内容,可收录(`ItemList` JSON-LD);转载前须核对来源方 ToS/署名要求。

### 3.3 事件层(厂商动态与榜单异动的落点)

- **数据模型**:`entity_event`(source、vendor、entityType、entityKey、eventType、
  title、summary、url、occurredAt、dedupeKey、meta),`eventType ∈ {release,
  price_change, open_source, funding, deprecation, benchmark_change}`。
  幂等锚 `dedupeKey = sha1(source | canonical url | eventType | entityKey)`——
  在「URL+类型」之上加实体,同文多实体齐发布时不互相吞并。
- **采集**:厂商官方发布走统一采集体系——`crawl_source.type=vendor`,
  `config.vendorKey` 路由 `src/lib/insight/vendor/registry.ts`(取数形态
  rss/html/sitemap 按厂商注册,改解析才发版);URL/启停/周期默认半日在
  数据中心·源管理·采集渠道零发版可调;原文经 `CrawlSnapshot` 归档。
  单轮按发布日倒序取最新 ≤20 条(feed 升序/列表无日期都归一后截断)。
  首批六家:OpenAI / Anthropic / Google AI / DeepSeek / Qwen / Kimi
  (2026-10-30 实探:DeepMind 无独立可达 RSS,取 Google 官方 AI 分类 feed,
  vendor 记 Google)。
- **抽取**:列表条目 → BullMQ `extract-event` 单篇任务 → LLM 结构化抽取
  (role=insight);单篇最多 3 个事件,`occurredAt` 早于 2000 年或晚于今天+1 天
  丢弃;同一 URL 只抽一次(Redis 已处理标记,失败即释放下轮重试)。
  抽取失败不回写采集源健康度(抓取成功即健康),失败日志带 URL 供补跑。
- **入池**:抽取出的事件同时按 `dedupeKey` 作 refId 入洞察信号池
  (`source=vendor-<key>`,medium=ai-record),事件能进热点簇。
- **用途**:后台事件台账(`/admin/insight/events`,按厂商/类型/时间筛选)、
  簇的事件轴、后续 MCP 的 `list_events` 工具。
- **实体视图**(M60 定制,替换 M59 的按 `entityKey` 平铺):后台
  `/admin/insight/entities/` 按实体注册表聚合事件,展示 **厂商 → 产品线 → 实体** 三层
  (厂商分区 + 产品线折叠组;厂商/实体类型/时间窗/关键词筛选 + 分页),详情
  `/admin/insight/entities/<key>/` 出事件时间线与经 `insight_signal.meta.entityKey`
  关联的厂商信号,并列出该实体全部别名与子实体。聚合**只基于 `entity_event`**,
  不 join `leaderboard_snapshot`(榜单 entityKey 口径不同:HF 保留大小写与 `/`、
  arXiv 保留版本后缀);社区/热榜信号未挂实体,详情页明确说明。
- **实体解析**(`src/lib/insight/entities/resolve.ts`,抽取后同步落 `entity_event.entity_id`):
  1. 规范键 —— LLM 自由生成的 `entityKey` 先 trim/lower/空格转连字符,`/` 分段各自去首尾
     连字符(展示与 URL 用,如 `qwen2.5-vl`);另算**匹配键**把分隔符归一(`.`/`_`/
     重复 `-` 全折叠成单 `-`,`gpt-6.1-terra` 与 `gpt-6-1-terra` 同锚),唯一去重在该键上;
  2. 别名精确命中 → 直接归位(别名表 `insight_entity_alias`,唯一键 `alias_key`);
  3. 规范键命中 → 补一条别名;
  4. 前缀推断父级 —— 同厂商下 `-` 边界最长前缀命中即产品线(`qwen3-embedding` →
     `qwen3`、`qwen-image-edit` → `qwen-image`),否则挂厂商 org 实体
     (`VENDOR_DEFS.vendorName` 作展示名);实体 get-or-create 于单事务,唯一冲突回读
     保证并发安全。
  `entity_key` 原样保留(溯源 + `dedupe_key` 唯一锚不动,归并不改写历史键);解析失败
  只记 warn、事件照常入库(降级不阻断)。存量经
  `npm run insight:entity-backfill`(`scripts/ops/insight-entity-backfill.ts`,幂等)按
  `occurred_at` 顺序回填。
- **手工归并**:`POST /api/insight/entities/merge`(admin 会话,PAT 拒绝,Zod
  `{ fromKey, toKey }`)单事务迁移别名、回写 `entity_event.entity_id`、源实体置
  `status=merged` + `merged_into_id`;旧路径仍可解析到归并目标,不 404。
- 与牌价跟踪解耦:牌价停更不影响事件层。

### 3.4 站内 agent 问句清洗(复活规则)

确定性过滤,不靠模型判断——**只按页面上下文排除**(M58 批⑤ 定稿):

1. 后台功能页集合 {`后台`,`文章新建`,`文章编辑`,`文章管理`,`创作中心`}
   (即 `buildAgentPageContext` 的派生名,`src/lib/agent/run-context.ts#ADMIN_SURFACES`)
   发起的会话不入池;
2. 公开页(首页/搜索/文章页/Footer 咨询/答案卡追问)一律保留,**与身份无关**——
   管理员在公开页提问同样是真实需求;后台页即便普通用户也无信号价值;
3. 入库 `meta.surface` 记录上下文标签(无上下文时不写该字段),便于后续调规则。

接线:登录用户/管理员在 `backfillSessionTitle` 命中首问(标题由空转有)时入池
(refId=sessionId);游客 run 收尾用 Redis `SET NX`
`search:agent:ask-recorded:<threadId>`(TTL 6h)判首问,refId=`g:<threadId>`,
**不存 visitorId**(只留线程 id,不做个人关联);Redis 不可用宁可漏记不误记。
`(source, refId)` 唯一键天然兜住键过期后的重记。
(游客会话行落档见 §3.5:行只存 `visitor_id='guest'`,与入池口径一致,同样不含访客标识。)

存量清理:本批开工时查库,dev 存量 33 条中 31 条指向 `admin:` 归属会话,
按 session 归属一次性清理(`scripts/oneoff/internal-agent-admin-purge/`,
执行后删除);非 admin 会话的问句保留。

> 相比初版「排除 admin 身份前缀 + 仅保留三类入口」,改为上下文黑名单:
> 规则等价、对新增公开页自动放行;身份不再是判据,游客问句也不再是盲区。

### 3.5 游客会话留档(M58 批⑤ 后续)

游客会话原先只在 Redis 留归属键(2h),后台「会话管理」看不到内容(仅台账统计)。
现改为 **run 收尾落匿名会话行**:同一张 `search_agent_session`,id=`g_<uuid>`,
`visitor_id='guest'`(字面量,不存访客 cookie),标题取首问前 20 码点,tokens 累计、
`last_message_at` touch;入口 `touchGuestSessionAfterRun`(失败只告警不反噬 run)。

- **归属键与内容解耦**:Redis 归属键仍决定「能否继续追问」(2h 滑动);行与 checkpoint
  内容按 30 天留档(与成员同口径日清),归属键消失不影响后台可读性;
- **清退**:会话行 `purgeAgentSessions` 30 天行+checkpoint 同删;按「归属键消失」
  清扫 checkpoint 的旧规则只作用于**无留档行**的历史线程;
- **依赖**:无 schema 变更(复用 `search_agent_session` 与 `ai_usage_log.session_id`)。

### 3.6 覆盖矩阵与打标展示收敛(M60)

- **矩阵维度 = 渠道族,不是单源**(`src/lib/insight/source-registry.ts`)。
  `family ∈ {internal 站内行为, hotlist 热榜资讯, vendor 厂商官方,
  community 社区语料, news 新闻媒体*, forum 垂直论坛*}`
  (*为后续新域预留,当前无在役源):接入新源只增加族内成员,矩阵列数恒等于
  在役族数,不随渠道扩张横向爆炸。后台 `/admin/insight/` 每行 = 一个成熟簇
  (已打标 + 成员 ≥`MATRIX_MIN_MEMBERS`):族分段占比条(结构) + 族级结论 +
  定宽 nowrap 行动按钮;逐源计数收进行内 `<details>` 展开,不再占列。
- **族级判定**(`src/lib/insight/coverage.ts`,停滞族不参与——14 天无新信号的源
  保留 M52 语义):`内容空白` = 热簇外部族有信号、站内族为 0;`自有特色` = 痛簇
  站内族 ≥`SIGNATURE_MIN_INTERNAL`(3) 且外部族为 0;`覆盖良好` = 全部非停滞族
  都有信号;其余 `部分覆盖`。
- **打标展示收敛**:只有成员 ≥`LABEL_MIN_MEMBERS`(3) 的活跃簇进榜单/趋势/矩阵
  ——1–2 条信号的新簇曾挤占榜位、满屏「待打标」;它们由各榜底部「另有 N 个新簇
  累计中」一行交代,累计到门槛后自动进队列(每 30 分钟小批,日批 03:57 兜底,
  见 arch/05 §4 的 `insight.label`)。总览头部「打标覆盖 已打标/可打标(N 待打标)」
  与榜单同口径。

## 4. 接入契约

- **统一入口**:一律走 `crawl_source`(type = rss / api / web / social-video /
  pricing / vendor / leaderboard),新渠道优先 rss/api,动态页走 headless(M56);不为单个渠道另建管线。
  注:`pricing / vendor / leaderboard` 由系统注册表登记(worker 启动种子),后台不许手工新建或改类型。
- **运行态**:启停、URL、频控(`crawl_interval_min` / `daily_max_requests`)、
  凭证(`config`,后台维护、展示脱敏、日志禁打)均后台可调,零发版。
- **快照**:每次采集由 `CrawlSnapshot` 归档原文(改版/失配的一手证据),保留最近 N 份。
- **质量门**:解析器配 golden 单测;单源失败只影响自身健康度,不阻塞其他源。
- **合规**:遵守 robots.txt 与 UA 规范;社区/评论只做聚合,不做个人画像;
  对外数据服务前另行合规评审。

## 5. 待探清单(接入前必须先验证)

1. Reddit 经 `system_proxy_config` 的实际可达性与限频。
2. LMArena / Artificial Analysis 已探(2026-10-30):AA 静态载荷可直取(免 headless);
   LMArena Cloudflare 人机校验 403(经系统代理亦然),headless 成本与转载授权待独立评估。
3. 知乎已探(2026-10-30):问题页/搜索匿名 403,全文需登录态 cookie,RSSHub 自建亦需
   `ZHIHU_COOKIES` 且无搜索路由 → 不做;掘金、豆瓣的公开可达性与登录态要求待探。
4. 百度下拉接口的稳定性与返回编码。
5. 应用商店评论接口的存续性。
6. 厂商官方站的 RSS 覆盖情况(已探 2026-10-30):OpenAI / Google AI / Qwen 有
   官方 RSS;Anthropic / Kimi 列表页服务端渲染,静态 HTML 可解析(未启 headless);
   DeepSeek 走 sitemap(日期编码在 slug,标题由抽取阶段抓正文补齐)。
   已探边界:Anthropic 列表页服务端只渲染 6 张卡(最新),模型发布页在顶级 slug
   而非 `/news/`;Qwen 官方 feed 末条 2025-09(已停更,保留待恢复)。新厂商接入前
   仍逐个实探,不凭假设。

## 6. 决策记录

| 日期 | 决策 |
| --- | --- |
| 2026-10-30 | 榜单页公开;入口挂在站内专题区 |
| 2026-10-30 | 榜单公开页 ISR 3600s + 页内锚点切换(不读 query);每源每日前 20 名,名次差读时与上一可用日期计算 |
| 2026-10-30 | 榜单首批四源上线(AA/HF/arXiv×2/GitHub Trending);LMArena CF 403 本批不做;HF 须经出口代理 |
| 2026-10-30 | 海外源统一复用 `system_proxy_config`,接入前重测可达性 |
| 2026-10-30 | 翻译使用独立任务角色 `translate`,绑定低成本模型 |
| 2026-10-30 | 站内搜索词搁置;agent 问句清洗后复活 |
| 2026-10-30 | 小红书/抖音评论/猪八戒/闲鱼搁置;模型牌价不再深入跟进 |
| 2026-10-30 | 知乎问题/回答不做(实探:匿名 403/登录墙,RSSHub 无搜索路由);热榜维持现网 |
| 2026-10-30 | MCP 延后;方向为多租户自助 API Key(scope + 限流 + 计量) |
