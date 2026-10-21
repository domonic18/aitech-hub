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
- **M27 批①/批②合成重构(1276 验收反馈,2026-10-13)**:文章形态钉死为「博主×视频」推荐短文(固定结构模板 STRUCTURE_SPEC 在代码内:钩子→博主是谁→视频讲了什么→值得看的理由→去看原视频「阅读原文」CTA;800~1200 字/短段落/要点加粗),专题定位降级为补充创作指令(建题表单预填 `DEFAULT_TOPIC_POSITIONING`);首视频封面转存入媒体库落 `post.coverPath`(站点头图+公众号大图+解锁公众号同步缺封面门,转存失败降级不阻塞合成),正文文首确定性注入「视频推荐卡」(~~纯文字引用卡,封面不重复进正文~~ **M27 批⑥推翻:卡升级带图**,见下条);封面生图(cover-generate)仍为可选增强
- **M27 批⑥正文配图全链路(1276 验收反馈「重合成正文 0 图」,2026-10-13)**:供给→分配→消费→校验四环建链(arch/04 K2.8 补注二)——`transferVideoCovers` 全量转存视频封面;brief 的 materials[] 改输出站内 `cover_path`(替代外链 cover_url)+ `cover_transfer_failed` 失败清单,transfer_video_cover 重定位为重试/补传钮;文首推荐卡升级带图(首视频自己的封面,finalizeCompose 确定性自取,失败降级文字卡),提示层改写(正文直引 cover_path、生图放开为小节概念示意图、头图避让卡图、全文 2~4 张引导);防幻觉校验收窄 uploads-only(`/media/` 无服务路由是幻觉洞);正文图 lazy 加载。同批修 todo 计划条(agent 图显式挂 `todoListMiddleware()` + load 从 values.todos 恢复,deepagents 仅 Codex 档自带是断因)
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

- `/admin/topics`:列表(状态分段 collecting/drafted/published)+ 新建;`/admin/topics/[id]` 详情四区(2026-10-20 详情页重构,原「详情三区」按工作流叙事重排、去「合成」术语)——① 专题概览(状态步进条+标题+事实行+人工流转)② 写作要求(MECE 四维可视化构建:内容形式×口吻×篇幅×配图,样例节选+信息卡真实渲染预览;选择单向合成文本落库 positioning,`src/lib/topics/writing-config.ts`)③ 素材(解读卡/文章卡+批注内联编辑;素材库 `<details>` 零素材默认展开,开合态客户端持有防 refresh 塌缩)④ 初稿(文档状态卡+公众号同步快照+生成初稿/重新生成初稿,体裁词由服务端 `resolvePurpose` 从写作要求派生)
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
- 笔记配视频重点截图(2026-10-12 讨论:需「帧允许持久化」的版权口径裁决——帧比转写文本更资产化,红线只裁过转写文本;三缺口=ASR 时间戳/多模态选帧(supportsVision 位已预留)/存储口径,A 解读时自动抽帧与 B 治理台人工打点两路线均悬于该裁决,单独立项时先定口径。**2026-10-14 转正**:立为 [development-plan.md](development-plan.md) M32「视频关键帧解析入文」,前提不变=版权口径裁决后排 M31 后启动)

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
| M27 批⑥ 正文配图全链路 + todo 计划条 | 供给(transferVideoCovers 全量转存)→ 分配(brief cover_path 富化 + transfer 重试钮)→ 消费(文首卡带图 + 提示层改写:直引 cover_path/生图概念示意图/头图避卡图/2~4 张引导)→ 校验(findNonSiteImageRefs 收窄 uploads-only)+ ArticleBody 图 lazy;todo 修复(图显式挂 todoListMiddleware + load 从 values.todos 恢复)(1276 验收反馈「正文 0 图/todo 不显示」)—— **代码已交付(feature/editor-ai)**,文档同步(arch/04 K2.8 补注二/本文件 §5)—— **已落** | 本地真机验收(brief cover_path 全 uploads + 正文图文混排 + 公众号草箱图全 mmbiz + 计划条显示) |
| M27 批⑦ 验收反馈四项修复 | ①后台 FAB(admin/layout 挂 AssistantFab,侧边助手卡误关后可再呼);②长视频解读(流式下载 500MB/卡顿探测 + ffmpeg 5min 切片逐段转写按序拼接 + 转写注入 3 万字截断帽,arch/02 §3.2 批⑦ 注记);③写作质量与自评审(反套话/背景递进/原视频链接硬要求 + save 前强制自评审步,封顶 2 轮禁反复重写,arch/04 批⑦ 注记);④封面上传根治(mime 魔数嗅探裁决 + sha1 partial unique 迁移 20261013120000 + sharp 终败落 error 自愈 + 确定性 jobId 查态,arch/08 §3.4 批⑦ 注记)—— **代码已交付(feature/editor-ai),文档同步 —— **已落** | 真机验收(后台 FAB 呼出/长视频重解读成功/合成文背景递进带原链/封面重传不再重复报错) |

**验收标准(预排)**:解读真机出笔记(新条有/存量 null);专题挂载→合成→人工定稿→发布→公众号草箱全链真机走通;素材降级拼装路径(全短结论专题)可合成;`make check` 全绿 + 迁移从零重放;零版权红线破坏(转写不落库断言不放松)。

**状态:方案定稿(2026-10-12),已实施至 M27 批⑦**——M26 五批 + M27 批①~⑥(合成重构→agent 化→对话框化→自主生产→配图全链路)代码全部交付;合成链终态 = 会话 agent 自主编排(arch/04 K2.8 补注),后续 R③ 关键帧/HTML 截图、R④ 工具注册表化(MCP 扩展位)另行立项。编辑器 AI 化见 [editor-ai-plan.md](editor-ai-plan.md)。状态流转对齐 [development-plan.md](development-plan.md) §5 维护约定。

## 13. 增补方案:M39 文生图插画与内容形式扩容(2026-10-21 立项)

