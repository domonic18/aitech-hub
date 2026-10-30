# 数据面扩展与洞察 v2 实现方案(M58 立项稿)

> 需求源:2026-10-30 讨论定稿;渠道矩阵见 [arch/01-data-source](../arch/01-data-source.md),
> 采集纪律见 [arch/02](../arch/02-data-collection.md),洞察基线见 [insight-plan](insight-plan.md)。
> 本文回答「这一轮补哪些数据、怎么接、落在哪、怎么验收」;终态实现细节完成后回写 arch 对应章节。
> **编号 M58**(M57 之后首个立项);未开工前不建分支,开工时按批建 `feature/m58-*`。
> **进度(2026-10-30)**:批① 多语言/地域基座已落码(`feature/m58-multilingual-base`,
> schema+迁移/translate 角色/状态机/地域视图);批② 厂商动态与事件层已落码
> (`entity_event` 迁移/六厂商注册表/`vendor` 采集类型/`extract-event` 抽取队列/
> 后台事件页签);批③ 榜单接入与公开页已落码(`leaderboard_snapshot` 迁移/五榜注册表
> (LMArena 因 CF 403 不做)/`leaderboard` 采集类型/`/leaderboards/` 公开页);④–⑤ 待开。

## 1. 立项依据与目标

现有洞察只覆盖「国内热榜 + 站内评论 + 电报解读」三类信号,三个缺口:

1. **维度窄**:缺一手厂商动态、缺海外讨论、缺榜单时序,结论停留在「话题层」,没有实体与事件。
2. **海外不可读**:英文信号即使采到也进不了统一视图(聚类/展示都是中文口径)。
3. **站内问句浪费**:最有价值的真实需求信号(`internal-agent`)因混入后台写作会话被整体关闭。

本里程碑目标:补齐「**多语言多地域信号 → 实体事件 → 榜单时序 → 统一洞察视图**」的最小闭环,
并让站内问句在清洗后重新进水。**不做**:

- MCP 对外服务(多租户 API Key,延后独立立项;不复活已否决的 K3);
- 洞察效果回写(层 D,低优先级);
- 小红书 / 抖音评论 / 猪八戒 / 闲鱼(搁置);模型牌价深挖(M55/M56 维持现状);
- 站内搜索词(量太小,搁置)。

## 2. 范围与分批

| 批 | 内容 | 出口 | 依赖 |
| --- | --- | --- | --- |
| ① | 多语言与地域基座 | `insight_signal` 地域/语言/译文 + `translate` 角色 + 分地域视图 | — |
| ② | 厂商动态与事件层 | `entity_event` + 6 家厂商源 + 后台事件页签 | ① |
| ③ | 榜单接入与公开页 | `leaderboard_snapshot` + `/leaderboards/` + 专题入口 | ① |
| ④ | 社区需求语料 | HN / V2EX / 百度下拉 / 外部 OSS Issues 入池 | ① |
| ⑤ | 问句清洗复活 + 收口 | 站内 agent 问句(含游客)进水 + 全量验收 | ① |

②③④ 相互独立可并行;① 是公共前提(地域/语言字段);⑤ 只依赖 ① 的字段口径,可随时插入。

## 3. 数据模型变更

四个迁移,forward-only;先 `--create-only` 评审 SQL,再从零重放验证。

```prisma
// 迁移 1:信号多语言与地域
model InsightSignal {
  lang              String?   // zh | en | ja …(源级声明,混合源逐条覆盖)
  region            String?   // cn | global
  translatedText    String?   // 中文译文;原文始终在 rawText
  translationStatus String   @default("none") // none | pending | done | failed
  @@index([region, signalAt])
}

model InsightCluster {
  region String? // 成员多数派;cn | global | mixed
}

// 迁移 2:榜单时序
model LeaderboardSnapshot {
  id           BigInt   @id @default(autoincrement())
  source       String
  board        String
  entityKey    String
  entityName   String
  entityType   String   // model | paper | repo | org
  vendor       String?
  rank         Int
  score        Float?
  scoreUnit    String?
  capturedDate DateTime @db.Date
  meta         Json?
  createdAt    DateTime @default(now())
  @@unique([source, board, entityKey, capturedDate])
  @@index([source, board, capturedDate])
}

// 迁移 3:事件层
model EntityEvent {
  id         BigInt   @id @default(autoincrement())
  source     String
  vendor     String
  entityType String   // model | product | org
  entityKey  String
  eventType  String   // release | price_change | open_source | funding | deprecation | benchmark_change
  title      String
  summary    String?
  url        String
  occurredAt DateTime
  dedupeKey  String   @unique // sha1(source | canonical url | eventType | entityKey)
  meta       Json?
  createdAt  DateTime @default(now())
  @@index([vendor, occurredAt])
  @@index([eventType, occurredAt])
}
```

