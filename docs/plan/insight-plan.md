# 洞察中心实现方案:热点舆情 + 用户痛点挖掘(M34 立项稿)

> 发现功能(M25 供给端选料器)升级为双引擎洞察系统:热点舆情 + 用户痛点挖掘。
> 需求源:2026-10-16 用户定调「发现功能升级为热点舆情+痛点挖掘系统(含可视化)」;
> 飞书创意池·创意13(五介质痕迹模型/数据源核实);2026-10-17 用户定调硬约束与愿景:
> **①零付费**——不为爬取数据付费,靠技术手段强化自建爬虫获取数据;②远期愿景——采集能力
> 对外做数据服务、数据挖掘与机会分析深度借助 AI;③财经域打通——AI invest(既有财经数据
> 采集系统)与本系统将来互联,挖掘不限于舆情、可扩展到财经;④远期建**分布式爬虫系统**,
> 从财经/军事等多领域采集并做行业调研,形成立体数据采集挖掘系统。本文为唯一实现方案
> 基准,里程碑建议 **M34**(编号以 development-plan 立项时定)。

## 1. 定位与愿景

- **第一落点**:aitech-hub 内容选题数据化——热点×痛点×内容覆盖三维交叉,选题从凭经验到数据驱动
- **通用定位**(创意13):需求验证/选品基础设施,所有创意共用;海外选品(Upwork/Reddit)为远期扩展位,另立项
- **远期愿景(不进本里程碑,架构留伏笔,见下方伏笔清单)**:
  - **立体采集挖掘平台**:远期演进为**分布式爬虫系统**,覆盖舆情/财经/军事等多领域,支撑行业调研,形成「广度采集 → AI 挖掘 → 立体洞察」的通用底座;本里程碑的 fetcher 插件化 + 网关端点标准化即其种子
  - **财经域打通**:AI invest(既有财经数据采集机制)与本系统互联,信号池互通后挖掘从舆情扩展到财经域;伏笔=信号模型带 `domain` 域别字段(批① 即落,默认 tech)
  - **对外数据服务**:采集能力产品化(数据 API/订阅服务)。前置条件:合规评审(robots/ToS/个人信息保护/数据授权),届时另立项
  - **AI 深度挖掘**:洞察 agent(admin 用,复用 LangGraph 会话+工具架构),自然语言问「最近 AI 编程领域有什么新痛点」直接深挖信号池——批⑤ 交付雏形
- **架构伏笔清单**(M34 内落、成本近零):①`insight_signal.domain` 域别字段(财经/军事等域扩展与 AI invest 打通的挂点);②fetcher 插件契约标准化(未来分布式爬虫的节点形态);③信号模型不绑死 aitech 语义(通用 rawText+meta,对外数据服务的表结构基础)
- **人机分工**:系统管广度(多源自动采集+AI 加工+看板),人管深度(社群潜水/内容钓饵/JTBD"上一次"访谈,系统外运营动作)

## 2. 方法论底座:五介质痕迹模型

需求在五种介质留痕,**真需求通常 ≥2 种介质同时留痕,单一介质 = 弱需求信号**:

| 介质 | 信号形态 | 我们的数据源 |
|---|---|---|
| ①钱 | 外包订单、数字产品销量、课程差评、招标 | 猪八戒需求大厅(网页采集);平台更新日志(规则变化=工具窗口期) |
| ②时间 | 教程播放量反向工程、模板下载量、插件装机量 | B站播放数据(M25)、GitHub star/activity(已有) |
| ③声音 | 社区抱怨、视频评论区 | 站内评论+Feedback(已有)、B站/抖音评论区(新采) |
| ④搜索 | 关键词、搜索指数 | 站内搜索词+agent 问句(已有)、联想词(M25)、Google Trends/百度指数(新采) |
| ⑤AI 记录 | "我用 GPT 做X"帖、GPTs/MCP 市场帖、prompt 合集 star 数 | 二期采集 |

**落地含义**:①聚类打标维度含「痕迹介质」;②机会评分卡 = 付费证据 × 搜索热度 × 竞争空隙,**按留痕介质数加权**;③可视化痛点卡带介质徽章(钱✓搜索✓ = 强信号)。

## 3. 数据源与采集路线(零付费,全部自建)

**总原则**:不采购任何数据。免费公开接口 TS 侧直连(轻,B站模式);反爬重的走
douyin-gateway(curl_cffi TLS 指纹/Cookie 池/系统代理,基建已有,M33 批B 热切换)。
所有新源**真机探一轮再定契约**(M25 批④ 教训:契约不可凭假设写桩)。

