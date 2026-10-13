# 专题内容管线实现方案(专题拟定 → 视频解读笔记 → 专题文档 → 公众号草稿)

> 2026-10-12 用户定调迭代重点:打通「专题拟定 → 视频解读 → 形成专题文档 → 同步到微信公众号草稿」全流程,替代原「专题对比页」工程方向(公开专题页后置独立评估)。设计取向经讨论稿四问确认:① 系统内建专题实体(零飞书耦合)② 解读管线加产「解读笔记」③ LLM 起草 + 人工定稿 ④ 文档落 content_post、公众号复用既有通道。同日经「系统内 vs 本地 VSCode+Claude Code 写作流」对比评估,**仍定系统内闭环**(B 方案否决,§10-8);文章编辑的 AI 辅助修订(diff 评审 + 自动保存)拆出 **M27**([editor-ai-plan.md](editor-ai-plan.md))。里程碑 **M26**([development-plan.md](development-plan.md))。商业锚:公众号 = 冷启动主通道,订阅制解读 3 条/周;专题对比/学习路径两线 v1 文章形态承载——本管线即该内容形态的**生产线**,不新增对外页面形态。

## 1. 背景与目标

**问题**:解读产物 = 电报流短结论(`aiSummary` ≤1000 字 + `aiPoints` ≤3 条),距公众号文章很远;选题跟踪在飞书选题库、素材在电报流、成文在编辑器,三处割裂全靠人工搬运。单条解读撑不起一篇有信息量的专题文,多篇同主题解读的聚合价值没有系统承接。

**目标**:专题成为系统内一等实体(真相源),从拟定到公众号草箱的每一环留痕、可回溯、可半自动化:

- **段① 专题拟定**:admin 建专题、挂素材(解读/已有文章)、写定位与逐条批注
- **段② 解读笔记**:interpreter 在既有短结论之外加产结构化「解读笔记」(~800-1500 字 markdown),专题合成的原料从此够厚
- **段③ 专题文档合成**:一键按专题定位 + 素材 + 批注 LLM 起草,落 content_post 草稿,人工在既有编辑器定稿
- **段④ 公众号草稿**:定稿发布后走既有 M17 distribute 通道,**零新工程**

## 2. 总体架构(2026-10-12 讨论稿取向,细节完善中)

| 决策点 | 定稿 | 依据 |
|---|---|---|
| 真相源 | 系统 `topic`/`topic_item` 两表;**零飞书耦合**(同 M25 §2 口径)——需要进飞书选题库做运营跟踪时经 Claude Code MCP 手工推,系统内不写飞书代码 | M25 批② 追加拍板的既定架构纪律 |
| 素材深度 | 解读管线加产「解读笔记」持久化(`telegram.ai_note`);转写文本仍不落库(版权红线不变,笔记是分析产物) | 短结论合成专题文档素材太薄,文档质量天花板在原料 |
| 合成方式 | LLM 起草初稿 → content_post 草稿 → **人工定稿才可发布**;不做无人值守全自动发布 | 内容质量闸门必须是人;编辑器/发布流既有 |
| 产出载体 | content_post(站点 SEO + 公众号通道全复用);不建对外专题页 | 一份数据两处收益;公开专题页/对比表后置独立评估 |
| AI 修订 | compose 初稿的人工定稿在系统内完成;对话式 agent 改稿 + diff 评审 + 自动保存为 **M27 编辑器工程**([editor-ai-plan.md](editor-ai-plan.md)),M27 交付前用现有编辑器人工修订不受阻 | 2026-10-12 用户定调编辑全流程系统内闭环;编辑器交互工程独立立项,验收口径更净 |

```
M25 发现候选/订阅博主新解读 ──┐
                             ├─▶ admin「专题」拟定(挂素材 + 定位 + 批注,status 流转)
飞书选题库(可选,经 MCP)──┘        │
                                   ▼
                    interpreter 解读(既有短结论 + 加产解读笔记,§4)
                                   │
                                   ▼
                    「合成初稿」compose LLM 起草 → content_post 草稿(§5)
                                   │
                                   ▼
                    人工编辑定稿 → 发布(站点 SEO,content_origin=ai_assisted)
                                   │
                                   ▼
                    既有 M17 通道 → 公众号草稿箱(单篇/批量/主题/预览/自动钩子,§6)
```

**明确砍掉(本期不做)**:公开专题落地页/工具对比表页(原「专题对比页」方向,后置)、学习路径页、无人值守自动发布、系统内飞书写、存量解读补笔记。

