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
| LMArena | global | time/search | headless | ★★★★☆ | 模型排名 | 待接入 |
| Artificial Analysis | global | time | web/api(待核实) | ★★★★☆ | 智能指数/速度 | 待接入 |
| Hugging Face Hub | global | time/ai-record | api | ★★★★★ | 模型/数据集/Space 热度 | 待接入 |
| arXiv(cs.AI / cs.CL / cs.LG) | global | ai-record | api | ★★★★☆ | 论文热榜 | 待接入 |
| GitHub Trending | global | time | web/第三方 | ★★★★☆ | 开源项目热度 | 待接入 |
| Papers with Code | global | ai-record | api(存续性待核实) | ★★★☆☆ | 论文+代码 | 待探 |
| npm / PyPI 下载量 | global | time | api | ★★★★☆ | 工具真实采用度 | 待探 |
| 百度热搜 / 知乎热榜 / B站热搜 | cn | search/voice | api/web | ★★★☆☆ | 热点 | 现网 |

> 榜单落点是 `leaderboard_snapshot` + 公开页,见 §3.2。转载排名前必须核对来源方 ToS/署名要求。

### 2.3 海外社区与媒体

| 渠道 | 地域 | 介质 | 获取方式 | 质量 | 用途 | 状态 |
| --- | --- | --- | --- | --- | --- | --- |
| Hacker News(含 Show HN) | global | voice/search | api(Algolia)/rss(hnrss) | ★★★★★ | 海外讨论、需求信号 | 待接入 |
| Reddit(r/LocalLLaMA、r/OpenAI、r/ClaudeAI、r/MachineLearning) | global | voice | api/json + 代理 | ★★★★★ | 选型讨论、真实痛点 | 待探(可达性重测) |
| Product Hunt | global | ai-record | api(GraphQL token) | ★★★★☆ | 新品与需求 | 待接入 |
| Stack Overflow / Stack Exchange | global | voice/search | api | ★★★☆☆ | 技术痛点 | 待探 |
| YouTube | global | time | api(配额) | ★★★☆☆ | 视频趋势 | 待探 |
| X / Twitter | global | — | 无可行免费方案 | — | — | 不做 |

> **可达性纪律**:arch/02 §7 曾记录 Reddit 在 175 直连超时被墙;M33 批B 起已有
> `system_proxy_config` 家宽出口。海外源统一**复用该代理**(2026-10-30 决策),
> 接入前必须先真机重测,不得沿用旧结论。

### 2.4 国内需求/痛点语料

> 认知修正:**「要开发 XX 程序」类需求在国内公开互联网上极少以订单形式暴露**,
> 更多以「求推荐 / 求工具 / 吐槽现有工具」出现在社区。打法 = **抱怨挖掘 > 订单大厅**。

| 渠道 | 地域 | 介质 | 获取方式 | 质量 | 用途 | 状态 |
| --- | --- | --- | --- | --- | --- | --- |
| 知乎问题/回答 | cn | voice | web | ★★★★★ | 需求原话 | 不做(匿名 403/登录墙,无搜索路由) |
| V2EX | cn | voice | api(公开 JSON) | ★★★★☆ | 开发者需求/吐槽 | 待接入 |
| 百度下拉 / 相关搜索 | cn | search | web(公开 suggestion) | ★★★★☆ | 长尾真实需求 | 待接入 |
| 第三方热门仓库 Issues/Discussions(Dify、LangChain、n8n、ComfyUI 等) | global/cn | voice | api | ★★★★☆ | 真实痛点、功能诉求 | 待接入 |
| 应用商店评论(App Store / 应用宝) | cn/global | voice | rss/web | ★★★☆☆ | AI App 差评=痛点 | 待探 |
| 掘金 / SegmentFault / OSChina | cn | voice | web/非公开 api | ★★★☆☆ | 技术痛点 | 待探 |
| 豆瓣小组 / 贴吧 | cn | voice | web(部分需登录) | ★★★☆☆ | 非技术用户需求 | 待探 |
| BOSS直聘 / 拉勾 JD | cn | search/time | web(反爬强) | ★★★☆☆ | 技能需求 | 待探 |
| 外包平台(程序员客栈/猿急送/开源众包/云沃客/解放号) | cn | money | web/登录 | ★★★☆☆ | 需求订单 | 待探(量小) |
| 脉脉 | cn | voice | app-only/登录 | ★★☆☆☆ | 职场吐槽 | 不做 |
| 猪八戒 / 闲鱼 / 小红书 / 抖音评论 | cn | — | — | — | — | 搁置 |