| 信号 | 源 | 技术路线 | 介质 | 批 |
|---|---|---|---|---|
| 付费需求 | 猪八戒需求大厅 | 网页采集(CrawlSource type=web 模式);开放平台若查到免费档再升级 | 钱 | ③ |
| 视频评论 | B站评论 | 公开接口 TS 直连(零签名),风控间隔沿用 M25 纪律 | 声音 | ④ |
| 视频评论 | 抖音评论 | douyin-gateway 新端点(签名/风控收在网关内) | 声音 | ④ |
| 热榜 | 知乎热榜/百度热搜/B站热门/微博热搜 | 公开接口或网页直连,TS 轻采集,低频(日频一批)。**批③ 已落(2026-10-18 实弹探)**:百度/知乎/B站三源通(契约锚 golden 单测);微博 `ajax/side/hotSearch` 403(需登录 cookie,批④ 再议) | 声音/搜索 | ③ |
| 搜索指数 | Google Trends(免费) | 免费接口。**批③ 探后弃**:trends.google.com 墙内(含生产网关)不可达,后置(百度指数逆向另议) | 搜索 | ③ |
| 搜索指数 | 百度指数 | 网页逆向,风控敏感,**低频兜底** | 搜索 | 备选 |
| 内部信号 | 搜索词/agent 问句/评论/feedback/电报 AI 产物 | 零采集,已在库 | 混合 | ① |
| AI 原生 | GPTs/MCP 市场帖、prompt 合集 star、插件装机量 | 二期另批 | AI 记录 | 后置 |
| 平台规则 | 微信/抖音/美团更新日志 | 网页采集 | 钱 | 后置 |

**合规红线**:优先免费公开渠道;评论数据只做聚合统计、不做个人画像;对外数据服务(远期)启动前必须过合规评审。

## 4. 数据模型(批① 一次建齐,含介质字段)

```prisma
model insight_signal {
  id             BigInt   @id @default(autoincrement())
  source         String   // internal-search | internal-agent | internal-comment | internal-feedback
                        // | bilibili-comment | douyin-comment | hotboard-<platform>
                        // | zbogie | google-trends | telegram-ai ...
  domain         String   @default("tech") // 域别:tech | finance | ... (远期 AI invest
                                         // 财经打通/分布式爬虫多领域扩展的挂点,伏笔①)
  medium         String   // money | time | voice | search | ai-record(五介质)
  rawText        String   // 原文(截断上限按源定)
  normalizedText String   // 归一后(聚类/向量输入)
  refId          String?  // 溯源锚(评论 id / 热榜位次 / 会话 id / post id)
  meta           Json?    // 源相关(平台/位次/互动数/词)
  embedding      Vector(1024)?  // 延迟回填,复用 embedding-3
  signalAt       DateTime // 信号发生时间(非采集时间)
  createdAt      DateTime @default(now())
  @@index([source, signalAt])
  @@index([medium])
}

model insight_cluster {
  id          BigInt   @id @default(autoincrement())
  kind        String   // hot | pain
  domain      String   @default("tech") // 与 signal 同域聚类(跨域打通前不混簇)
  label       String   // LLM 命名(人话)
  summary     String?  // LLM 概括
  keywords    Json?    // string[]
  media       Json?    // 留痕介质集合(评分卡输入)
  score       Float?   // 最新机会分
  status      String   // active | fading | closed
  firstSeenAt DateTime
  lastSeenAt  DateTime
  peakAt      DateTime?
  updatedAt   DateTime @updatedAt
}

model insight_cluster_member {
  id        BigInt @id @default(autoincrement())
  clusterId BigInt
  signalId  BigInt
  weight    Float?
  @@unique([clusterId, signalId])
}

model insight_snapshot {
  id        BigInt @id @default(autoincrement())
  clusterId BigInt
  date      DateTime @db.Date
  score     Float
  rank      Int?
  @@unique([clusterId, date])
}
```

- embedding 列走 raw SQL(pgvector 既有模式,SearchEmbedding 同款);reconcile 复用 embed-content 队列扩展
- 内部信号回填:批① 直插存量(search_log 180 天保留内的存量行即时入池)

## 5. 加工层(AI 挖掘)

1. **L0 廉价过滤**(沿用 `src/lib/discovery/l0.ts` 模式):营销黑名单/去重/广告
2. **向量化**:embedding-3(既有绑定),query-embedding 同款 Redis 缓存 24h
3. **增量聚类**:新信号向量 → 近邻归簇(阈值判定)或建新簇;簇合并/分裂留给 LLM 日频批审
4. **LLM 归纳**(新 ai role `insight`,走 AiTaskBinding 绑定,ai_usage_log 治理):
   簇命名/痛点一句话概括/介质判定/评分卡计算/日频增量批(预计 10-30 次调用/日)