> 2026-10-21 用户立项:nano banana(`gemini-nano-banana-2.1`,经 AiHubMix 网关)文生图能力强,借力让同步公众号/小红书的文章以更美观、清晰的可视化方式呈现。四项主需求(生图任务绑定/写作时可选文生图工艺/配图样例缩略图/内容形式扩容)+ 两项补充(移除模板实验室页/样例参照图库)。方案评估后六决策定稿(§13.2);除批③外零 schema 变更。前置探针:AiHubMix 端点参数容忍度与参考图支持(用户在模型台账配 key 后实测,结论回填本节)。

### 13.1 需求与现状差距(评估结论:半数基建现成)

| 已有基建 | 位置 | 与需求的差距 |
|---|---|---|
| 任务绑定机制(七角色,含 cover 封面生图,M14) | `src/lib/ai/bindings-admin.ts` | 差一个 `illustrate`(配图生图)角色;播种/校验/绑定 UI 全自动生效 |
| 文生图客户端(OpenAI images/generations 兼容,M14/M16) | `src/lib/ai/image-client.ts` | AiHubMix 响应形态(`output[]`/`content_url`)与「下载须带 Bearer」需适配 |
| 生图队列 + 候选 hold/adopt(M14/M31) | `src/lib/ai/cover-generate.ts` | 插画生成复用其执行核心(生成→入库),cover 管线本体不动 |
| HTML 卡渲染(agent 工具 → card-renderer,M31/M38) | `src/lib/agent/card-tools.ts` | 现成,即「信息卡」工艺一侧 |
| 写作配置四维 MECE(2026-10-20 详情页重构) | `src/lib/topics/writing-config.ts` | 配图维两选扩三选;内容形式注册表扩容 |
| `topic.skillKey` 软引用 + `agent_skill` 表(M30) | prisma / `src/lib/agent/skill-tools.ts` | 「每场景一个 skill」载体现成,零新表 |

### 13.2 决策记录(2026-10-21 用户定稿)

1. **nano banana 接入**:经 AiHubMix 网关(base `https://aihubmix.com/ai/v1`,模型 `gemini-nano-banana-2.1`,OpenAI images/generations 兼容形态);响应为 `{id, status, output:[{b64_json|content_url, index}], error}`,`content_url` 下载须带同 key 且约 30 分钟过期(下载即时转存,过期无虞)。**探针实证(2026-10-21)**:端点严格校验,拒收 `size`/`response_format`(HTTP 400 `Unknown request parameter`),`n`/`model`/`prompt` 正常;且生图走其**异步任务通道,须先在 AiHubMix 控制台开通**(未开通报 403 `async_not_enabled`)。参数剔除经 `extra_params` 保留键置 null 表达(新增机制,见 §13.3-①),模型 id=26 已配 `{"size": null, "response_format": null}`,连通性测试通过(~17s/张)
2. **内容形式扩展走代码注册表扩容(路线 A)**:一次把新形式注册进 `TOPIC_PURPOSES`;DB 化预置表(路线 B)否决——真正瓶颈在每形式的指南写法分支质量,不在注册表本身,且注册表机制本按扩展设计
3. **每个内容形式 = 一个场景 skill**:写作要求/结构模板/插画数量口径住 `agent_skill.guideMd`(后台改即生效零发版);插画数量由 agent 自主决定,指南给各场景口径
4. **生图模型按绑定级**:写作 UI 只选工艺,模型在 AI 配置页 `illustrate` 角色绑主力/备用;不做每次写作时临时选模型
5. **移除卡片模板实验室页**:preset 模板入口 2026-10-20 已机制层关闭,页面属遗留;`/api/card-presets/preview` 保留(写作面板配图真实渲染预览依赖)
6. **新增样例参照图库**:写作时可上传本地/剪贴板粘贴样例图供生成参照,图库沉淀管理、后续可直接选用

### 13.3 方案分块

**① 生图基建适配(零 schema)**
- `AI_MODEL_PURPOSES` 加 `illustrate`(配图生图)第八角色 + `AI_ROLE_META` 角色卡;绑定 Tab/校验/resolver 自动纳入;`ai_usage_log` role=illustrate 自然覆盖记账
- image-client 扩 AiHubMix 形态:响应兼容 `output[]`(现仅认 OpenAI `data[]`),条目 `b64_json`|`content_url` 双形态;**同源带鉴权下载**——现有「下载不带 Authorization」纪律收窄为「URL 宿主=网关 baseUrl 宿主才带」(密钥不出同一供应商边界,跨宿主仍禁)
- 探针项(批①出口):`n`/`size`/`response_format` 端点容忍度;`n` 不支持则走智谱同款补请求凑满(机制已有);每模型 `extra_params` 逃生门已有。
  **实证结论(2026-10-21)**:`n` 支持、`size`/`response_format` 被 400 拒收 → 新增「`extra_params` 保留键显式 null = 整键剔除」机制(image-client 与探针共用 `buildImagesBody` 同源构造,`null` 值不透传),非 null 扩展参数照旧透传;请求体构造器收口后探针与管线永不漂移
- 验收配套小修(批①顺带):测试状态徽章失败时内联显示截断原因(原仅 title 悬浮,「失败且没有错误原因」);探针非 2xx JSON 错误体优先提取 `error.message` 人话(原原始体截 200 字符,message 被代码/tid 噪音淹没)
- **第二供应商 Seedream 5.0 pro(2026-10-21 用户追加,契约评估=零代码接入)**:火山方舟 `POST https://ark.cn-beijing.volces.com/api/v3/images/generations` + Bearer,OpenAI images 兼容——现有客户端直接覆盖(协议门禁 openai/响应 `data[]` url|b64_json/错误 `error.code+message`)。台账配置:protocol=openai、baseUrl=`https://ark.cn-beijing.volces.com/api/v3`、modelId=`doubao-seedream-5-0-pro-260628`(以方舟 Model ID 页为准)、extra_params `{"watermark": false, "n": null}`(watermark 官方默认 true 须显式关;n 未见于文档,预置剔除走智谱同款补请求凑满,若实测支持 n 亦可去掉)。`size` 显式宽x高在支持域内(1344x768 ✓);url 转存跨宿主不带鉴权(TOS 公链)恰合既有纪律。**关键差异:官方支持参考图 `image` 参数(单图/多图最多 10 张,URL 或 data URL base64)——批③样例参照图库在 Seedream 侧有原生生成通道**(AiHubMix nano-banana 仍悬置,prompt 描述降级兜底),工具层参数透传留批③设计