## 3. 段① 专题实体与拟定

- **实体**:`topic`(专题)+ `topic_item`(素材挂载),schema 见 §7。挂载来源 v1 两类:`telegram`(视频解读条,`aiStatus=done` 才可挂)+ `post`(已有文章,专题文的引用/配套素材)
- **状态机**(应用层 Zod 管控,同 arch/03 枚举演进条款):
  - `collecting` 拟定/素材收集中(默认)
  - `drafted` 专题文档初稿已合成(`linkedPostId` 落锚;合成动作自动写)
  - `published` 文档已发布(发布钩子自动写;公众号推送状态看文档行 `publish_channel`,不在 topic 上重复)
  - 状态可逆回退(人工把 linked 文档删/下架 → topic 回 drafted/collecting 由重合成或解绑驱动,v1 人工按钮)
- **定位与批注**:topic 定位字段(positioning:目标读者/文风/口径,合成 prompt 的主输入);topic_item 逐条人工批注(note ≤500 字:「这条重点用第 2 点」类取舍指令)——合成质量的人工抓手
- **与 M25 发现的关系**:v1 `discovery_candidate` 不直接挂专题(候选 → 人工登记博主 → 订阅 → 解读 → telegram → 挂);候选直挂留决策点(§10-6)
- **拟定入口**:admin 治理台新「专题」板块(§9);电报流条目与文章编辑器的「加入专题」入口是否做,留决策点(§10-5)

## 4. 段② 解读笔记(interpreter 扩展)

- **产物**:`telegram.ai_note`(markdown,800~1500 字),结构模板:背景与问题 → 核心要点展开(带视频时间线叙事)→ 做法/配置清单(如适用)→ 适用人群与局限。**是 LLM 分析产物,非转写文本**——arch/02 §3.2 「转写即删」红线不变,笔记随结论列组持久化
- **生成方式(§10-1 定稿)**:同一 interpreter job 内**第二次 LLM 调用**专产笔记——既有 interpret 契约(aiTopic/aiSummary/aiPoints/aiKeywords)零改动,笔记 prompt 独立迭代;转写文本仍在 job 内存作用域内,不落盘。失败语义:笔记调用当轮重试 1 次,仍败 `ai_note=null` 不阻塞解读终态(该素材合成时降级用短结论),日志记事件
- **存量**:已解读条目不补笔记(转写即删,不可重放)——存量素材合成时自动降级拼装(标题 + aiSummary + aiPoints),方案诚实接受素材深度差异
- **成本**:3 条/周 × 1 次笔记调用,量级可忽略(标注于 ai_usage_log 台账,role=interpret 自然覆盖)

## 5. 段③ 专题文档合成

- **新 AI 用途**:`compose`(专题合成)角色卡入 `AI_MODEL_PURPOSES`(arch/04 §4 任务绑定 UI 自动出新角色行);绑定校验 `purposes.has(role)` 既有机制生效;未绑定 = 合成按钮 400 人话(同 seo-batch 前置校验口径)
- **输入**:topic 定位 + 全部 topic_item(笔记优先,`ai_note=null` 降级短结论)+ 逐条人工批注 + 站点已有相关文章标题清单(防重复选题视角)
- **产出**:一次调用生成 `{title, excerpt, contentMd}`,落 content_post:
  - `status=draft`、`contentMd`(新文正文通道)、`contentOrigin=ai_assisted`(2026-10-05 合规标识既有枚举)
  - 分类默认落「产品评测」、标签带专题关键词(默认值留决策点 §10-4)
  - `topic.linkedPostId` 锚定 + `composedAt`;topic → drafted
