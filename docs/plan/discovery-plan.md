# 优质内容发现机制实现方案(热词 / 博主 / 热点视频)

> 把「发现优质视频与博主」从一次性脚本固化为系统常驻任务:热词日频直拉、发现周频双窗、L0 机器预筛、治理台人工终审。需求与后续规划维护于飞书(创意池·创意 6);开发实现类内容一律留仓库 docs/(2026-10-11 用户定调),本文为唯一实现方案与实施状态基准,里程碑 **M25**([development-plan.md](development-plan.md))。

## 1. 背景与目标

**问题**:博主发现靠 WebSearch + 人工逐个核验,效率低、质量差(候选池多轮补充后低质占比仍高,2026-10-10 用户反馈「搜索的这批博主质量都不高」)。

**实证**(2026-10-11,渠道② 原型 `workspace/tmp/bili-discover.mjs`,一次性、不入库):B站站内搜索 10 关键词 × 90 天窗,raw 200 条结果 → 按 mid 聚合 20 位作者 → L0 元数据预筛仅 **3 人通过**;播放 Top 高互动位 **17/20 为营销号矩阵**。结论:廉价机器过滤必须前置,人工只看机器筛后的短名单。

**目标**:两条 repeatable 任务固化进现有 worker,补齐「发现 → 优质视频 → 视频解读 → 专题文章」闭环的发现端:

- **任务A 热词采集(日频)**:联想词等直接取数,零计算;新词人工确认后扩大发现输入
- **任务B 博主/视频发现(周频)**:90 天窗找博主(候选进治理台人工终审)、7 天窗找热点视频(自动进飞书选题库供选题)

## 2. 总体架构(2026-10-11 用户批准)

| 决策点 | 定稿 | 依据 |
|---|---|---|
| 承载 | 收编现有 BullMQ worker,新队列 `discovery`;无独立脚本/工程 | 用户定调:与现有架构同栈 |
| 真相源 | PG 两表(§5) | 治理台可查可审计;飞书不是真相源 |
| 人工关口 | `/admin/discovery` 治理台唯一系统操作面 | L0 只预筛,批准/忽略人工终审 |
| 飞书定位 | 仅出口:热点视频 → 选题库;博主候选不写飞书 | 用户定调:飞书=需求+后续规划;运营台账人工维护 |
| 渠道范围 | v1 仅 B站;源/fetcher 留扩展位 | B站开放生态(零签名,登录态 jar 即可);search/suggest/card 由 worker **TS 直连**(原型 Node 脚本实证零签名直拉),不经 douyin-gateway——若生产上下文被门,升级路径为网关加 B站 search 端点(复用 curl_cffi/JarPool),不在 TS 侧硬扛;抖音经 douyin-gateway 具备能力,后续按需接入 |

```
关键词配置 discovery_keyword(status=active)
        │
        ├─▶ 任务A 热词采集(日频 repeatable)
        │     联想词直拉(源插件化)→ 归一 → 集合查重
        │     → 新词落 pending → 治理台人工确认 → active(下一轮生效)
        │
        └─▶ 任务B 博主/视频发现(周频 repeatable)
              90天窗 order=click → 按 mid 聚合 → 双排序 top20 → card 补齐 → L0
              → discovery_candidate(type=blogger)→ 治理台人工批准 → admin/bloggers 手工登记
              7天窗 order=click → 播放达标视频 → L0(标题)
              → discovery_candidate(type=video)→ 推飞书选题库(来源=热点事件)
```

**明确砍掉(用户定调,不做)**:增速二次采样/对比计算(热词直接取数即可)、官方热榜 API 接入、跨渠道共振打分。

## 3. 任务A:热词采集(日频)

- **输入**:active 关键词即种子(新词确认后滚雪球扩大输入,即闭环)
- **数据源(v1 双源,源插件化)**:① B站搜索联想(suggest 轻接口);② 搜索引擎联想词(Bing suggest)。每源一个 fetcher 返回查询词数组,新增源 = 新增 fetcher,主流程不动
- **处理**:归一(trim + lower;英文词段大小写归一,注意 PG 非 C collation,大小写判断用 `lower()` 比对)→ 与现有词**集合查重**(精确匹配,非模糊、非增速)→ 新词 INSERT(`origin=hotword, status=pending, source=<来源标识>, firstSeenAt=now`);撞 `word @unique` 即已存在,忽略不动。**`word` 落库即归一形**(trim+lower 后入库),唯一约束与查重同一口径,避免「查重 lower 比对、INSERT 原词形」两套标准
- **人工确认**:治理台 pending → active 即加入任务B 输入;误报 → dismissed
- **产出**:每轮 pino 摘要(种子数/拉取词数/新词数);无新词也正常完成(静默属正常态)

## 4. 任务B:博主/视频发现(周频)

**窗口一·找博主**(90 天):

1. `search_type=video&order=click&pubtime=近90天`,每词取首页 page_size=20(active 词全量,v1 基线 10 词)
2. 按 mid 聚合作者:`hitKeywords[] / hitCount / maxPlay / totalPlay / 标题样本前5`;**多关键词前排反复出现 = 强信号**
3. 双排序:`hitCount desc, maxPlay desc` 取 top 20
4. card 接口补 `{name, fans, archives}`(可失败留空,后续轮次或人工补)
5. L0(§6)→ upsert `discovery_candidate(type=blogger, round=YYYYMMDD)`