`translate` 角色不需要 schema 变更(`AiTaskBinding` 按 role 字符串绑定),但要进
`AI_MODEL_PURPOSES` / resolver / 后台绑定槽 / 用量统计,`AiUsageLog.role=translate`。

## 4. 批① 多语言与地域基座

### 4.1 信号入库口径

- `SOURCE_REGISTRY` 每项增 `lang` / `region`(如 HN=global/en、V2EX=cn/zh),`ingestInsightSignal`
  从注册表取默认值,`InsightSignalInput` 允许逐条覆盖(混合源用)。
- 中文源:`translationStatus=none`,`normalizedText` 照旧。
- 非中文源:`translationStatus=pending`,**暂不进 embedding**;翻译完成后
  `translatedText` + `normalizedText=译文`,`embedding=null`,再入 embedding 队列。
- 翻译失败:保留原文,`translationStatus=failed`,`normalizedText=原文截断`,照常 embedding。
- **防呆**:`pending` 超过 24h(角色未绑定/队列积压)自动降级 `failed`,避免永久卡池。

### 4.2 翻译任务

- 队列:复用 `QUEUE_INSIGHT`,新增 `INSIGHT_JOB_TRANSLATE`;ingest 后按 signalId 入队,
  另有 10min 扫尾任务补 `pending`(入队丢失兜底)。
- 模型:新角色 `translate`,只翻非中文;输入截断 2000 字(与 `normalizedText` 同口径),
  输出截断 2000;专有名词/模型名不译。
- 缓存:Redis `sha1(rawText) → 译文`,7 天;跨源同文复用,控成本。
- 预算:单条 ≤1 次调用;失败重试 ≤2;用量按 role 记账,后台可见。

### 4.3 聚类与展示

- `findUnembeddedSignals` 增加 `translationStatus in (none, done, failed)`;`done` 行因
  embedding 被清空自然重嵌,不会重复计费。
- 聚类仍用 `normalizedText`(中文),跨语言同簇;`cluster.region` 打标时取成员多数派,
  cn/global 差距 <20% 记 `mixed`。
- `/admin/insight`:地域筛选(全部/国内/海外)+ 信号详情「原文/译文」切换;簇卡带地域徽章。
- 读侧默认中文;原文只作溯源,不进搜索索引。

### 4.4 验收

- 至少 1 组「英文源 + 中文源」同簇实证(人工抽样)。
- 未绑定 `translate` 时:24h 内降级为 `failed` 并正常聚类,不阻塞采集。
- 状态机单测:非法迁移被拒,`done` 重嵌幂等。
- 迁移从零重放通过;`make check` 绿。

## 5. 批② 厂商动态与事件层

### 5.1 接入

- 新 `crawl_source.type="vendor"`,复用统一调度/健康度/`CrawlSnapshot`/限频;
  `config.vendorKey` 路由到 `src/lib/insight/vendor/registry.ts`。
- 首批 6 家(有官方 RSS 的优先):OpenAI、Anthropic、Google DeepMind、DeepSeek、Qwen、Kimi。
  实测(2026-10-30)未启 headless:DeepMind 无独立可达 RSS → 取 Google 官方 AI 分类 feed;
  Anthropic / Kimi 服务端渲染列表页可直接静态解析;DeepSeek 走 sitemap。
  其余厂商(智谱/MiniMax/字节 Seed/xAI/Mistral/Meta)第二批补。
- 频率:每日 1–2 次(默认 720 分钟);单轮按发布日倒序取最新 ≤20 条;
  已处理去重 = Redis 标记 `sha1(url)`(30 天)+ 事件级 `dedupeKey` 唯一索引。

### 5.2 事件抽取