- **M27 批①/批②合成重构(1276 验收反馈,2026-10-13)**:文章形态钉死为「博主×视频」推荐短文(固定结构模板 STRUCTURE_SPEC 在代码内:钩子→博主是谁→视频讲了什么→值得看的理由→去看原视频「阅读原文」CTA;800~1200 字/短段落/要点加粗),专题定位降级为补充创作指令(建题表单预填 `DEFAULT_TOPIC_POSITIONING`);首视频封面转存入媒体库落 `post.coverPath`(站点头图+公众号大图+解锁公众号同步缺封面门,转存失败降级不阻塞合成),正文文首确定性注入「视频推荐卡」(纯文字引用卡,封面不重复进正文);封面生图(cover-generate)仍为可选增强
- **重合成**:v1 重合成直接覆盖草稿 `contentMd`/`title`/`excerpt`/`coverPath`,但 linked 文档若 `updatedAt` 晚于 `composedAt`(人工编辑过)需二次确认——保护人工改动,交互文案明说(细节 §10-3)
- **封面**:可走既有 cover-generate(封面生图角色),非本管线必选步骤
- **成本量级**:单次合成 ≈ 输入 N×2k 字 + 输出 2~3k 字,一篇一次,成本可忽略量级;入台账
- **人工定稿**:M27 编辑器交付前用现有编辑器(MdEditor/Vditor)人工修订,发布链不受阻;M27 交付后对话式改稿 + diff 评审接管修订效率([editor-ai-plan.md](editor-ai-plan.md))
- **M27 批⑤ agent 自主生产(退役固定管线,1276 验收反馈,2026-10-13)**:本段确定性合成链(compose 角色卡 → 单调用/四步管线 → compose 进度轮询路由)整体退役;编排权移交会话 agent(admin 身份档,细粒度四工具 `get_topic_brief`/`transfer_video_cover`/`generate_cover_candidates`/`save_topic_draft`,arch/04 K2.8 补注),模型按系统提示工作流自主规划执行,选题沟通走 ask_user。**保留并复用**:落稿锚定核 `finalizeCompose`(扩展 SEO/标签,undefined=不触碰防覆盖人工字段)、重合成保护 `needsRecomposeConfirm`、素材拼装 `buildComposeBlocks`、封面转存 `transferCoverOrNull`、视频推荐卡注入;STRUCTURE_SPEC 固定结构降格为系统提示写作指南。compose AI 角色槽退役(六→五,历史台账读侧回退原值)

## 6. 段④ 公众号推送(既有通道,零新工程)

- 专题文档 = content_post,M17/M18 通道全量复用:单篇同步/批量/六主题渲染/预览/`draft add`+`update` 重推/发布自动钩子(`maybeEnqueueAutoWechat` 默认关,人工开)
- 「每周精选合集」是公众号侧人工运营形态(路线图既定),系统不新增;专题文档是多篇精选的天然原料
- 本段无代码交付,验收 = 专题文档经既有通道真推一稿入生产草箱(与 M18 验收同法)

## 7. 数据模型(两新表一列,无 FK 冗余,同 discovery 两表口径)

```prisma
model Topic {
  id           BigInt    @id @default(autoincrement())
  title        String    @db.VarChar(200)
  positioning  String?   @db.VarChar(1000) // 专题定位/目标读者/文风口径(合成 prompt 主输入)
  status       String    @default("collecting") @db.VarChar(20) // collecting/drafted/published(Zod)
  linkedPostId BigInt?   @map("linked_post_id") // 专题文档 content_post 锚(应用层完整性,无 FK)
  composedAt   DateTime? @map("composed_at")
  publishedAt  DateTime? @map("published_at") // 发布钩子回写
  createdAt    DateTime  @default(now()) @map("created_at") @db.Timestamptz(6)
  updatedAt    DateTime  @updatedAt @map("updated_at") @db.Timestamptz(6)

  items TopicItem[]
  @@index([status, updatedAt(sort: Desc)], map: "idx_topic_status_updated")
  @@map("topic")
}

model TopicItem {
  id        BigInt   @id @default(autoincrement())
  topicId   BigInt   @map("topic_id")
  itemType  String   @map("item_type") @db.VarChar(20) // telegram|post(Zod)
  itemId    BigInt   @map("item_id") // 应用层完整性:telegram.id / content_post.id
  note      String?  @db.VarChar(500) // 人工批注(合成取舍指令)
  sortOrder Int      @default(0) @map("sort_order") // 合成时的叙事顺序
  createdAt DateTime @default(now()) @map("created_at") @db.Timestamptz(6)

  topic Topic @relation(fields: [topicId], references: [id], onDelete: Cascade)

  @@unique([topicId, itemType, itemId], map: "uq_topic_item_topic_type_item")
  @@index([topicId, sortOrder], map: "idx_topic_item_topic_sort")
  @@map("topic_item")
}
```

`telegram` 加一列:`aiNote String? @map("ai_note") @db.Text // 解读笔记(M26,LLM 分析产物 markdown;null=未产出/存量)`。迁移纪律照旧:`--create-only` 评审 + 从零重放 CI 守卫,forward-only。

## 8. 治理台与路由