**窗口二·找热点视频**(7 天):

1. 同 API,`order=click&pubtime=近7天`,每词取播放达标(≥5 万,常量可调)的前排视频
2. L0(标题维度)→ upsert `discovery_candidate(type=video)` → **通过者创建即推飞书选题库**(热点时效优先于人工;rejected 不推但留痕)

**通用语义**:

- upsert 幂等键 `@@unique([type, platform, externalId])`;重复发现刷新统计字段与 round,**不动 status**(人工已终审的不回退)
- 飞书推送以 `feishuRecordId` 防重推,`client_token` 由 candidate.id **确定性派生**(UUIDv5)兜底——若只随机生成,「推送成功但回写失败」后下轮换 token 重推,bitable 幂等即失效产生重复行;推送单向,人工后续可在飞书侧自行删行
- 频率:周频(周一早);热点视频若需提高到每周 2-3 次,仅改 cron 表达式,结构不变

## 5. 数据模型(两张表,不三张)

```prisma
model discovery_keyword {
  id          BigInt    @id @default(autoincrement())
  word        String    @unique
  origin      String    // manual | hotword
  status      String    // pending | active | dismissed
  source      String?   // hotword 来源标识(如 bili-suggest)
  firstSeenAt DateTime  @default(now())
  confirmedAt DateTime?
  createdAt   DateTime  @default(now())
  updatedAt   DateTime  @updatedAt
}

model discovery_candidate {
  id             BigInt   @id @default(autoincrement())
  type           String   // blogger | video
  platform       String   // v1: bilibili
  externalId     String   // mid 或 bvid
  round          String   // 批次 YYYYMMDD
  title          String?  // video 标题;blogger 置空(样本见 sampleTitles)
  author         String?
  homepageUrl    String?
  hitKeywords    Json?    // 命中关键词数组
  hitCount       Int?
  maxPlay        Int?
  totalPlay      Int?
  fans           Int?     // card 失败可空
  archives       Int?
  sampleTitles   Json?    // 前5标题
  l0Verdict      String   // pass | reject
  l0Reason       String?  // 人话理由,治理台直读
  status         String   // pending | approved | rejected
  feishuRecordId String?
  createdAt      DateTime @default(now())
  updatedAt      DateTime @updatedAt

  @@unique([type, platform, externalId])
  @@index([status, type])
  @@index([round])
}
```

- **种子**:oneoff 脚本把原型 10 词落 `active, origin=manual`:`Cursor 教程 / Claude Code 教程 / AI Agent 实战 / Dify 教程 / Coze 工作流 / MCP 开发 / n8n 教程 / LangChain 实战 / AI 编程 / 大模型应用开发`;应用后删脚本(git 存档)
- **迁移纪律**:仅经 `prisma/migrations`(forward-only),`npx prisma migrate dev --create-only` 评审 SQL,CI 从零重放守卫

## 6. L0 规则(v1 硬编码)

- `src/lib/discovery/l0.ts` 纯函数 `l0Check(input): { verdict, reason }`;词表常量即代码,v2 配置化留评审
- 规则三分(词表以实现为准,下为示意):
  1. **黑名单模式**:名称/签名含营销·机构·搬运特征词(「学院/培训/官方/资源/合集/副业/引流/薅羊毛」等)→ reject
  2. **矩阵名模式**:名称含序号后缀、同品牌多号特征 → reject
  3. **教学向信号**:标题样本命中「教程/实战/入门/手把手/从零/源码/踩坑」等 → pass
  4. 无任何命中 → pass(reason「无负面信号」)——**漏杀成本高于误放**,人工终审兜底
- `l0Reason` 写人话(如「名称命中营销特征词:学院」);rejected 留痕不删,治理台可翻 rejected 视图,作为规则调优的反馈输入

## 7. 调度与可观测

| job | cron(Asia/Shanghai) | 说明 |
|---|---|---|
| `discovery-hotwords` | `37 5 * * *` | 日频;错峰避开 03:23 backup / 03:41 audit / 04:52 usage purge |
| `discovery-bili` | `13 6 * * 1` | 周频,周一早 |

- BullMQ:`attempts=1`(B站退避在 processor 内实现,队列层不自动重试防风控风暴)、`lockDuration 900s`(双窗全词约 5-10 分钟)
- **词数上限**:active 词增长后每轮设词数上限(常量,超出部分顺延下轮),防 job 时长失控
- **手动触发**:`POST /api/discovery/trigger {task:"hotwords"|"discover"}` 入一次性 job(jobId 含 manual+时间戳)——验收与补跑入口
- 可观测:每轮 pino 摘要;治理台页头「上一轮」摘要(轮次/候选数/新词数,从表聚合;不接 spider 页,保持页面收敛)

## 8. B站风控纪律(实证,固化必守)