- 抓取条目 → 入 `INSIGHT_JOB_EXTRACT_EVENT`(单篇一条,队列并发 1;失败隔离粒度最细)
  → `insight` 角色结构化抽取 → Zod 校验 → `entity_event` upsert(`dedupeKey` 幂等)。
- 抽取契约:`{events:[{entityType, entityKey, eventType, title, summary, occurredAt}]}`
  (vendor 由 `config.vendorKey` 回查注册表,不进 LLM 输出);
  单文最多 3 个事件;无事件则跳过并计数;`occurredAt` 早于 2000 年或晚于今天+1 天视为脏数据丢弃。
- 抽取出的事件同时作为 `ai-record` 信号进水(`source=vendor-<key>`,refId=dedupeKey),
  保证厂商发布能进热点簇;**同一 URL 只入一次**。
- 失败隔离:抽取失败不回写 `crawl_source` 健康度(抓取成功即健康),日志带 URL 供补跑。

### 5.3 后台

- `/admin/insight` 增「事件」页签:按厂商/类型/时间筛选,标题外链原文,展示抽取摘要。
- 采集渠道台账自动出现 vendor 源(复用现有页,零新增)。

### 5.4 验收

- ≥6 家厂商源连续 3 天健康;`crawl_snapshot` 可回溯。
- 同一快照重跑两次,事件数不增(幂等)。
- 人工抽检 30 条:事件类型/实体正确率 ≥90%,每条带可访问 URL。
- 抽取失败不会把源标记为 error。

## 6. 批③ 榜单接入与公开页

### 6.1 接入

- 新 `crawl_source.type="leaderboard"`,`config.boardKey` 路由 `src/lib/leaderboard/registry.ts`;
  每个解析器配 golden 单测(静态 HTML/JSON 样本)。
- 首批榜单:LMArena(文本总榜)、Artificial Analysis(智能指数)、Hugging Face Trending、
  arXiv 热门(cs.AI/cs.CL)、GitHub Trending。LMArena/AA 动态页走 headless + 代理,日频。
- 抓取失败:保留上一日快照,源状态 degraded,不写空数据。

**真机探源结论(2026-10-30,据实修正上文假设)**:

| 源 | 实际取数形态 | 结论 |
| --- | --- | --- |
| Artificial Analysis | 静态 HTML 内嵌 Next.js RSC flight 载荷(`initialModels` 数组) | **无需 headless**,直连可达 |
| Hugging Face | 公开 JSON API(`sort=trendingScore`) | 境内直连不可达,**须经 `system_proxy_config` 出口代理**(M33 单例) |
| arXiv(cs.AI / cs.CL) | `export.arxiv.org` Atom 查询接口 | 直连可达;entry `id` 为 `http://arxiv.org/abs/<id>v<n>`,落库前升 https |
| GitHub Trending | 服务端渲染 HTML(`article.Box-row` 卡片) | 直连可达,首日 11 条 |
| LMArena | Cloudflare 人机校验 **403**(经代理亦然) | **本批不做**,headless 成本与转载授权另评估(§12 开放决策 1) |

**落码注(批③)**:

- 注册表按 key 固定「一源一榜」,`board` 展示名与公开页同源;渠道行由 worker 启动幂等
  种子(`leaderboard:<key>`,只补缺不改值),URL/启停/周期(默认 1440 分钟)后台可调。
- 每轮解析后按分值倒序(名次榜无分值保原序)截断 ≤20 条落库;解析 0 条按源失败计
  (页面改版与空榜同态,原文快照可回溯),不写空数据。
- 取数原文经 `CrawlSnapshot` 归档(解析之前落盘);渠道类型在后台只读,不允许手工新建
  (牌价/厂商/榜单三类同口径)。

### 6.2 落库

- 每日抓取 → 解析为 `{board, rank, entityKey, entityName, entityType, vendor, score, scoreUnit}`
  → 按 `(source, board, entityKey, capturedDate)` upsert;同日重跑覆盖。
- 名次变动不落库,读侧与上一可用日期比较得出(↑↓/new)。
- 落码注:`capturedDate` 取北京日界(存 `@db.Date` UTC 零点);同日重跑先 upsert 本轮条目、
  再删同日已掉榜行(整表覆盖,幂等);`meta.url` 存条目外链供公开页跳转。快照行不做
  保留期清理(每源每日 ≤20 行,年增 ~3.6 万行,过期无意义的数据量级)。