5. **异动告警**:簇热度环比突变(如 3 日 3 倍)→ 看板高亮 + 日报头条
6. **内容覆盖度**:痛点簇 × content_post embedding 相似度 → 已覆盖/部分/空白(空白=选题机会)

## 6. 可视化(/admin/insight,SVG 手写组件,零新依赖)

发现中心侧栏升格「洞察中心」;M25 治理台(候选/词库)保留不动:

| 视图 | 内容 |
|---|---|
| 总览仪表盘 | 今日热点/痛点 Top10 卡(簇名+sparkline+趋势箭头+介质徽章+生命周期标注) |
| 热点雷达 | 簇列表+30 日热力格;簇详情=信号原话流+关联词+来源分布 |
| 痛点榜(核心) | 痛点卡:一句话概括/信号数/典型原话/介质徽章/**内容覆盖度%(空白标红=选题机会)** |
| 选题工作台 | 热点×痛点交叉矩阵+机会评分卡+一键转 Topic(绑 skillKey 进既有合成管线) |

## 7. 触达层

- **Web 看板**:§6(系统内,admin)
- **每日日报**:**系统外**——Claude Code 经 MCP 读库汇总推送飞书(延续 M25「系统内零飞书耦合」语义:真相源=系统表,推送是运营动作);日报模板与推送脚本不进 worker 代码

## 8. 分期(每批独立可验收)

| 批 | 内容 | 出口 |
|---|---|---|
| ① 内部信号先行 | 三表+embedding 列迁移;search_log 增强(命中数/零结果标记,beacon 同口径);agent 问句/评论/feedback/电报 AI 产物入池;存量回填;总览+痛点榜雏形(未聚类,先按源分组) | `make check`+真机验收 |
| ② AI 加工层 | embedding 回填+增量聚类+LLM 打标(insight role 绑定)+覆盖度匹配+异动告警;雷达/痛点榜完整形态。**已实现(2026-10-18,`feature/insight-batch2`)**:insight 角色入 AiTaskBinding(第 7 角色);kind 按源映射(search/agent/comment/feedback→pain,telegram-ai→hot;批③ fetcher 携显式 kind);介质=成员并集(§5.4 LLM 判定留批③ 多介质外部源接入再收);覆盖度=痛点簇质心×post 近邻(零额外 embedding 调用;仅已打标簇,打标次日回写);异动=读侧双门(≥3×前3日均值且 Δ≥10,无基线不告警);阈值/配额常数化 `src/lib/insight/constants.ts` 待 §9-5 实测调参 | 簇可读、理由人话(真机验收前置:/admin/models 绑定「洞察归纳」) |
| ③ 外部源一期 | **2026-10-18 渠道转向后已实现(`feature/insight-batch3`,用户定调:去站内搜索/agent 问句/站点反馈,拓外部渠道+热榜/云图可视化)**:INSIGHT_SOURCES_ENABLED 停接入闸(站内三源退,存量留库,读侧+聚类白名单过滤);热榜三源 fetcher 插件(百度/知乎/B站,解析纯函数+真机探 golden 锚;日频 07:43 `fetch` job,refreshMeta=仍在榜刷新位次/热度续热);今日热榜视图(每源最新 meta.batch 榜面)+关键词云图(近 7 日活跃已打标簇关键词×机会分,字号映射);`insight:run -- fetch` 手动触发。微博(cookie)/抖音(gateway 端点)/Trends(墙)/猪八戒(真机探)后置批④ | 三源实弹校验通;`make check` 绿(1415 例) |
| ④ 评论源 | B站评论 TS 直连+抖音评论网关端点(均真机探);痛点信号并池 | 评论信号可聚类 |
| ⑤ 闭环与 agent | 选题工作台+转 Topic+TopicItem 扩型(signal 类)+词库联动(簇→建议加词)+**洞察 agent 雏形**(查信号/簇/评分三工具) | 选题一键流转 |

### 8.1 批③ 验收反馈(两轮,本地栈验收驱动)

- **第一轮(已验收)**:源筛选页签 `scroll={false}` 修切换滚顶;可视化增强 v1——近 7 日分源堆叠趋势、7 日×24 时段热力、分源占比条+台账、热榜热度条(`src/lib/insight/trend-series.ts` 北京墙钟口径桶取)。
- **第二轮(已交付,5 项)**:① 照搬 ai-invest 采集管理落 `/admin/spider/schedule`(登记表 `src/lib/collect/schedules.ts`,同时是 cron 常量唯一真相源——`@/lib/queue` 仅 re-export,防 client 组件经 queue 拖 bullmq 进浏览器包;列表/日历双视图+分类筛选+常驻清单+crawl_source 间隔台账;管理动作仍在渠道页签);② 洞察中心「信号采集强度」三件套(趋势/时段热力/台账)整体迁入采集总览;③ 词云重写为行业形态——阿基米德螺旋紧密排布+矩形碰撞检测+分层着色+约 1/4 竖排(纯函数 `lib/insight/word-cloud.ts#packWords`,测试锚点);④ 痛点榜改行式机会榜(机会分+分数比例条,整行可点)、热点雷达改双列窄行,两者高度约减半;⑤ 热榜主流化——名次变动(↑n/↓n/「新」,对齐各源上一 `meta.batch` 名次)+ 头部名次着色 + 热度条。
- **第三轮(已交付)**:热榜三源纳入采集计划管理——新增 `insight_hot_source` 登记表(fetcher 代码注册表的运行态投影):运行时启停闸(`run.ts` 逐轮按表过滤,停用源整源跳过,缺行=启用免迁移兼容新 fetcher)+ 逐源拉取态回写(最近拉取/连败/末次错误,crawl_source 同口径,best-effort 不炸信号主链)+ 采集计划页热榜源台账(行内 StatusSwitch 启停,`PUT /api/insight/hot-sources/<source>/status`,照 channels status 惯例)。启停只挡采集,不动 `INSIGHT_SOURCES_ENABLED` 读侧白名单(存量信号照常展示)。同轮:热点雷达改**动量榜**(评估后方案 A)——快照序列尚薄(全簇仅 1 点,sparkline 成孤点)故撤迷你图,改显式名次(头部三色同热榜语法)+ 动量徽(`label.ts#clusterMomentum` 纯函数:新晋=24h≥3 且此前≤2 / 升温=24h≥3 且占比≥40% / 退潮=24h 零新增;热榜 refreshMeta 续热使占比偏「仍在榜」语义,作方向不作度量)+ 分值热度条 + 相对活跃时间。痛点扩围(批③ 渠道转向后 pain 池唯一进水口=文章评论,量小饥饿):**kind 从按源硬映射改为按簇内容语义判定**——`nearestClustersByMembers` 去 kind 过滤改单池归簇(同主题跨源合流),`INSIGHT_SOURCE_KIND` 降级为新建簇引导值,打标契约加 `kind` 字段(LLM 判定:pain=有明确诉求/求助/抱怨,hot=公众话题,拿不准归 hot)日批回写;存量 ≥3 成员簇一次性重判(37/37 成功,「AI编码落地与审查瓶颈」由 hot 翻入 pain,其余 31 个 hot 簇 LLM 判纯话题维持)。专职痛点语料源(猪八戒/知乎问题/外部评论)记批④候选另立项。

## 9. 开放决策点(立项评审收口)

1. ~~Google Trends 为主/百度指数逆向兜底~~——批③ 探后定案:Trends 墙内不可达,退役;百度指数逆向未启动(后置)
2. 猪八戒:网页爬取 vs 开放平台免费档(需查资质门槛)——真机探后定
3. 公开热点页(SEO 机会 vs 时效负资产)——建议 admin-only 先行,公开版后议
4. 图表方案——建议 SVG 手写扩展(Sparkline 先例),引库需另批
5. 簇自动流转纪律(active→fading 阈值)——批② 落 `FADE_AFTER_DAYS=14` 常数初值(日批机械段流转),实测后调参

## 10. 非目标(本里程碑明确不做)

- 付费数据源(用户定调零付费)
- 对外数据服务产品化(远期愿景,合规评审后另立项)
- 分布式爬虫系统(远期愿景:本里程碑只落 fetcher 插件契约与网关端点标准化两颗种子,分布式调度/节点治理另立项)
- 财经域打通(AI invest 互联:远期愿景,本里程碑只落 domain 字段伏笔,不采财经数据)
- 海外源(Upwork/Reddit/Google Trends 海外选品线,另立项)
- 评论数据的个人画像/用户级追踪(合规红线)
- 微信指数(无公开 API,暂缓)
- L1 深度甄别自动化(解读管线产物即深层信号,不重复建设)

## 11. 与既有决策的自洽性

| 既有决策 | 本方案处理 |
|---|---|
| M25「官方热榜 API 接入」被砍 | 舆情定位变更后复活,但改为**免费公开接口自建采集**,不碰付费/官方合作 API |
| M25「跨渠道共振打分」被砍 | 升级为五介质留痕加权评分卡——介质数是可解释的判别维度,非黑盒共振;立项评审确认 |
| M25「系统内零飞书耦合」 | 日报走系统外 MCP,完全延续 |
| 转写文本不落库(版权红线) | 不触碰;评论/热榜/指数数据为公开聚合形态 |
| douyin-gateway 保持 Python(TLS 指纹) | 评论/反爬源端点全部落网关侧,不搬 TS |