> 第三方仓库 Issues 指**外部热门项目**,不是本站自有仓库(自有仓库无数据量)。

### 2.5 站内存量

| 渠道 | 地域 | 介质 | 状态 | 说明 |
| --- | --- | --- | --- | --- |
| 文章评论 | cn | voice | 现网 | 痛点池现役主进水口 |
| 电报 AI 解读 | cn | ai-record | 现网 | 视频/文字解读产物 |
| 站内 agent 问句 | cn | search | 待接入(需清洗) | 剔除站内功能触发会话,见 §3.4 |
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
  vendor、score、scoreUnit、meta、date),唯一键 `(source, board, entity, date)`。
- **页面**:公开页 `/leaderboards/`,ISR 日更;支持榜单切换、名次变动(↑↓/新)、
  厂商 chip、数据截稿时间与来源署名。
- **入口**:在站内**专题区**添加入口(2026-10-30 决策),与导航并列。
- **联动**:名次异动 → 事件 → 簇(如「某模型登顶」自动进热点池)。
- **SEO**:榜单页为常青内容,可收录;但转载前须核对来源方 ToS/署名要求。

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
- 与牌价跟踪解耦:牌价停更不影响事件层。

### 3.4 站内 agent 问句清洗(复活规则)

确定性过滤,不靠模型判断:

1. 排除 `admin:` 身份前缀的会话(`SearchAgentSession.visitorId`);
2. 排除页面上下文 pathname 以 `/admin` 开头的 run;
3. 排除含 `compose_topic_draft` / `save_topic_draft` / `render_card` / `propose_edits`
   等站内功能工具调用的会话;
4. 仅保留 `/search` 页、答案卡追问、Footer 咨询三类入口发起的会话;
5. 入库 `meta.surface` 记录入口,便于后续调规则。

## 4. 接入契约

- **统一入口**:一律走 `crawl_source`(type = rss / api / web / social-video /
  pricing / vendor),新渠道优先 rss/api,动态页走 headless(M56);不为单个渠道另建管线。
- **运行态**:启停、URL、频控(`crawl_interval_min` / `daily_max_requests`)、
  凭证(`config`,后台维护、展示脱敏、日志禁打)均后台可调,零发版。
- **快照**:每次采集由 `CrawlSnapshot` 归档原文(改版/失配的一手证据),保留最近 N 份。
- **质量门**:解析器配 golden 单测;单源失败只影响自身健康度,不阻塞其他源。
- **合规**:遵守 robots.txt 与 UA 规范;社区/评论只做聚合,不做个人画像;
  对外数据服务前另行合规评审。

## 5. 待探清单(接入前必须先验证)

1. Reddit 经 `system_proxy_config` 的实际可达性与限频。
2. LMArena / Artificial Analysis 的页面结构、动态渲染成本与转载授权。
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
| 2026-10-30 | 海外源统一复用 `system_proxy_config`,接入前重测可达性 |
| 2026-10-30 | 翻译使用独立任务角色 `translate`,绑定低成本模型 |
| 2026-10-30 | 站内搜索词搁置;agent 问句清洗后复活 |
| 2026-10-30 | 小红书/抖音评论/猪八戒/闲鱼搁置;模型牌价不再深入跟进 |
| 2026-10-30 | 知乎问题/回答不做(实探:匿名 403/登录墙,RSSHub 无搜索路由);热榜维持现网 |
| 2026-10-30 | MCP 延后;方向为多租户自助 API Key(scope + 限流 + 计量) |