- `/admin/topics`:列表(状态分段 collecting/drafted/published)+ 新建;`/admin/topics/[id]` 详情三区——素材聚合视图(解读卡:标题/博主/笔记摘要/短结论/批注内联编辑 + 文章卡)、定位编辑、合成操作区(合成初稿/重合成/跳转文档)
- 挂载交互:详情页内选挂(电报流按博主/时间筛选,仅列 `aiStatus=done`;文章按关键词搜);电报流治理台条目内「加入专题」入口 v1 不做(§10-5)
- API 路由(顶层域目录惯例):`GET/POST /api/topics`、`GET/PATCH /api/topics/[id]`、`POST/DELETE /api/topics/[id]/items`。鉴权 admin 会话,PAT 拒(对齐 M11/M17 惯例);mutation Origin 校验 + Zod 入参。**M27 批⑤:`POST/GET /api/topics/[id]/compose` 随固定管线退役删除**(合成执行与进度可视性改由会话 agent 工具层承接,见下条)
- ~~**合成执行形态(M27 批③ agent 化)**:BullMQ 异步四步管线……~~ **已随 M27 批⑤ 退役**(`QUEUE_TOPIC_COMPOSE`/processor/降级单调用一并移除;jobId 去重、轮询路由、409 防重等管线基建不复存在)
- **合成 agent 交互(M27 批④ 建对话框化入口,批⑤ 换工具面)**:专题页「合成初稿/重合成」唤起侧边栏助手卡并注入合成任务文本(不变);admin 图工具面从单只 `compose_topic_draft`(管线轮询)换为细粒度四件 `get_topic_brief`/`transfer_video_cover`/`generate_cover_candidates`/`save_topic_draft`(arch/04 K2.8 补注),模型自主规划逐步执行、每只工具卡逐个出现提供过程可视性;选题不确定走 ask_user,重合成覆盖确认走 needConfirm → ask_user → confirm=true 回路;落稿由工具层 `finalizeCompose` 直接写库(worker 管线已退役);空素材按钮侧就地拦截保留(零真网防线)

## 9. e2e 与测试

- 单测:topic 状态机/素材挂载唯一冲突/合成输入拼装(笔记优先+批注注入+降级拼装)/重合成保护判定纯函数
- e2e 零真网(同 M25 口径,真 LLM 调用不入 e2e):五路由鉴权 401/403、Zod 400、挂载/去重/状态流转、compose 未绑定模型 400
- 真机验收:本地 prod 栈订阅博主真条解读出笔记 → 建专题挂 2-3 素材 → 合成初稿 → 编辑器人工修订 → 发布 → 经既有通道推公众号测试号草箱

## 10. 决策记录(2026-10-12 定稿)

1. **解读笔记生成方式**:同 job **二次 LLM 调用**——既有 interpret 契约零改动,笔记 prompt 独立迭代;省一次调用的收益不值契约耦合
2. **合成文风与目标长度**:公众号口语化,2000±500 字起步;站点专业向双形态留 v2
3. **重合成保护**:linked 文档 `updatedAt > composedAt` 即人工动过 → 重合成二次确认
4. **草稿默认分类与标签**:分类「产品评测」、标签带专题关键词,均可改
5. **挂载入口**:仅专题详情页内挂;电报流/编辑器入口不做
6. **discovery_candidate 直挂**:不做,链路走「登记博主 → 订阅 → 解读 → 挂」
7. **终态自动化**:发布钩子回写 `published`;`collecting → drafted` 仅由合成驱动
8. **路线裁决:系统内闭环,B 方案否决**——「笔记/成文放本地 VSCode+Claude Code + 系统工作包导出(按需重转写)」经对比评估后不采纳:系统内闭环在运维、留痕、数据一致性上更收敛,且不引入转写临时通道的 Redis 过盘复杂度
9. **编辑器 AI 修订拆 M27**:propose_edits + diff 评审 + 自动保存独立立项([editor-ai-plan.md](editor-ai-plan.md)),验收口径与管线分离

## 11. 非目标(v1 明确不做)

- 公开专题落地页 / 工具对比表 / 学习路径页(原「专题对比页」方向整体后置,内容形态仍走文章)
- 本地写作流与工作包导出(B 方案,§10-8 已否决;含按需重转写通道)
- 编辑器 AI 化(M27 承接:propose_edits + diff 评审 + 自动保存,[editor-ai-plan.md](editor-ai-plan.md))
- 无人值守全自动发布(合成→定稿→发布必须人工过手)
- 系统内飞书写(M25 §10 解耦口径延续;选题库分发经 MCP 人工)
- 存量解读补笔记(转写即删不可重放)
- 多专题文档互链/系列导航/专题合集页
- topic 素材自动推荐(「这些解读看起来同主题」类聚类)
- 笔记配视频重点截图(2026-10-12 讨论:需「帧允许持久化」的版权口径裁决——帧比转写文本更资产化,红线只裁过转写文本;三缺口=ASR 时间戳/多模态选帧(supportsVision 位已预留)/存储口径,A 解读时自动抽帧与 B 治理台人工打点两路线均悬于该裁决,单独立项时先定口径)