**② 写作配置面(零 schema)**
- 配图维三选:**信息卡为主**(HTML 渲染,缺省)/ **文生图插画为主** / **少图纯文字**;条款行机制照旧(`VISUAL_CLAUSE` 注册精确字符串,合成/回显自动纳入)
- 「文生图插画」样例 = 2 张 nano banana 预生成静态缩略图(`public/` 资产入仓库),展示与既有 `VISUAL_SAMPLE_CARDS` 同构;文生图无法零副作用实时预览(每张计费 + 10-30s),静态样例是唯一务实解
- 内容形式扩容 5 项:开源项目介绍 / 论文解读 / 教程精炼 / 周新闻精选 / 模型价格表(`TOPIC_PURPOSES` 加项:label/genreWord/positioningTemplate/**skillKey**——注册表新增字段);选形式时服务端单点回写 `topic.skillKey`(人工改 skillKey 仍自由,与现状一致);两个既有视频形式继续挂 blogger-video skill 不迁
- `writing-config.ts` 补 5 形式面板样例节选;`resolvePurpose`/合成/解析机制零改动(新形式自动纳入,custom 判定不变)
- 移除模板实验室:`AdminSidebar` 入口 + `admin/cards/page.tsx` + `CardTemplateLab.tsx`;preset 模板实现与预览 API 保留
  **实施记录(2026-10-21)**:skillKey 回写=服务端单点 `deriveSkillKey`(writing-config 导出,POST/PATCH 路由从 positioning 派生,custom→undefined 不动人工绑定;派生值属注册表常量,在 PATCH 存在性核之后注入免核,skill 种子落库前 agent 侧 list_skills 兜底)。文生图样例 2 张经 cogview-4 预产出(无水印无文字,672w jpg 入 `public/images/writing/`,后续可用真 nano-banana 重出同路径替换);实验室移除连带 `PRESET_META`/`preset-samples.ts`(唯一消费者)与两处 docblock 订正;tsconfig exclude 补 `workspace/tmp`(gitignored 临时脚本不该进门禁,对齐 CI 视角)

**③ 样例参照图库(唯一 schema 变更)**
- 新表 `writing_sample_image`(name/media_path/created_at)+ `topic` 加列 `sample_image_id`(可空,应用层完整性无 FK,同 `linked_post_id` 口径);迁移纪律照旧 create-only 评审 + 从零重放,forward-only
- 写作配置面板配图区「样例参照」位:本地上传/剪贴板粘贴 → `uploadMedia` 入媒体库 + 图库登记(可选「仅本专题引用不入库」不做,凡上传皆入库沉淀,口径更简单);图库选择器内联重命名/删除,不开新管理页
- **探针悬置项**:AiHubMix images 端点是否收参考图参数——能收则 `generate_illustration` 生成时带样例图参照;不能收则降级为「样例图仅供 agent 拟 prompt 时的风格描述素材」(agent 侧无多模态读图通道,效果打折)。批①已探明基础参数契约(拒收 size/response_format),参考图参数属独立请求形态,**留批③按上述两分支实测后再定交互承诺**

**④ 生成执行**

> **2026-10-21 用户优先级调整**:批② 交付后用户实测「文生图插画为主」选择仍出 HTML 卡——根因即本批工具未落地(agent 手里唯一配图工具是 HTML 信息卡渲染,条款行只是文本指引;且既有 `generate_cover_candidates` 走 cover 角色绑定,illustrate 绑定模型在合成中零参与)。用户要求**先验证文生图出图效果**,故前两项(执行核心提取 + `generate_illustration` 工具)提前至批③ 之前交付;skill 种子与工艺纪律仍随后置批,批③ 样例参照图库顺延(§13.5)。

- 新 admin 工具 `generate_illustration`:agent 按小节内容拟 prompt → 复用 cover-gen 执行核心(prompt/张数/尺寸 → 生图 → `uploadMedia` 入库)→ 回传 markdown 行与站内路径;不交互不挂起(免确认口径同 cover auto 档);模型走 `illustrate` 绑定,未绑定时人话报错不阻塞其余小节
- 从 cover-generate 提取「文生图执行核心」共用函数,cover 管线零改动;时长/成本预期:每张 10-30s,一篇 2~4 张,合成时长 +1~2 分钟,按张计费入台账
- 场景 skill 种子落库(oneoff 幂等 seed,同 M38 惯例):5 新形式各一行 `agent_skill`(guideMd 含写作模板/结构骨架/插画数量口径 + 工艺分工纪律);blogger-video 同批增补配图工艺条款
- **工艺分工纪律(入指南 L2)**:数据密集内容(价格表/周新闻数据图/对比表/步骤卡)走 HTML 信息卡——文生图对中文精确文字渲染不可靠是硬边界;概念/场景/氛围图走文生图插画。两工艺互补非替代,UI 文案与指南双重引导

**⑤ 封面图生成勾选(2026-10-21 用户补充微调)**
- 写作配置面板新增「生成封面图」勾选项(默认勾选):勾选=现状(合成流程封面候选自动生成);取消=重新生成文章时 AI 不再生成封面,保留关联稿现有封面
- 载体沿用 positioning 条款行机制(零 schema 变更):取消勾选合成条款行 `封面:不生成封面图,重写时保留现有封面。`(精确锚点入 compose/parse 往返);默认勾选不出行,老专题存量定位无损
- 双层硬约束(弱模型纪律,指南披露不足实证在案):brief 载荷带结构化 `skip_cover_generation` 标记 + 人话 note(软);`generate_cover_candidates` 工具层对勾选专题直接拒绝并指引正文概念图改走 `generate_illustration`(硬,免浪费计费)

**⑥ 工艺纪律改写(2026-10-21 真机反馈:选了文生图仍全走 HTML 卡)**
> 根因:工具机制已就位但**流程指令层缺失**——`generate_illustration` 在工具面,但系统提示第 4 步写死「正文配图只有两类——render_card…与 generate_cover_candidates…」、blogger-video 指南写「正文配图只用 render_card 卡图与 generate_cover_candidates 生成图」;技能指南优先于系统提示通用写法,弱模型照单执行,插画工具不可达。修复 = 双层同步改写(指南 L2 + 系统提示 harness 双落,弱模型单层披露不足实证在案):
- 系统提示(admin addendum):第 4 步改「两类工艺按写作要求「配图」条款分流」——render_card=数据密集专艺(中文精确文字渲染不可靠是硬边界),`generate_illustration`=概念/场景/氛围叙事向(插画非卡片,card_urls 不含);「配图:文生图插画为主」条款 → 插画为主艺、数据密集小节仍配信息卡;`generate_cover_candidates` 只服务封面候选。第 5⑤ 自评审数量对账扩为「配图工具(render_card/generate_illustration)调用数一致」;第 7 步头图加 `skip_cover_generation=true` 整步跳过;「卡片可视化纪律」必做项扩为「卡片图或文生图插画」,card_urls 硬闸只对卡片
- blogger-video 指南(DB 资产,后台改即生效):「写作要求优先」示例条款补插画条款;「核心内容笔记」导语改工艺分流(插画为主时主艺移交,数据密集仍按下述版式配卡);「图」纪律行改「正文配图只用 render_card 卡图与 generate_illustration 文生图插画(generate_cover_candidates 只服务封面候选)」

### 13.4 数据模型变更

```prisma
model WritingSampleImage {
  id        BigInt   @id @default(autoincrement())
  name      String   @db.VarChar(100) // 样例名(图库列表展示;可重命名)
  mediaPath String   @map("media_path") @db.VarChar(500) // 媒体库站内路径
  createdAt DateTime @default(now()) @map("created_at") @db.Timestamptz(6)

  @@map("writing_sample_image")
}
```

`topic` 加一列:`sampleImageId BigInt? @map("sample_image_id") // 样例参照图(写作配置配图区挂;应用层完整性无 FK,删图库行后引用置空)`。其余全部零 schema。

### 13.5 实施分批

| 批 | 内容 | 出口 |
|---|---|---|
| 批① 生图基建 | `illustrate` 角色 + image-client AiHubMix 形态适配;探针实测(n/size/response_format/参考图参数)+ 验收小修(徽章内联错误原因/错误体人话提取/extra_params 保留键 null=剔除机制)—— **已交付(feature/writing-illustration),连通性测试绿(~17s/张)** | 探针结论已回填 §13.2-1/§13.3-①/③;`make check` 绿 ✅ |
| 批② 写作配置面 | 配图三选 + 条款行 + 静态样例缩略图 + 内容形式扩容 5 项 + form→skillKey 回写 + 移除模板实验室页 —— **已交付(feature/writing-illustration)** | `make check` 绿(1535 用例);面板手验(选项/回显/样例)待验收 ✅ |
| 批④ 生成执行 | **核心已提前交付(2026-10-21 用户优先级调整,见 §13.3-④)**:`generate_illustration` 工具 + 执行核心提取(cover 管线零改动);**指南工艺纪律已随真机反馈补齐(2026-10-21,见 §13.3-⑥)**:系统提示第 4/5⑤/7 步与 blogger-video 指南双层改写(两类工艺分流 + 插画入列 + 封面跳过);**5 场景 skill 种子已交付(批④余项,2026-10-21,见 §13.10)** | 本地真机一轮:illustrate 绑定模型真出图入库(核心,已验);重合成走查「文生图为主」真出插画(工艺纪律,§13.9 批④+4 后用户已验证:高质量带字图文) |
| 批④+ 封面图勾选微调(2026-10-21 用户补充,§13.3-⑤) | 写作配置「生成封面图」勾选(默认勾)+ brief 结构化标记 + cover 候选工具守卫 | `make check` 绿 + 面板手验(取消勾选重合成不再出封面) |
| 批④++ 分层三修(2026-10-21 用户要求,§13.7) | 意图结构化闭环(brief `visual_mode` + 三态 note,提示分流改按字段)+ 守卫对称(插画为主未绑定生图模型 → brief 开工预警)+ 清单单源机器防线(工具面-提示一致性测试,正反向)+ 陈旧枚举 docblock 清理 —— **已交付** | `make check` 绿(含 parity 守卫);重合成走查插画为主真出插画 |
| 批③ 样例参照图库(**顺延**) | 迁移(表+列)+ 上传/粘贴/选择/管理 UI + topic PATCH 扩字段 + brief 载荷带样例图 | 迁移从零重放 + 面板手验 |
| 批⑤ 收口 | 文档同步(arch/04 八角色与工具面、本文件状态、development-plan M39 行)+ e2e/单测补齐(图库路由鉴权/Zod、writing-config 扩展 roundtrip) | `make check` + e2e 全绿,PR 合 develop |

### 13.6 非目标(本立项明确不做)

- 每次写作时临时选生图模型(决策 4,绑定级已覆盖)
- 内容形式 DB 化预置表与 admin CRUD(决策 2,路线 A)
- 小红书分发通道(本立项只优化文章配图质量;渠道同步后置,图片进正文后未来渠道自然受益)
- 插画位置/数量的人工精细控制(agent 按指南自主;反馈驱动的精控后置)
- cover 封面管线重构(仅提取共用核心,行为不变)
- 预置样例缩略图的在线再生成(静态资产随代码迭代,需要换样例 = 换图发版,频次可忽略)

### 13.7 文章生成层次职责梳理与防再犯机制(2026-10-21 用户要求)

> 触发:批④ 真机反馈「选了文生图仍全走 HTML 卡」(§13.3-⑥)。复盘定性:不是单点
> bug,是分层缺陷——同一事实(正文配图有哪些工艺)没有真相源,意图没有结构化通道,
> 守卫不对称。本节为 M39 范围内的设计基准,批⑤ 收口时并入 arch/04(§3 编排段)。

**合成全链路现状(分层视图)**

```
L0 意图层   写作配置面板 → writing-config compose/parse → positioning 条款行
            (唯一落库载体;结构化 selection 服务端可派生,零 schema)
L1 编排机制  ADMIN_PROMPT_ADDENDUM(代码,发版生效)
            工作流步骤 1-8 + 交付纪律 + 卡片可视化纪律 + 封面纪律 + 技能调度
L2 工艺策略  agent_skill 指南(DB 资产,后台改即时生效;brief 预装 / get_skill 渐进取)
L3 工具守卫  tool 面(schema/description/体内校验;身份 fail-closed、uploads-only、
            card_urls 硬闸、cover skip 守卫、未绑定人话报错)
L4 执行核心  generateIllustrations / render_card 管线 / cover-gen 队列 / finalizeCompose
            (纯库函数,零提示语义)
旁路        write_article 写作模型(独立绑定):底料=定位原文+指南全文+素材,
            OUTPUT_RULES 禁图——只产文字,配图全在编排侧(边界健康,本次故障不在此层)
```

**本次故障的三个结构性缺陷**

1. **意图断层**:「配图:文生图插画为主」止步于 prose 条款行,brief 无结构化透出。
   封面勾选有 `skip_cover_generation` 结构化标记 + note + 工具硬守卫三层(M39 批④+),
   配图选择只有 prose——同一配置面板的维度,结构化只做了一半。要求弱模型「正确读到
   并服从一段与其它显式指令冲突的 prose」是最弱一环。
2. **能力清单双副本漂移**:「正文配图有哪些工艺」是机制事实(真相源=工具面),却被
   手写进两处策略文本:L1 提示(「只有两类」)+ L2 指南(「只用 render_card 与
   generate_cover_candidates」),另有 write-article/topic-tools docblock 两处副本
   (共 4 处)。新增工具只改工具面与测试,清单副本无任何机器校验强制同步;模型服从
   了最显式的那份旧清单。
3. **守卫不对称**:意图说「不要」(封面)有工具硬拒;意图说「只要」(插画为主)无
   机制保证路径可用——illustrate 绑定缺失只在调用时爆,此前静默回落全靠模型自觉。

**层次职责重划(核心原则:按变更节奏与真相源切层,每层只答一个问题)**

| 层 | 职责(只答一个问题) | 禁止 |
|---|---|---|
| L0 意图 | 用户这次要什么(结构化 selection 为准,prose 仅为载体) | — |
| L1 编排机制 | 流程顺序(先干什么后干什么)+ **能力清单**(工具面有什么,与工具面同发版节奏,唯一权威副本) | 不写工艺策略(什么内容用什么版式/几张) |
| L2 工艺策略 | 怎么做好(版式语汇/口吻/字数/插画数量口径/工艺分工原则) | 不维护能力枚举句(「只用 X 与 Y」),只按分工原则引用工具名 |
| L3 工具守卫 | 硬约束:身份/格式/越权/**意图违逆**(说不要→拒) | 不做需要判断力的路由(选哪工艺是模型+策略的事) |
| L4 执行核心 | 计费/入库/去重/降级 | 不携带提示语义 |

**防再犯三修(2026-10-21 已交付,出口见 §13.5 批④++ 行)**

- **修 1·意图结构化闭环**:`get_topic_brief` 载荷透出 `visual_mode`(cards/illustrate/
  minimal,服务端 `parseWritingText(positioning).selection.visual` 派生,零 schema)+
  三态人话 note(对齐 cover_note 口径);L1 第 4 步改「按 brief 的 visual_mode 分流」,
  不再要求模型重读条款文本自行判断。
- **修 2·清单单源 + 机器防线**:能力清单唯一权威 = L1 提示(与工具面同发版节奏);
  L2 指南删枚举句改分工原则(blogger-video 三处已改两处半,补齐并在收口时全 skill
  盘一遍);新增**一致性单测**:遍历 `agentToolsFor("admin")` 全部工具名,断言 L1
  提示逐一提及(显式 allowlist 豁免),反向断言 L1/L2 不出现未注册工具名——本次
  故障在该测试下直接红。顺带清理 write-article/topic-tools docblock 陈旧枚举副本。
- **修 3·守卫对称**:brief 阶段即可用性预检——`visual_mode=illustrate` 且 illustrate
  未绑定时,载荷带 warning(「插画为主但未绑定生图模型,本次无法生成插画:先到 AI
  配置绑定,或改写作配置为信息卡为主」),把路径不可用从调用时提前到开工前暴露
  (render_card 无绑定依赖,必可用,无需对称预检)。

**分层机制与文件对照(2026-10-21 补,文件名已逐一核实)**

| 层 | 机制 | 文件(职责锚点) | 生效节奏 |
|---|---|---|---|
| L0 意图 | 条款行 compose/parse 往返 + 结构化 selection 派生 + form→skillKey 回写 | `src/lib/topics/writing-config.ts`(CLAUSE 注册表/parseWritingText/deriveSkillKey/skipCoverGeneration)、`src/lib/topics/constants.ts`(TOPIC_PURPOSES 7 形式模板)、`src/components/admin/topics/TopicWritingConfigPanel.tsx`(面板)、`src/app/api/topics/[id]/route.ts`(PATCH 落库 positioning+skillKey 同请求回写) | 保存即落库,下次生成本次生效 |
| L1 编排机制 | ADMIN_PROMPT_ADDENDUM:工作流步骤 1-8 + 能力清单(唯一权威副本)+ 交付/封面/改稿纪律 + 技能调度条款 | `src/lib/agent/agent.ts`(ADMIN_PROMPT_ADDENDUM + agentToolsFor/agentSystemPrompt 分发 + 图缓存 key=id:source:身份) | 发版(镜像重建+容器重启清图缓存) |
| L2 工艺策略 | agent_skill 资产(key/name/scenario/guide_md/enabled);指南正文即场景工艺 | DB 表 `agent_skill`;读取 `src/lib/ai/agent-skills-admin.ts`;后台 CRUD `src/app/api/agent-skills/` + 页面 `src/app/(admin)/admin/skills/page.tsx`;种子惯例 `scripts/oneoff/`(如 guide-blogger-video) | DB 即时生效,零发版 |
| L3 工具守卫 | schema 入参校验 + 体内硬校验 + description 承载用法纪律 | `src/lib/agent/topic-tools.ts`(brief/转存/cover 候选+skip 守卫)、`topic-draft-tool.ts`(card_urls 硬闸/uploads-only/needConfirm)、`illustrate-tool.ts`、`card-tools.ts`(render_card 自由 HTML 唯一用法)、`write-article-tool.ts`、`cover-tools.ts`(HITL 两段/auto_adopt)、`skill-tools.ts`、`wechat-budget-tool.ts`、`post-sources-tool.ts`;横切:`admin-thread.ts`(fail-closed)+ 中间件四件(tool-call-repair/context-trim/ask-user-guard/tool-args-feedback,agent.ts 挂载) | 发版 |
| L4 执行核心 | 纯库函数:生图/渲卡/队列/落库注入/计费入库 | `src/lib/ai/illustrate-generate.ts`(generateIllustrations)、`src/lib/ai/image-client.ts`(images/generations 兼容客户端)、`src/lib/ai/cover-generate.ts`(BullMQ 入队+单拍探测)、`src/lib/card/render.ts`(HTML→PNG 经 card-renderer sidecar)、`src/lib/topics/compose.ts`(buildComposeBlocks/finalizeCompose 文首推荐卡注入/transferVideoCovers)、`src/lib/media/service.ts`(uploadMedia sha1 去重)、`worker/processors.ts`(队列消费) | 发版 |
| 旁路 写作模型 | write_article 单任务捆绑:工具侧装配底料(定位原文+指南全文+素材)喂 writing 绑定模型,OUTPUT_RULES 禁图 | `src/lib/agent/write-article-tool.ts`(buildWriterPrompt) | 发版(机制)/DB(指南内容) |

**场景处理的归属(三层拆开:路由是机制,内容是策略,匹配是兜底)**

- **场景路由 = 机制(L0+brief 预装,确定性)**:内容形式 → skillKey 的映射住
  `writing-config.ts#deriveSkillKey`(TOPIC_PURPOSES 注册表),PATCH 落库时同请求回写
  `topic.skillKey`;`get_topic_brief` 见有绑定即 pinned 预装该指南全文(topic-tools.ts),
  不等模型自发取用。确定性路由不经过模型判断。
- **场景工艺内容 = 策略(L2 指南正文)**:这个场景怎么写——结构骨架/口吻/字数/插画
  数量口径/教程判据/码点预算——全部住该场景 guideMd。批④ 余项「5 场景 skill 种子」
  即此模式:oneoff 幂等 seed 一行 agent_skill + TOPIC_PURPOSES 注册形式(后者发版)。
  场景内二次分支(如视频安利指南内的「教程类视频判据」)也纯住 L2 文本,由模型执行。
- **场景匹配兜底 = 模型自主(L1 调度条款 + skill-tools 机制)**:无绑定/停用时,编排
  模型按 L1「技能调度」条款调 list_skills 按 scenario 元数据对号 → get_skill 取全文;
  仍未命中则按素材常识写作并在汇报中声明。
- **归属判据**(harness-vs-hardcode 既有口径):这条场景规则改不改要发版?要发版的
  (路由注册表、能力清单、工具语义)→ L0/L1/L3;运营随时会调的(写法、口径、结构)
  → L2。场景「换指南」零发版,场景「新增一类」= 注册表发版 + 指南入 DB 各半步。

### 13.8 写作配置交互重构(2026-10-21 用户反馈:编辑体验诡异、耦合严重)

> 触发:用户在 textarea 里微调「配图:文生图插画为主…」条款几个字,上方选项卡
> 从「文生图插画为主」静默变回「信息卡为主」。定性:批② 交互的根子缺陷,非小 bug。

**现状回顾(批② 实现)**:textarea(落库 positioning)是唯一真相源,选项卡只是
「文本构建器」——点击=单向合成模板+条款行;反向回显靠**精确字符串锚点**
(parseWritingText 逐行全等匹配;matchTopicPurpose 对体裁模板也是**全等匹配**)。

**四个体验缺陷**:
1. **手改即失联**:条款行改动几个字 → 锚点失配 → 该维芯片静默回落缺省显示
   (用户实锤);改体裁模板 → custom=true 永久死锁。
2. **自由修改不可能**:custom 态点任何选项 → confirm「手动修改会丢失」→ 整段
   按模板重建,手写内容全灭。「已自定义」是死胡同:选项与文本的映射已断,
   用户只能整段重写。
3. **内部资产暴露**:体裁模板(60~120 字提示词 prose)是机器载荷,却被放进
   可编辑大文本框让用户看/改——「业务耦合严重」的直接来源。
4. **隐藏技能路由断裂**(review 新发现):任何手写补充文本都会让 matchTopicPurpose
   全等失配 → deriveSkillKey 返回 undefined → 保存时技能绑定静默不更新,
   留下旧绑定;resolvePurpose 体裁词也回落「自定义」。自由文本杀死了结构化路由。

**根因**:把「枚举选项」和「自由文本」两套心智模型硬捏进一个 textarea 双向同步——
文本既当用户输入又当机器载荷,双向都靠脆弱的字符串锚点。

**重构设计(方案 B:选项归选项、补充归补充;定位文本降级为机器载体)**:

- 载体三段式(仍是 positioning 单字段,零 schema):`体裁模板(内部,不暴露)+
  条款行(芯片驱动)+ 【补充要求】自由块(verbatim 透传 AI)`。
- `composeWritingText(selection, supplement?)` / `parseWritingText` →
  `{ selection, supplement, custom }`;custom 仅=体裁模板被手改(不再因有自由文本而触发)。
- **无损不变量**:保存永不销毁未识别内容——解析时未识别行(含被手改的模板 prose)
  一律收进 supplement,点选项只重建「模板+条款」规范段,补充块原样保留。
- UI(TopicWritingConfigPanel):四维芯片 + 封面勾选 + **补充要求 textarea**
  (placeholder:选材偏好/口吻细节/特别强调,原样交给 AI)+ 折叠的「查看将交给
  AI 的写作要求」只读预览(透明度);**移除 confirm 弹窗与「已自定义」死胡同**;
  模板被改时提示条 + 「恢复标准模板」一键动作(显式而非默默)。
- 附带修复:deriveSkillKey 剥离补充块后再匹配体裁 → 有补充要求时技能路由照常
  派生(修缺陷 4);resolvePurpose 同步受益。
- AI 侧零改动:positioning 仍是文本载体,visual_mode/skipCoverGeneration/
  deriveSkillKey/brief 各消费方接口不变。
- 存量兼容:老专题(纯模板+条款)解析无损;手改过的老文本首次保存时规范化
  (未识别行进补充块),无内容丢失。

**备选方案 C(否)**:topic 加 writing_selection jsonb 列,positioning 纯自由文本。
数据模型最干净,但需迁移+回填+改全部消费方,体验收益与 B 相同——YAGNI,留档备查。

**批次**:批④+3 交互重构(**已交付 2026-10-21**)。落地清单:
- writing-config:compose(selection, supplement)/ parse → {selection, supplement,
  custom} 三段式重写;无损解析(未识别行含手改模板 prose 一律收进补充块;模板
  精确命中的体裁行不漏进补充块);规范文本幂等(parse→compose===原文)。
- 面板重写:selection/supplement 双状态,点选项零确认零销毁;补充要求 textarea
  + 折叠「查看将交给 AI 的写作要求」预览;custom 仅=模板手改时 amber 提示
  (设计中的独立「恢复标准模板」按钮由「保存即按标准模板重建+提示核对」替代,
  免冗余交互)。
- 测试重写 28 例:补充 verbatim 往返/幂等/带补充技能路由照常派生(修缺陷 4
  断言)/补充块内条款行不回显(只认第一处头)/同维重复与冲突防御/封面 skip
  带补充仍生效。
- 出口:`make check` 全绿;手验三例——①微调补充要求不惊动芯片;②点芯片不丢
  补充;③带补充保存后技能路由照常回写。

### 13.9 文生图工艺重定义:插画 → 内容可视化图文(2026-10-21 用户反馈:产出与预期不符)

> 触发:post 280 全流程走通,出图为「概念/场景装饰插画」(无文字、图表占位假数据);
> 用户预期 = 可直接在公众号/小红书传播的可视化图(**图里有文章文字**)。
> 定性:**产品定义错位,非工程 bug**——M39 立项把「文生图」预设为博客插画配图,
> 工具描述/指南/提示词全链路忠实执行了错误定义(工具 schema 甚至硬性禁止画面内
> 文字)。后续 §13.3-⑥/⑦ 与 §13.7 三修都是把错误定义执行得更忠实。

**实证先行(用户纠偏:先试再评估)**:Seedream 5.0 Pro(生产绑定主力)直连
五档带字压力测试,素材取 post 280 真实内容(workspace/tmp/t2i-test,与生产同一
resolver+image-client):

| 档位 | 规定文字量 | 逐字核验 |
| --- | --- | --- |
| 头图卡 16:9(标题+副题) | ~20 字 | 全对,发布级 |
| 要点卡 3:4(五条要点) | ~60 字 | 1 错字(给谁→给池),版式可用 |
| 金句卡 | ~20 字 | 全对 |
| 数字卡(4 组数字+≈/= 符号) | — | 数字符号全对,漏 1 个单位字 |
| 长文本段落 | 75 字逐字排入 | 全对(含标点) |

结论:「带字图文」达到**可用水平**,旧「文生图渲中文不可靠」经验失效;错字率
约 1 处/图,「错字重出一次 + 成稿人审」可兜底。方案 A(文生图直出带字图文)实证成立。

**设计原则(用户定调)**:agent 按**内容编排呈现形态**——先看内容特点找到合适的
图文呈现方式,再让文生图生成;形态是**开放集合**,指南(L2)只给编排原则与通用
纪律,不做固定卡型枚举(要点卡/金句卡只是示例,后续新形态零改造);工具与提示只
承载机制(宽高比/张数/计费/文字纪律)。改形态规则 = 改指南不发版(§13.7 分层判据)。

**后续迭代(不在本批,已列入计划)**:Seedream 图层 API(背景层/文字层分区生成
与编辑)——彻底解决错字定点修正与「改字不重生成」;届时与 card-renderer 混合
(§13.8 方案 D 形态)再评估。

**重定义方案(按 §13.7 五层联动改写,防再犯)**:

- **L0 writing-config**:illustrate 条款文案改「配图:文生图图文为主,由 AI 按小节
  内容编排呈现形态(文字入图;数据密集内容仍可配信息卡)。」;选项 label
  「文生图插画为主」→「文生图图文为主」+ desc(形态由 AI 按内容编排、不设限);
  **key=illustrate 与 brief visual_mode 枚举不动**(工具/API 零震荡);
  VISUAL_SAMPLE_ILLUSTRATIONS 静态样例换实证图(t1/t2/t3 拷入
  public/images/writing/,标注为「示例形态」非固定模板)。
  存量:分支未合 develop 生产零旧条款,锚点文案直接改,无兼容层。
- **L1 agent.ts 提示**:第 4 步 visual_mode=illustrate 分流文案与第 6 纪律段
  「插画」→「图文」口径(工具名/generate_illustration 调用数对账不变)。
- **L2 blogger-video 指南**(repo 种子源 scripts/oneoff/guide-blogger-video/run.ts
  + 验收库 guide_md 同步):**编排优先、形态开放**——指南只给原则不封清单:
  动笔前先为每个配图位决定「传达什么信息 + 用什么形态呈现」,形态由内容特点定
  (要点归纳/金句/头图/对比图解/流程步骤/清单海报/时间线/概念隐喻场景带标注
  ……示例而非全集,后续新形态零改造);选不出生动形态就退回 render_card 或
  该节不配图。跨形态通用纪律:入图文字给**原文短句化**、字少而大、数字逐字
  核对;同篇每条 prompt 重复**同一风格锚定句**(多图一致);模型自查不出错字
  ——一图至多重出一次,成稿人审定夺;**数据密集小节仍走 render_card**(数字
  可校对、改数据秒级重渲的优势保留)。
- **L3 illustrate-tool**:description 重写(先编排后生成:先定信息与形态,再写
  prompt;错字/字少而大纪律);schema 加 `aspect` 枚举("16:9"|"3:4"|"1:1",
  缺省 "16:9")——宽高比是模型物理约束、属机制参数,不携带内容语义;prompt
  describe 改「形态版式 + 入图文字原文 + 风格锚定」;返回 markdown alt
  「插画」→「图文」。
- **L4 illustrate-generate**:aspect→size 映射(16:9=1344x768、3:4=864x1152、
  1:1=1024x1024,枚举守卫);ILLUSTRATE_MAX_COUNT 2→3;计费/落库/用量审计零改动。
- **水印保留**:模型右下角「AI生成」标识按现状保留——《人工智能生成合成内容
  标识办法》(2025-09 施行)要求显式标识,对外发布合规默认;如需关闭走
  ai_model.extra_params.watermark_enabled(自担合规)。
- **测试联动**:writing-config.test(条款锚点)/ topic-tools.test(visual_note
  与 ILLUSTRATE_CLAUSE)/ agent.test(提示口径断言)/ illustrate-tool.test
  (工具描述)同步改;parity 守卫不受影响(工具名不变)。

**批次**:批④+4 插画→图文重定义;出口 `make check` 绿 + 重合成 post 280
同配置专题真出带字图文(编排形态至少两种)+ 面板样例与指南编排原则在位。

**交付状态(2026-10-21)**:五层全落地——L0 条款/label/desc 改图文口径 + 样例换
实证三图(t1 头图/t2 竖版要点/t3 金句,拷入 public/images/writing/,标注「示例
形态」非固定模板);L1 第 4 步与第 6 段改口径(文生图「渲中文不可靠」硬边界表述
退役,改「数字可校对是卡片相对文生图的硬优势」);L2 指南新增「文生图图文工艺」
节(编排优先/形态开放示例非全集/选不出形态退卡或不配/prompt 三项俱全/错字一图
至多重出一次/数据密集仍走卡),truth 源 writing-guides.ts 更新并经 oneoff 灌验收
库(3214→3954 字符);L3 工具重写(aspect 机制枚举 + 编排优先 description +
![图文] alt);L4 aspect→size 映射 + MAX_COUNT 3。测试同步(writing-config/
topic-tools/agent/illustrate-tool/illustrate-generate 新增 aspect 映射与张数收敛
[1,3]),`make check` 绿(typecheck/lint 0 error/1566 tests);验收栈 m39-batch4
重建 + nginx restart,样例三图 HTTP 200。**待收口**:post 280 同配置重合成
(编排形态至少两种)用户触发验证;批⑤ arch/04 同步时并入本节。
**✅ 出口验证通过(2026-10-21 用户)**:post 280 同配置重合成真出高质量带字
图文,批④+4 收口。
另:L2 指南「图」条修正 generate_cover_candidates 职责(只服务封面,正文概念图
归 generate_illustration——批④ 职责移交在指南侧的漏改,本次一并收口)。

### 13.10 批④余项:5 场景 skill 种子(2026-10-21 交付)

> 批② 扩容的 5 个非视频内容形式(open-source-intro/paper-interpret/tutorial-refine/
> weekly-news/model-pricing)各配专属场景 skill——form→skillKey 单点绑定已在
> constants 注册,本批补齐指南资产,消除「绑定降级 list_skills 兜底」的常态失联。

**落地**:
- 指南真相源 `src/lib/ai/writing-guides.ts` 新增 5 份指南(各含:体裁钩子/递进
  结构/硬纪律——素材取数不编造/生动性反套话/篇幅区间)+ **公共条款单源插值**
  (CLAUSE_REQUIREMENT_FIRST/CRAFT_VISUAL/CLAUSE_WECHAT_BUDGET 三个常量,防五份
  漂移);CRAFT_VISUAL 按 §13.9 编排开放原则(先定「传达什么信息+用什么形态」,
  形态不设限;数据密集走卡、内容成图走文生图图文、错字一图至多重出一次)。
  场景差异:开源介绍=README 复读反腔+最小上手路径;论文解读=人话点破问题+直觉
  优先+局限边界;教程精炼=准备/步骤/坑/验收手册+第二人称祈使句;周新闻=三行
  速览+分组综述+每条独立可读;价格表=表格主干+计价单位表头+「—」不臆测。
- `WRITING_SKILLS` 注册表自 seed.ts 收编入真相源文件(seed 只管「只补缺」落库;
  已部署环境补技能 = 重跑 seed,幂等)。
- 断链守卫 `writing-guides.test.ts`:TOPIC_PURPOSES.skillKey 全覆盖 WRITING_SKILLS
  (deriveSkillKey 回写库中不存在的 key = 静默劣化,机器拦)+ key 唯一 + 五指南
  公共条款在位。

**验收**:`make check` 绿(typecheck/lint 0 error/1569 tests,新增 3 断言);验收
库 seed 后 7 技能在册(guide_md 1192~3954 字符,公共条款 SQL 抽查通过)。
指南为 DB 资产不进 web bundle,本轮无需重建镜像;生产随批⑤ 发布后重跑 seed。