### 6.3 公开页 `/leaderboards/`

- ISR `revalidate = 3600`;榜单切换(URL query 或页签),表格列:名次、变动、实体、厂商、
  分数/热度、来源;顶部「数据截至」与来源署名链接;降级时显示「本期数据未更新」。
  **落码改档**:切换走页内锚点 chips,不读 `searchParams`——App Router 下读 `searchParams`
  即转动态渲染,ISR 静态产物失效;全量榜单同时 SSR 直出进 HTML,SEO 与首屏一致。
  陈旧阈值 2 天(北京日界),超阈值出琥珀色降级横幅;空榜不出页签。
- 移动端:表格转卡片列表;空态说明。
- SEO:`metadata` + `ItemList` JSON-LD;SSR 直出当页数据(参考 `/pricing/` 模式)。
- 入口:`SITE_TOPICS` 增一项(名称「模型榜单」,href `/leaderboards/`),Header 下拉与
  `/topics/` 索引自动同步。
- 转载合规:上线前逐源核对 ToS/署名;不允许公开呈现的源降级为后台可见,不上公开页。

### 6.4 验收

- ≥4 个榜单连续 3 天有数(允许 1 个降级)。
- 页面 e2e:SSR HTML 含榜单项;专题入口存在;两日数据名次 delta 正确。
- 解析器单测覆盖正常/改版/空数据;失败不污染历史快照先例。

**真机首跑(2026-10-30,dev 库,验收后已清理)**:5 个种子渠道 → 4 源成功
(AA 20 条 / arXiv cs.AI 20 / cs.CL 20 / GitHub 11),同日重跑行数与名次完全一致
(71 行不变,幂等成立);HF 因 `system_proxy_config` 出口代理当日不可达计源失败
(直连本就不可达,代理恢复即通,HF 解析器已用真机 50 条载荷单独验证)。连续 3 天
稳定性与页面 e2e 仍待观察。

## 7. 批④ 社区需求语料

| 源 | 方式 | 频率 | refId |
| --- | --- | --- | --- |
| Hacker News(含 Show HN) | Algolia `search_by_date`(固定单关键词 `query=AI`) | 每小时 | `hn:<objectID>` |
| V2EX | 节点级 `/api/topics/show.json`(openai/claude/deepseek/gemini) | 每小时 | `v2ex:<topicId>` |
| 百度下拉 | 公开 suggestion,种子取分类/标签 + 发现热词 | 每日 | `bd:<sha1(seed\0word)>` |
| 外部 OSS Issues | GitHub API(token 在 `token` 字段,仓库白名单在 `config.repos`) | 每日 | `<repo>#<issue>` |

- 全部走 `crawl_source(type=community, config.communityKey)` + `source-registry` 注册;
  介质 voice/search,地域按源声明。
- **L0 准入**(新增 `src/lib/insight/l0.ts`,纯函数 + 单测):过短(<8 字)、纯营销/导流、
  纯符号、重复文本(归一化后 sha1)直接丢弃;只作用于新源,不改既有源行为。
- **外部 OSS Issues**:首批放 `farion1231/cc-switch` 与 `chenhg5/cc-connect` 两个仓库跑通全链;
  仓库白名单存 `crawl_source.config.repos`(字符串数组),后台可改、零发版增减。只收
  90 天内 open 的 bug/feature/enhancement,正文截断 2000。链路稳定后再扩仓(候选见 arch/01 §2.4)。
- **后台可配置**:`ChannelDialog` 增可选「扩展配置(JSON)」字段(服务端 Zod 校验、
  体积上限;凭证仍走 `token` 脱敏通道),`config.repos` 即经此维护;vendor/leaderboard
  的 `vendorKey`/`boardKey` 同口径。
- Reddit 只做**可达性探针**(经 `system_proxy_config`):Cloudflare **403**,未注册,不进本批验收。

**落码注(批④)**:

- 渠道行由 worker 启动幂等种子(`community:<key>`),URL/启停/周期(默认 HN/V2EX 60 分钟、
  百度/OSS 1440 分钟)后台可调;类型在后台只读,与牌价/厂商/榜单同口径。