## 12. 实施分批(预排,§10 定稿后可调)

| 批 | 内容 | 出口 |
|---|---|---|
| 批① 数据层 | `topic`/`topic_item`/`telegram.ai_note` 迁移(create-only 评审 + 从零重放)+ Zod 状态/类型枚举与 repo 库 | 迁移评审过 —— **已交付(PR #75)** |
| 批② 解读笔记 | interpret job 二次调用产笔记(模板/重试 1 次/null 降级)+ 单测(拼装与降级纯函数) | `make check` —— **已交付(PR #75)** |
| 批③ 治理台 | `/admin/topics` 列表+详情三区 + 五路由 + 挂载/流转/批注;笔记 prompt 补时间纪律(年份/时间表述须取自材料,未提则写「近期」——m26b2 验收发现笔记自行搭「2024年」叙事框架,视频实为 2026-10) | 人工验收 + e2e 零真网 —— **已交付(PR #75)** |
| 批④ 合成 | compose 角色卡 + 合成编排(拼装→调用→落草稿→锚定)+ 重合成保护 + 编辑器衔接 | 本地真机一轮(含降级素材)—— 代码已交付(feature/topic-compose,4c8df48),**待真机验收** |
| 批⑤ 收口 | 文档收口(arch/02 §3.2 注记/arch/05 §4/arch/04 §4/本表)—— **本次已落**;e2e 补齐(用例 34 合成防线)—— **已随批④ 交付**;PR 合 develop + 生产部署 + 公众号真推一稿 —— 待批④ 真机验收后执行 | 全流程真机走通 |
| M27 批①/② 合成重构 | 「博主×视频」推荐体固定结构 + 预置提示词(DEFAULT_TOPIC_POSITIONING)+ 素材链路(视频链/封面)注入 + 首视频封面转存落 coverPath + 文首视频推荐卡(1276 验收反馈)—— **代码已交付(feature/editor-ai,33fb763/e020886)** | 本地真机验收 |
| M27 批③ 合成 agent 化 | BullMQ 异步四步管线(角度择优→起草→自检→修订)+ 进度轮询 + 失败降级单调用(1276 验收反馈「agent 智能生产过程」)—— **代码已交付(feature/editor-ai)** | 本地真机验收 |
| M27 批④ 合成对话框化 | 专题页合成按钮唤起侧边栏 agent(compose_topic_draft admin 工具 + 身份档分发 + 工具卡四步进度实时滚动 + needConfirm→ask_user 回路)(1276 验收反馈「点击合成要有过程」)—— **代码已交付(feature/editor-ai)** | 本地真机验收 |
| M27 批⑤ agent 自主生产 | 退役固定管线(四步管线/processor/compose 路由/compose_topic_draft/轮询面板/compose AI 角色槽)+ admin 细粒度四工具(get_topic_brief/transfer_video_cover/generate_cover_candidates/save_topic_draft)+ 工作流提示重写(六步/修订路径/写作指南)+ 护栏按身份档(admin 30 次/150k tokens)+ 落稿核扩展 SEO/标签(undefined=不触碰)+ 防幻觉图片校验(1276 验收反馈「过程要可见、agent 要自主做很多事」)—— **代码已交付(feature/editor-ai)**,文档同步(arch/04 K2.8 补注/§4 五角色/本文件)—— **已落** | 本地真机验收(端到端一轮含修订对话) |

**验收标准(预排)**:解读真机出笔记(新条有/存量 null);专题挂载→合成→人工定稿→发布→公众号草箱全链真机走通;素材降级拼装路径(全短结论专题)可合成;`make check` 全绿 + 迁移从零重放;零版权红线破坏(转写不落库断言不放松)。

**状态:方案定稿(2026-10-12),已实施至 M27 批⑤**——M26 五批 + M27 批①~⑤(合成重构→agent 化→对话框化→自主生产)代码全部交付;合成链终态 = 会话 agent 自主编排(arch/04 K2.8 补注),后续 R③ 关键帧/HTML 截图、R④ 工具注册表化(MCP 扩展位)另行立项。编辑器 AI 化见 [editor-ai-plan.md](editor-ai-plan.md)。状态流转对齐 [development-plan.md](development-plan.md) §5 维护约定。