| 环节 | 纪律 |
|---|---|
| 会话预热 | 任务起手 fetch B站首页 `getSetCookie()` 拼 jar(warmCookies,buvid3) |
| search 词间 | sleep 6-9s 随机 |
| search 412 | 退避 15s 重试 ≤3,仍败该词跳过记日志(不 GIVE UP 整轮) |
| card 补齐 | **与 search 阶段拆开**:search 全部完成后延迟再逐条补;条间 3-4.2s;失败不阻塞(fans/archives 留空)——实证 search 连发后 session 整体进风控态,card 同级被拦(-352) |
| 联想词(任务A) | 轻接口仍守词间 ≥3s;起手是否需 warmCookies 未实证,批④ 真机确认(裸请求 412 则任务A 同样预热) |

原型实证:10/10 关键词全成、零 GIVE UP(2026-10-11)——**本机出口**;数据中心出口的风控敏感性见 M24 实证(arc/search 对 headless/数据中心上下文整段 -352),批④ 增 175 同等上下文手动触发一轮,兜底 = Cookie 池导入 bilibili 登录态 jar。

## 9. 治理台与 API

`/admin/discovery` 单页两板块:

- **发现候选**:筛选(type/status/round);列:类型/标题·作者/命中词(hits)/最高播放/粉丝/作品数/L0 理由/状态/轮次;行展开标题样本 + 素材外链;操作:批准(approved)/忽略(rejected);blogger approved 行提示「请至 博主管理 登记采集」(v1 不自动建 social_account)
- **关键词**:列(词/来源/状态/首次发现);操作:手动添加 / 确认(pending→active)/ 停用(→dismissed);添加撞唯一 = 恢复该词置 active

| 路由 | 方法 | 说明 |
|---|---|---|
| `/api/discovery/keywords` | GET / POST | 列表 / 手动添加 |
| `/api/discovery/keywords/[id]` | PUT | 状态流转 |
| `/api/discovery/candidates` | GET | 筛选列表 |
| `/api/discovery/candidates/[id]` | PUT | 批准/忽略 |
| `/api/discovery/trigger` | POST | 手动触发单任务 |

鉴权:admin 会话;PAT 一律拒绝(对齐 M11 惯例);mutation Origin 校验走既有中间件;外部入参 Zod 校验。

## 10. 飞书出口(热点视频 → 选题库)

目标表:AI选题库 bitable「选题池」。字段映射:

| bitable 字段 | 写入值 |
|---|---|
| 选题标题 | 视频标题(截断) |
| 来源 | 「热点事件」 |
| 素材链接 | `{text, link}` 对象,B站视频链接 |
| 创建日期 | 当天 |
| 类型/优先级/状态 | 留空,人工定 |

写纪律(实证坑,必守):fields 键用真实中文段名(英文键报 1254045);Text 字段纯字符串(分段格式只读不写,1254060);URL 字段必须 `{text, link}` 对象(纯字符串报 1254068);`client_token` 用 UUIDv5(candidate.id 派生)——同一候选重推同 token 才有幂等意义,随机 UUIDv4 在回写失败后会失效。

博主候选**不写**候选池 bitable(人工维护);治理台是博主候选唯一系统出口。

## 11. 非目标(v1 明确不做)

- 增速二次采样/对比计算、官方热榜 API、跨渠道共振打分(用户定调砍掉)
- 自动入 `social_account`:批准后人工至「博主管理」登记;「一键转博主」留后续评审
- 候选池 bitable 自动写
- 抖音/其他平台发现(v1 仅 B站)
- L1 ASR 自动甄别:批准博主进入订阅制采集解读管线后,解读产物即更深层质量信号,不重复建设
- ingest-video 互动门槛(播放/点赞阈值过滤):订阅制管线独立缺口,不并入本方案
- L0 v2 配置化

## 12. 实施分批与验收

| 批 | 内容 | 出口 |
|---|---|---|
| 批① 数据层 | 两表迁移(create-only 评审 SQL + 从零重放)+ 关键词种子 oneoff | 迁移评审过 |
| 批② lib/worker | `src/lib/discovery/`(keywords/candidates repo、l0.ts、bili-search、suggest fetchers)+ 队列注册两 processor + 单测(l0/聚合排序纯函数) | `make check` |
| 批③ 治理台与出口 | `/admin/discovery` 两板块 + 五路由 + 手动触发 + 飞书选题库推送 + e2e | e2e 绿 |
| 批④ 真机验收 | 本地栈手动触发两任务各一轮 → 治理台核验 → 选题库收到热点行 → 175 同等上下文手动触发一轮(观察 -352,生产操作先报方案等批准)→ `feature/discovery` PR 合 develop | 验收清单全勾 |

**验收标准**:

- 日频热词真机一轮:联想词入库、新词 pending、确认后 active 下一轮生效
- 周频发现真机一轮:双窗候选落库、L0 理由人话可读;热点视频进选题库且重跑不重推
- 治理台两板块与手动触发可用
- 风控纪律落实:search 全词成功、零 GIVE UP
- 迁移从零重放过;`make check` 全绿

**状态:未实现**(2026-10-11 方案定稿,待批① 开工;状态流转对齐 [development-plan.md](development-plan.md) §5 维护约定)