- **入池前置去重**:社区源逐轮结果高度重叠(HN 首轮 10 条、次轮 10 条全重复)。逐条撞唯一键
  会刷 prisma 错误日志并白占日预算,故先按 `refId in (...)` 查一次既有行;日预算随之改为按
  「本轮新增」计——否则 60 分钟一轮会提前把当日配额耗尽,把后续真正的新信号饿死。
- 百度下拉响应并非合法 JSON(键未加引号,实测 `cb({q:"…",p:true,s:[…]})`),整体
  `JSON.parse` 必败:只从 `s:` 起做括号配对扫描,对词条数组本身按 JSON 解析。字符集为 GB18030,
  取数层 `TextDecoder("gb18030")` 解码。种子缺省 = 站点文章数前 3 的标签 + 48h 内 `hot-baidu`
  信号 2 条(发现热词回流),两者皆空才用静态兜底。
- V2EX 全局 `hot.json` 与 AI 无关,改按节点取 `show.json`(每节点最近 10 主题,四节点 40 条/轮)。
- HN Algolia 多关键词查询(`AI LLM GPT Claude`)会退化为陈旧/跑题结果,固定单关键词 `query=AI`。
- GitHub Issues 实测约六成未打标,需求判定 = 标签命中(bug/feature/enhancement/feat/
  feature request)**或**标题前缀(bug/feature/feat/建议/缺陷/功能/优化);PR 按 `pull_request`
  字段剔除;语言按**标题**判(正文模板英文会把中文诉求误判为 en)。

**真机首跑(2026-10-30,dev 库,验收后已清理)**:HN 10 条 / 百度 20 条(11 条 L0 `too_short`
拦截——种子为「大模型」类短词,建议词天然短)/ OSS 两仓 15 条(zh 12 / en 3);HN 重跑 10 条
全部命中既有 refId(existing=10,日预算不增,幂等成立)。V2EX 四节点真机载荷 40 条解析与 L0
全通,但当日 `system_proxy_config` 出口隧道不可达,`fetchViaEgress` 实链路未跑通(该域直连
本不可达,隧道恢复即通)。

#### 7.1 知乎探针结论:不做(2026-10-30 实探)

| 路径 | 结果 |
| --- | --- |
| `api.zhihu.com/topstory/hot-list` | 200,热榜可用(已在现网 `hot-zhihu`) |
| `www.zhihu.com/question/<id>` 匿名 + Playwright(真实 Chromium、反自动化参数) | 旧问题 403「安全验证」;新问题跳登录墙 |
| `www.zhihu.com/api/v4/questions/<id>/answers`、`search_v3` | 403/40362,要求登录 |
| RSSHub 公共实例 | 超时/503;自建需 `ZHIHU_COOKIES`(`z_c0`),且**无搜索路由** |

结论:问题正文与搜索均需登录态 cookie + 反爬对抗,且 RSSHub 无搜索路由,拿不到
「求推荐/求工具」类需求原话;账号风险与维护成本高、产出不确定。**本轮不做**,保留
现网热榜(标题级信号);待有稳定合规通道再议。

### 验收

- ≥3 个源稳定入池(HN / V2EX / 百度下拉 / OSS Issues 四选三);日增信号量在预算内
  (HN/V2EX 各 ≤200/日,其余 ≤50/日)。
- L0 抽样:营销/噪声拦截率 ≥80%,误杀 ≤10%。
- `源×簇矩阵` 能看到新源贡献;痛点簇出现社区来源成员。

## 8. 批⑤ 站内问句清洗复活

### 8.1 过滤口径(确定性)

- 只按**页面上下文**排除:后台功能页集合
  {`后台`,`文章新建`,`文章编辑`,`文章管理`,`创作中心`}发起的会话不入池。
- 公开页面(搜索/首页/文章页/Footer 咨询/答案卡追问)一律保留,与身份无关——
  管理员在公开页提问同样算真实需求;后台页即便普通用户也无信号价值。
- 入库 `meta.surface` 记录上下文标签,便于后续调规则。
- 相比 arch/01 §3.4 的「排除 admin 身份前缀 + 仅保留三类入口」,改为上下文黑名单:
  规则等价、对未来公开页自动放行,同批更新 arch/01 §3.4 措辞。

### 8.2 接线

- 登录用户:`backfillSessionTitle` 增参(上下文标签),过滤后调 `ingestInsightSignal`。
- **游客**:当前游客不落 session 行,问句完全没进水——本批补首问采集:
  run 收尾对 `g_` 线程用 Redis `SET NX`(`search:agent:ask-recorded:<threadId>`,TTL 6h)
  判首问,refId=`g:<threadId>`,不存 visitorId(只留线程 id,不做个人关联)。
- 存量:该源此前 `enabled=false`,预期零历史信号;开工时先查库确认,若有则按
  session 归属清理一次(oneoff,执行后删除)。

### 8.3 验收

- 后台创作会话产出的信号 = 0(实跑一次写作会话验证)。
- 公开页游客/用户首问能入池,续问不重复;`meta.surface` 正确。
- 抽样 50 条:有效需求占比 ≥80%;日增量与配额可控。
- `internal-agent` 在 `INSIGHT_SOURCES_ENABLED` 中启用,回归洞察中心各视图。

## 9. 运行与成本

- **调度**:新源全部进 `crawl_source` 台账;cron 只在 `schedules.ts` 注册(翻译扫尾/事件抽取),
  不新增独立调度器。
- **队列**:翻译/事件抽取挂在 `QUEUE_INSIGHT`(concurrency 1),与聚类共用;单轮批量上限防长事务。
- **成本**:翻译只对非中文且未命中缓存;事件抽取按条目批量;两者都可在后台暂停(源禁用/角色解绑)。
- **合规**:遵守 robots/UA;社区数据只聚合、不做个人画像;公开榜单先核 ToS;
  对外数据服务(MCP)不在本轮,启动前另做合规评审。

## 10. 全局验收

1. `make check` 全绿;四个迁移从零重放;CI 绿。
2. 每个新源有真机探报告(可达性/结构/频率/授权),契约不凭假设。
3. e2e:榜单页 SSR、专题入口、洞察地域筛选、事件页签。
4. 回归:M34/M52/M54 洞察视图、`/pricing/`、采集台账不受影响。
5. 文档同批收口:`arch/01`(状态列 + §3.4 措辞)、`arch/03`(新表)、`arch/04`(translate 角色)、
   `arch/05`(队列/job)、`arch/07`(榜单页)、`development-plan`(M58 行)。

## 11. 风险与应对

| 风险 | 应对 |
| --- | --- |
| 翻译延迟/成本失控 | 缓存 + 单条上限 + 24h 降级 + 角色可暂停;成本按 role 监控 |
| 跨语言聚类质量差 | 先抽样评估;不达标则该批暂时按 region 分簇(配置开关),不推翻字段 |
| LMArena/AA 反爬或 ToS 限制 | headless + 代理 + 低频;不允许公开则降级后台;不阻塞其他批 |
| 事件抽取幻觉 | 强制 URL + Zod + 时间合理性 + 人工抽检;低置信只入库不进水 |
| 游客问句隐私 | 不存 visitorId、不做个人关联、只聚合;`meta.surface` 不含路径参数 |
| 公开页数据陈旧 | 「数据截至」+ 降级横幅;源健康度进后台台账 |

## 12. 开放决策(开工前收口)

1. LMArena / Artificial Analysis 公开转载授权:不允许则这两个榜单只进后台。
2. 外部 OSS 仓库扩仓节奏:先 `farion1231/cc-switch` / `chenhg5/cc-connect` 跑通,后续按需加仓(后台改 `config.repos`)。
3. 簇地域口径:MVP 按建议用单值多数派;是否要「同簇分地域展示」看批① 实测效果。
4. 翻译模型与月预算上限(用户配置低成本 LLM 后填入)。

已定:`/leaderboards/` 路径确认;知乎不做(见 §7.1);`config.repos` 后台可配置。

## 13. 与既有决策的自洽

- **MCP**:本轮只沉淀数据与读侧,不开放工具;多租户 API Key(scope/限流/计量)另立项,
  不是 K3 复活(K3 为站点内容只读工具集,已否决)。
- **牌价**:M55/M56 停更,事件层与榜单不依赖牌价表;`price_change` 事件独立采集。
- **渠道纪律**:不新建第二套采集管线,全部落 `crawl_source` + 注册表 + 快照。
