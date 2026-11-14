# 站内创作中心瘦身方案（评估）

> 评估日期：2026-11-14 ｜ 状态：**决策已定，B0 起实施**（见 §0.1）
> 方法：现状盘点 → 边界判定 → 目标形态 → 分批拆除（先加后拆）→ 风险 → 决策点
> 范围：`src/lib/agent/`（42 个非测试文件 / 5629 行 + 39 个测试文件 / 6472 行）、`src/app/(admin)/admin/studio/**`、`src/app/(admin)/admin/skills/**`、`src/lib/ai/writing-guides.ts`、`AgentSkill` 表、`src/lib/mcp/**`（现 21 只工具）

---

## 0.1 决策定稿（2026-11-14 用户拍板）

| 决策 | 裁定 | 对方案的直接影响 |
|---|---|---|
| **D1** 前台 FAB / Drawer | **留** | 工具面塌缩为**全员只读 6 只**；`agentToolsFor` 分档删除、`ADMIN_PROMPT_ADDENDUM` 删除、B4 的删除范围据此确定（19 只写工具全删） |
| **D3** 站内 AI 封面 | **留**（改为 HTTP 触发） | **必须新增 `POST /api/posts/cover-candidates`** —— 否则编辑器的「生成封面候选」按钮（100% agent 驱动、全站无 HTTP 触发路由）会失去后端。该路由归 **B1（P0）**；B3 再把 `PostEditor.tsx` 的按钮从 agent 切到该路由。`QUEUE_COVER_GEN` / `cover-generate.ts` / `cover-candidate-store.ts` **保留**（B8 不删） |
| **D5** 创作中心 | **降级保留** | studio 保留为「素材台账 + 写作配置 + 导出给线下」；新增 `GET /api/topics/[id]/export`（B3）；`Topic` 表与 `src/lib/topics/**` 不删 |
| **D7** `agent_skill` 表 | **删除**，站内不留副本 | 真相源 = `skills/writing/*.md`；B7 删表 + 删后台页 + 删 API。**前置**：逐行 diff DB `guideMd` ↔ `writing-guides.ts`（DB 独有内容并入 md）+ `pg_dump` 备份 |

**其余决策按推荐默认执行**（如需改请提出）：D2 deepagents 先留（B6 依据量测再定）、D4 卡片走 `POST /api/cards/render` + MCP `render_card`（B1 P0）、D6 不向 PAT 开放 Topic 只读（导出走会话 HTTP）、D8 skill 真相源 = 仓库 md（本地直读 + MCP 只读兜底）、D9 开批量入库 `/api/posts/bundles`（只落草稿）、D10 不开批量同步公众号、D11 admin 档配额随 B3 降到 user 档、D12 `identity.ts` 不迁出。

**由此确定的两条实施原则**：

1. **B3 关站内生成入口时，封面能力不能断** —— 依赖 D3 的 HTTP 触发路由在 B1 已就位，故 B3 的顺序是「B1 补路由 → B3 切按钮 → B4 删 agent 工具」，封面这条链不出现空窗。
2. **B7 删表前必须先 diff 后备份**（D7 落地为流程硬闸，R5 缓解）。

---


## 0. 结论摘要

| # | 结论 | 一句话理由 |
|---|---|---|
| 1 | **前台 FAB / Drawer 保留**，但工具面从「按身份分档」塌缩为「全员只读」 | `AGENT_SYSTEM_PROMPT`（`agent.ts:34`）明写「站内搜索助手…除 submit_feedback 外不能写入」——它属**读侧能力**，与创作无关。创作入口只是**复用同一张卡**（`StudioActions.tsx:75/:89` 调 `openAgentAssistant`），删创作 ≠ 删卡 |
| 2 | 真正要拆的是 **admin 的 19 只写工具 + 创作中心 UI**，不是 deepagents 运行时 | 问题 1 的「重迭代」来自写侧工具链（write_article → render_card → 生图 → 落库，7~8 步 × 多轮自审），不是只读检索问答 |
| 3 | **写作 skill 是「搬」不是「删」**：真相源从 `writing-guides.ts`（TS 常量）迁到仓库内 `skills/writing/*.md` | 这正是问题 2 的根因：调 skill 要发版。改成 markdown 后，改指南 = 改 git 文件 = 本地立即生效 |
| 4 | MCP 面要补的**第一号缺口是 `render_card`**（HTML→PNG 卡片） | 站内强能力（`src/lib/card/render.ts` → card-renderer sidecar）**只挂在 agent 工具上，无 HTTP 出口**；写作指南「数据密集内容必出卡」的要求，线下目前无法满足 |
| 5 | 拆除按 **9 批 / 8~9 个 PR** 推进，核心是**先加后拆** | B0 先埋 kv 总开关（改配置即回滚），B1 补 MCP → B2 验本地闭环 → B3 关站内生成入口 → B4~B8 分层删 |

**总量口径（粗估）**：删 ≈ 3400 行非测试 agent 代码 + 39 个测试文件；保留 ≈ 2200 行只读运行时；新增 ≈ 900 行 MCP 工具 + 导出/卡片 HTTP 路由。**净减 ≈ 2500 行。**

---

## 1. 目标形态

```
┌──────────────── 线下（Claude Code，创作主场）────────────────┐
│  skills/writing/*.md  ← 写作知识真相源（git 追踪，改 = 改文件，不发版）│
│  Claude Code 写作助手 → 本地生图 / 本地出 HTML → 卡片渲染 → 上传      │
└──────────┬────────────────────────────────────┬──────────────┘
           │ MCP（/api/mcp，21 只 + 新增 ~10 只）  │ HTTP（PAT 双通道）
           │ upsert_article / create_pin          │ /api/posts/bundle
           │ upload_media / sync_*_to_wechat      │ /api/media
           │ render_card(新) / list_skills(新)     │ /api/cards/render(新)
           │ update_pin(新) / list_materials(新)   │ /api/topics/[id]/export(新)
           ▼                                      ▼
┌──────────────── 站内（aitech-hub，瘦身目标）────────────────┐
│ 【保留·管理面】文章管理 /admin/posts · 贴图管理 /admin/pins + 组装台        │
│                素材与封面媒体库 /api/media · 公众号分发 /api/distribute/wechat │
│ 【保留·读侧】公开检索 /topics · /api/search/answer · Drawer 问答（只读）      │
│ 【保留·外部面】/api/mcp（PAT，创作落地口）· /api/posts/bundle                 │
│ 【降级】创作中心 studio → 「素材台账 + 写作配置 + 导出给线下」                │
│ 【移除】站内 AI 生成（write_article / render_card / 生图 / 落库草稿 / 贴图）    │
│ 【移除】agent_skill 表 + 后台技能页 + writing-guides.ts 常量                  │
└──────────────────────────────────────────────────────────────┘
```

### 1.1 FAB / Drawer 的正面回答（最易搞混的边界）

**结论：保留。这是「访客搜索问答」，不是「站内创作」。**

判定依据（三条，均已核实）：

1. **能力边界是只读的**。`src/lib/agent/agent.ts:34-65` 的 `AGENT_SYSTEM_PROMPT` 标题即「你是『一起AI』(17aitech.com)站内搜索助手」，明写「你有六个工具：search_site / read_post / read_repo / get_time / ask_user / submit_feedback」、**「除 submit_feedback 外你不能写入或修改任何数据」**。创作能力全在 `ADMIN_PROMPT_ADDENDUM`（`agent.ts:78-134`），仅 admin 身份追加。
2. **它是站点的对外服务门面**。挂在 `src/app/layout.tsx:46`（全站常驻）与 `src/app/(site)/search/page.tsx` 的 Drawer。删它 = 删访客问答 + 删站内检索的对话入口。
3. **它不与其他 AI 功能耦合**。已核实：公众号私信自动问答走 `src/lib/channel/wechat-mp/answer.ts` → `searchAll` + `chatJsonTask`，**不经 agent 运行时**；`/api/search/answer` 答案卡也是独立路径。删 agent 不影响它们。

**但必须改一处** —— 现状是「工具面按身份分档」（`agentToolsFor(kind)`，`agent.ts:138`）：admin 在前台也会拿到 19 只写工具，这正是「创作混进前台助手」的机制根因。瘦身后：

- 工具面**塌缩为唯一一套只读 6 只**，admin 与 guest 同面 → `agent.ts:138` 的分档函数删除，agent 图缓存从 2 档降为 1 档。
- `ADMIN_PROMPT_ADDENDUM` 整段删除 → 系统提示从 ~90 行降到 ~30 行，**每次 run 的输入 token 降一个量级**（对服务器负载最直接的改善）。
- admin 档配额 `agent.admin.tool_calls=120 / tokens=600k` 可下调至 user 档（12 / 50k）—— 没有长编排任务了。

**创作触发点怎么办**：`StudioActions.tsx:75/:89`（studio 生成按钮）、`EditorAssistant.tsx`（编辑器助手入口）、`PostEditor.tsx:120 launchCoverAgent`（编辑器封面按钮）—— 这三个是**创作入口**，随创作一起下线；FAB 本体不动。

---

## 2. 保留 / 移除 / 降级 三分类清单

### 2.1 创作工具集（移除）—— 拆除即失效

| 文件 | 工具 | 引用者（删除依据） |
|---|---|---|
| `src/lib/agent/write-article-tool.ts` | `write_article` | `agent.ts:32` → `WRITE_ARTICLE_TOOLS`；仅自身测试 |
| `src/lib/agent/topic-draft-tool.ts` | `save_topic_draft` | `topic-tools.ts:180` 转出 → `agent.ts:25` `TOPIC_TOOLS` |
| `src/lib/agent/pin-tool.ts` | `save_topic_pin` / `update_topic_pin` | `agent.ts:22` 直接 import + `agent.ts:146/147` |
| `src/lib/agent/topic-tools.ts` | `get_topic_brief` / `transfer_video_cover` / `generate_cover_candidates` | `agent.ts:25` `TOPIC_TOOLS` |
| `src/lib/agent/topic-brief-tool.ts` | `get_topic_brief` 实现 | 仅 `topic-tools.ts:36` |
| `src/lib/agent/illustrate-tool.ts` | `generate_illustration` | 仅 `topic-tools.ts:34` |
| `src/lib/agent/cover-tools.ts` | `generate_post_cover` | `agent.ts:30` `COVER_TOOLS` |
| `src/lib/agent/card-tools.ts` | `render_card` | `agent.ts:31` `CARD_TOOLS` |
| `src/lib/agent/material-tools.ts` | `search_materials` / `mount_material` / `unmount_material` | `agent.ts:21` `MATERIAL_TOOLS` |
| `src/lib/agent/edit-tools.ts` | `read_draft` / `propose_edits` | `tools.ts:28` 转出 → `agent.ts:31` `EDIT_TOOLS` |
| `src/lib/agent/post-sources-tool.ts` | `get_post_sources` | `agent.ts:23` `POST_SOURCES_TOOLS` |
| `src/lib/agent/skill-tools.ts` | `list_skills` / `get_skill` | `agent.ts:24` `SKILL_TOOLS` |
| `src/lib/agent/wechat-budget-tool.ts` | `measure_wechat_budget` | `agent.ts:26` `WECHAT_BUDGET_TOOLS` |
| `src/lib/agent/admin-thread.ts` | `assertAdminThread` 守卫 | **仅**被上表 12 个写工具引用（已 grep 确认）→ 随写工具整体删 |
| `src/lib/agent/topic-tool-common.ts` | `denyPayload` / `humanizeTopicError` | 仅写工具引用 → 同删 |
| `src/lib/agent/topic-pin-brief.ts` | `buildPinBrief` | 仅 `topic-brief-tool.ts:24` → 同删 |
| `src/lib/agent/poll.ts` | `pollUntil` | 仅 `topic-tools.ts:35` + `cover-tools.ts:39` → 同删 |

**写工具合计 19 只**：`read_draft, propose_edits, get_topic_brief, transfer_video_cover, generate_cover_candidates, generate_illustration, save_topic_draft, save_topic_pin, update_topic_pin, search_materials, mount_material, unmount_material, get_post_sources, write_article, generate_post_cover, list_skills, get_skill, measure_wechat_budget, render_card`。

### 2.2 只读工具（保留）

| 文件/工具 | 处置 | 理由 |
|---|---|---|
| `src/lib/agent/tools.ts` 的 `AGENT_TOOLS`：`search_site` / `read_post` / `read_repo` / `get_time` / `ask_user` / `submit_feedback` | **保留** | 访客问答核心；`read_post` 的 `readPostToolFor(kind)` 门禁分档（guest 预览 / user 登录可读 / admin 全文）需保留 |
| `src/lib/agent/topic-brief-tool.ts` 的 `get_topic_brief` | **降级保留**（改形态） | 内容需求（素材 + 写作配置）改为 `GET /api/topics/[id]/export` HTTP 导出，不经 agent |

### 2.3 agent 运行时（分批降级 → 可选移除）

| 文件 | 处置 | 理由 |
|---|---|---|
| `agent.ts` | **改** | 删 `ADMIN_PROMPT_ADDENDUM`、删工具分档、删 19 只写工具装配 |
| `run.ts` / `checkpointer.ts` / `sessions.ts` / `quota.ts` / `guest-threads.ts` / `admin-sessions.ts` / `model-factory.ts` / `wire.ts` / `sse.ts` / `hitl.ts` / `todos.ts` / `tool-call-repair.ts` / `tool-args-feedback.ts` / `ask-user-guard.ts` / `article-context.ts` / `run-context.ts` / `visitor.ts` / `purge.ts` | **保留**（B5 阶段） | 只读问答的完整骨架 |
| `context-trim.ts` | **可删**（随 B4） | 作用是裁剪 render_card 产出的富 HTML args —— 写工具没了即无输入源 |
| `deepagents` / `langgraph` 依赖 + PG checkpoint 表 | **B6 决策点**（非必删） | 需先量测实际负载 |

### 2.4 Skill 层

| 对象 | 处置 |
|---|---|
| `src/lib/ai/writing-guides.ts`（7 个 skill + `CRAFT_ILLUSTRATION_PLAN`） | **搬**：内容迁 `skills/writing/<key>.md`，TS 常量文件删除 |
| `AgentSkill` 表（`prisma/schema.prisma:1644`） | **删**（migration，B7） |
| `src/app/api/agent-skills/**`（3 个路由） | **删** |
| `src/app/(admin)/admin/skills/page.tsx` | **删** |
| `src/lib/ai/agent-skills-admin.ts` | **删** |
| `Topic.skillKey`（schema:1593） | **保留软引用**（导出给线下时携带 skillKey） |

### 2.5 创作中心 UI

| 文件 | 处置 |
|---|---|
| `src/app/(admin)/admin/studio/page.tsx` + `studio/[id]/page.tsx` | **降级**：保留为「素材台账 + 写作配置 + 导出」，删生成按钮 |
| `src/components/admin/studio/StudioActions.tsx` | **改**：生成按钮 → 「导出素材包给线下 Claude Code」 |
| `StudioGenerationProvider.tsx` / `GenerationProgressCard.tsx` / `ArticleOutputCard.tsx` / `PinOutputsGrid.tsx` | **删**（生成态轮询与产出卡） |
| `PinConfigPanel.tsx` / `ReferenceRail.tsx` / `MaterialRail.tsx` / `TopicWritingConfigPanel.tsx` / `StudioMaterialModal.tsx` | **保留**（配置与素材管理） |
| `src/app/api/topics/**`（5 个路由） | **保留 + 加 1 个**（`[id]/export`） |

### 2.6 前台 agent UI（保留，去写侧）

| 文件 | 处置 |
|---|---|
| `src/components/site/agent/AgentDrawer.tsx` / `AgentThread.tsx` / `AgentRuntimeProvider.tsx` / `runtime-adapter.ts` | **保留** |
| `src/components/site/assistant/AssistantFab` / `AssistantCard.tsx` | **保留** |
| `src/components/site/agent/CoverCandidatesCard.tsx` | **删**（agent 专属封面卡） |
| `src/components/site/agent/ProposeReviewCard.tsx` / `ProposeUnavailableCard.tsx` | **删**（提案评审面） |
| `src/lib/content/proposal-apply.ts` | **删**（消费方只有 `ProposeReviewCard.tsx:22`，见 §6.2 纠偏） |
| `src/components/admin/editor/EditorAssistant.tsx` | **删**（编辑器助手入口 = 创作入口） |
| `src/components/admin/editor/PostEditor.tsx` 的 `launchCoverAgent` / `COVER_ADOPTED_EVENT` 监听 | **改**：封面按钮改走新的 HTTP 路由（D3） |

### 2.7 API 路由

| 路由 | 处置 |
|---|---|
| `/api/search/agent/**`（threads / runs/stream / state） | **保留**（只读问答） |
| `/api/agent-sessions/**` + `/admin/usage/sessions` | **保留**（后台会话审计） |
| `/api/topics/**` | **保留 + 加 export** |
| `/api/media` / `/api/posts/bundle` / `/api/posts/**` / `/api/pins/**` / `/api/illustration/**` / `/api/distribute/wechat/**` | **全部保留** |
| `/api/mcp` | **保留 + 扩容** |
| **新增** `POST /api/cards/render` | **加**（card-renderer 暴露） |
| **新增** `POST /api/posts/cover-candidates` | **加**（若 D3 选「留站内封面生成」） |
| **新增** `GET /api/topics/[id]/export` | **加** |

### 2.8 基建

| 对象 | 处置 |
|---|---|
| PG checkpoint 表（框架自管 DDL） | 随 deepagents 保留则留；B6 删则 drop |
| `search_agent_session` 表 | 保留（只读问答会话） |
| Redis 配额 / 游客归属 | 保留 |
| `ai_model` / `ai_task_binding`（role=search/writing/illustrate） | `writing` 角色绑定的**消费方是 write_article**，删后可退；`illustrate` 仍被 `/api/illustration/**` 用 → **保留** |
| `ai_usage_log`（role=search_agent） | 保留（量测 B6 依据） |
| BullMQ `QUEUE_COVER_GEN` | 视 D3；`QUEUE_ILLUSTRATION_STUDIO` **必须保留**（HTTP 消费方 `/api/illustration/generate`、`/api/pins/[id]/generate`、`/api/illustration/studio/*`） |
| `site_config` 的 `agent.*` 六键 | 保留，但 `agent.admin.*` 下调（B3 后 admin 无长任务） |
| `services/card-renderer` sidecar | **保留**（HTTP 暴露后线下也能用） |

---

## 3. 写作 skill 的去向（目标 2 的正面回答）

### 3.1 结论：**搬，不删**

站内 `agent_skill` 表 + `writing-guides.ts` 的 7 个 skill **必须活着**，只是换了住处和消费者。

### 3.2 真相源与去处

| 项 | 决定 |
|---|---|
| **唯一真相源** | 仓库内 `skills/writing/<key>.md`（纯 markdown + YAML frontmatter：`key` / `name` / `scenario` / `version`） |
| **线下消费** | Claude Code 直接 `Read` 该文件（`.claude/skills/` 下放**一个**索引型 skill `writing-assistant`，其 SKILL.md 列出 7 个 key 的场景映射，指示按场景读对应 md） |
| **站内消费** | 删除 `agent_skill` 表 + 后台页 + API；**不在站内保留副本** |
| **异地 agent 兜底** | MCP 可选新增只读 `list_skills` / `get_skill`，从 `skills/writing/*.md` 读（**部署镜像内副本，可能滞后于本地 checkout**，仅作兜底） |

**为什么不做「两个消费端各自维护一份」**：那会重演今天 `writing-guides.ts` ↔ `agent_skill` 表的双副本漂移（`seed.ts` 落库、后台可手改、TS 常量不回写）。

**为什么不做「MCP 供 skill、站内不再有」**：那样 skill 变更要等镜像重建，问题 2 原封不动回到身上。

### 3.3 供给机制（谁负责同步、版本怎么管）

| 问题 | 答案 |
|---|---|
| 谁同步 | **无人自动同步**。skill 文件在 git 里，Claude Code 在本地仓库工作副本直接读。改 skill = 改文件 + commit，不需要任何同步任务 |
| 版本 | git commit/tag 为准；frontmatter `version` 供人类识别；`skills/writing/INDEX.md` 维护 7 个 key 的一览与适用场景 |
| 站内还留副本吗 | **不留**。唯一例外是 MCP 兜底通道读**镜像内**的文件副本，README 里注明「以本地 checkout 为准」 |
| 启动前校验 | 加一条单测：`skills/writing/` 的 key 集合 == `TOPIC_PURPOSES.skillKey` 全集（沿用今天 `WRITING_SKILLS` 覆盖守卫的思路，只是真相源从 TS 换成 md + 轻量 frontmatter 解析） |

### 3.4 迁移动作（内容工作，不是机械搬运）

7 个指南的**文本必须重写**，不是复制：

| 指南 | 今天写的工具 | 线下对应 | 改法 |
|---|---|---|---|
| `blogger-video` | `render_card` / `generate_illustration` / `save_topic_draft` | 本地渲染卡片 → 上传 → `upsert_article` | 工具名全替换为「本地动作 + MCP 工具名」 |
| `card-rendering` | `render_card`（自由 HTML） | `POST /api/cards/render` 或本地出图 | 保留版式语汇（最有价值的部分），改工具指向 |
| `open-source-intro` / `paper-interpret` / `tutorial-refine` / `weekly-news` / `model-pricing` | 纯文本纪律 | `upsert_article` | 基本可直迁，去掉工具名即可 |
| `CRAFT_ILLUSTRATION_PLAN`（公共条款） | 被 6 个指南插值 | 同 | 改为 `skills/writing/_common.md` + 引用，或直接内联到各文件 |

**顺带解决的一个隐患**：今天指南文本里内嵌了大量「系统提示」级纪律（「严禁编造」「先自评审至多 2 轮」），这些在 `ADMIN_PROMPT_ADDENDUM`（`agent.ts:78-134`）里**也有一份**——两份都要改。删 agent 后只剩指南一份，纪律归位。

---

## 4. MCP 面要补什么

现状 21 只：`search_site` `list_hot_topics` `list_signals` `get_telegram_item` `get_video_play_url` `list_categories` `get_wechat_config` `upsert_article` `upload_media` `get_article` `list_articles` `copy_article_wechat_format` `render_wechat_preview` `sync_article_to_wechat` `get_distribute_job` `create_pin` `add_pin_images` `set_pin_status` `sync_pin_to_wechat` `get_pin` `list_pins`

### 4.1 必须补（阻塞「完全替代站内创作」）

| 优先级 | 缺口 | 现状 | 建议 |
|---|---|---|---|
| **P0** | **卡片渲染 `render_card`** | 站内强能力只挂在 agent 工具（`card-tools.ts` → `src/lib/card/render.ts` → card-renderer sidecar），**无 HTTP 出口**；MCP 无对应工具 | 新增 `POST /api/cards/render`（multipart: html + 宽高 → 返回 `/wp-content/uploads/...png`）+ MCP `render_card`。**否则指南里「数据密集内容必出卡」的要求线下无法执行** |
| **P0** | **写作 skill 供给 `list_skills` / `get_skill`** | agent 独占（`skill-tools.ts`） | 从 `skills/writing/*.md` 读；线下以本地文件为主，MCP 为兜底 |
| **P0** | **贴图改稿 `update_pin`** | agent 有 `update_topic_pin`（`pin-tool.ts:113`），MCP **没有** | MCP 补 `update_pin`（标题/轻文字/阅读原文/裁剪档），口径复用 `pins/repo.ts#updatePin` 的 synced/published 拒直编 |
| **P1** | **素材接地 `list_materials` / `get_material` / `search_materials`** | MCP 只有 `get_telegram_item`（单条元数据）与 `search_site`；agent 独占 `search_materials` | MCP 补只读三只（telegram 已解读 + 历史文章 + 视频笔记全文）。**这是「素材纪律」能否迁到线下的关键** |
| **P1** | **批量整包入库** | `/api/posts/bundle` 只收**一篇** .md（`bundle-import.ts`） | 扩 `POST /api/posts/bundles`（多篇 md + 图池 → 逐篇落草稿 → 返回每篇 postId + 入库状态）。**批量同步公众号仍不开**（守 arch §3.6 红线） |
| **P1** | **产出可见 `list_drafts`** | `list_articles` 有 `status: draft` 但混入 published 列表 | 补 `list_drafts`（只列草稿 + origin + updatedAt），供线下 agent 确认「我的稿落库了吗」 |

### 4.2 建议补（可观测 / 可诊断）

| 缺口 | 建议 |
|---|---|
| **错误可诊断** | 现在各 handler 返回 `json({...})`，错误语义不统一。新增统一错误形状：`{ok:false, code:"POST_SLUG_CONFLICT"|"MEDIA_TOO_LARGE"|"PIN_STATUS_ILLEGAL", message, retryable, hint}`。**低成本、高收益** —— 线下 agent 靠这个自纠 |
| **进度可见** | 批量入库返回 jobId + `GET /api/jobs/[id]` 轮询；公众号同步已有 `get_distribute_job`（同源 `distribute/job-query.ts`，别重写） |
| **`get_post` 详情** | 现有 `get_article` 是否返回正文/落库校验错误需确认；缺则补（供线下核对落库结果） |
| **站内封面生成触发** | 视 D3。若「留站内 AI 封面」，加 `POST /api/posts/cover-candidates` + MCP `generate_post_cover`（**这是唯一会重新引入「站点内生图计费」的通道，须显式决策**） |
| **PAT 生命周期** | 已有 `/api/pats`（签发/吊销）。线下多机使用建议每机一枚 PAT，便于吊销与审计 —— **文档化即可，无需新代码** |

### 4.3 明确不补（守既有红线）

- ❌ 批量同步公众号（arch §3.6 M72 裁定 3：一次 30 篇无人审内容进草稿箱，人工审阅成本放大 30 倍）
- ❌ `create_pin` 带 `topicId`（红线 2：PAT 不得操纵创作域）
- ❌ 在线文生图工具（红线 1：图字节不过模型上下文；且与「线下本地生成」目标一致）

---

## 5. 拆除顺序与批次（每批一个 PR）

> 原则：**先加后拆**。B1/B2 不删任何东西，先证明「MCP + 线下 Claude Code 能独立完成一整条创作闭环（素材 → 写作 → 配图/卡片 → 入库草稿 → 公众号草稿箱 → 人工发布）」，再在 B3 关站内生成入口。

| 批次 | 内容 | 风险 | 回滚方式 | 依赖前置 | 验收 |
|---|---|---|---|---|---|
| **B0** | **埋总开关**：`site_config` 新增 kv `creation.agent_enabled`（默认 `true`）；`agent.ts` 在开关关时只装配只读工具面 | **低** | 改 kv 即回滚（无需发版） | 无 | 开关关：admin 在 FAB 能问答、任何写工具不可用；开关开：行为零变化 |
| **B1** | **MCP 补缺**：P0 三项（`render_card` + `/api/cards/render`、`list_skills`/`get_skill`、`update_pin`）+ P1 三项（素材三只、`/api/posts/bundles`、`list_drafts`）+ 统一错误形状 | **低**（纯新增） | revert PR | 无 | 21→约 30 只工具；每只工具单测 + `tools/list` 快照更新 |
| **B2** | **写作 skill 迁移**：`skills/writing/*.md`（7 个，**内容重写**）+ `INDEX.md` + `.claude/skills/writing-assistant/SKILL.md`；key 覆盖守卫单测 | **低**（纯新增，站内不动） | revert PR（站内容认未变） | 无 | 本地 Claude Code 读 skill → 产出 1 篇合规稿 → bundle 入库 → 后台草稿池可见 |
| **B3** | **关站内生成入口**：① 线上 kv `creation.agent_enabled=false`；② `StudioActions.tsx` 生成按钮 → 「导出素材包」；③ `EditorAssistant.tsx` 下线；④ `PostEditor.tsx` 封面按钮改走 HTTP（或临时下线）；⑤ 新增 `GET /api/topics/[id]/export` | **中** | kv 置回 `true` 恢复原按钮（页面需保留旧分支代码） | B1 + B2 | 站内无任何 AI 生成入口；线下闭环端到端跑通 1 次文章 + 1 组贴图；`ai_usage_log` role=search_agent 的 admin 档归零 |
| **B4** | **删写工具集**：2.1 表中 17 个文件 + 19 只工具 + `ADMIN_PROMPT_ADDENDUM` + 相关测试（~20 个 test 文件）+ `agent.ts` 工具分档简化 | **中**（纯删除，但触及 prompt parity 单测） | revert PR | B3 | `agentToolsFor` 只剩只读 6 只；门禁全绿；`grep -rn "deepagents" src/` 只剩 `agent.ts:11` |
| **B5** | **收窄运行时为只读**：admin 档配额下调；`context-trim.ts` 删除；`ai_task_binding` role=writing 解绑 | **低-中** | revert PR | B4 | Drawer 访客问答 e2e 绿；admin 身份在 FAB 只读（可发起写工具请求但被拒） |
| **B6**（**可选**） | **评估是否移除 deepagents**：先量测（`ai_usage_log` role=search_agent 近 30 天 run 数/耗时/token），再决定 A. 保留 deepagents 只读 / B. 换薄 tool-calling 循环 / C. 只留 `/api/search/answer` 答案卡 + 简化 Drawer | **高** | 独立 PR，回滚 = 换回 deepagents（graph 缓存按 key 切换） | B5 + 量测数据 | 三选一有明确数据支撑；Drawer 多轮追问与引用能力不丢 |
| **B7** | **删 skill 层**：`AgentSkill` 表 drop（`prisma migrate dev --create-only`）+ `agent-skills-admin.ts` + `/api/agent-skills/**` + `/admin/skills` 页 + `writing-guides.ts`（若 `seed.ts`/oneoff 仍引用则同批改） | **中** | 迁移 forward-only，**回滚需反向迁移**（故前置：先 `pg_dump` 该表备份到 `workspace/backups`） | B2 + **DB 备份已做** | 表不存在；门禁绿；后台无残留入口 |
| **B8** | **收尾**：视 D3 处理 `QUEUE_COVER_GEN` + `cover-generate.ts` + `cover-candidate-store.ts` + `cover-prompt-suggest.ts`；`ai_task_binding` role=writing 清理；`site_config` `agent.admin.*` 调档；`docs/arch/04-ai-agent.md` + `CLAUDE.md` + `docs/plan/development-plan.md` 同步 | **中** | revert PR；DB 侧无变更 | B7 | 队列/worker 无孤儿 job；文档与代码口径一致 |

### 5.1 安全网设计（「先加后拆」的三道网）

1. **B0 的 kv 开关 = 熔断闸**：B3~B5 期间任何异常，把 `creation.agent_enabled` 置回 `true` 即恢复站内生成（页面上旧按钮代码保留在 PR-3 的开关分支里，直到 PR-4 删除）。
2. **B1/B2 的「闭环验收件」 = 离线回归剧本**：固定一份 5 步剧本（选 skill → 读素材 → 出稿 → 出卡/出图 → 上传入库 → 同步公众号草稿 → 后台人工发布），每批都跑；剧本文件放 `docs/standard/` 或 `tests/e2e/`。
3. **B3 前的人工确认**：先用线下闭环**真实产出 3~5 篇**（含 1 组贴图）并走完人工发布，确认质量与流程不劣于原站内生成，才关站内入口。

---

## 6. 不可拆 / 需谨慎的部分

### 6.1 `src/lib/agent/identity.ts` —— **绝对不能删**

外部引用 8 处（已 grep 全量确认）：

| 引用方 | 性质 |
|---|---|
| `src/app/api/post-like/route.ts:9` | `attachIdentityCookie` + `resolveAgentIdentity` |
| `src/app/api/comment-like/route.ts:7` | 同上 |
| `src/app/api/post-comments/route.ts:9` | `resolveAgentIdentity` |
| `src/lib/comment/like-service.ts:12` | `import type { AgentIdentity }`（纯类型） |
| `src/app/api/search/agent/threads/route.ts:14` 等 4 处 agent 路由 | agent 内部 |

**处置**：**原地保留**。最坏情况（若 B6 决定砍掉整个 agent）也只删 agent 内部 4 处引用，**`post-like` / `comment-like` / `post-comments` / `like-service` 四处必须保留**。它虽住在 `lib/agent/` 下但职责是「全站匿名/登录身份」，与 agent 运行时无关。

**建议（可选）**：B8 把它迁到 `src/lib/auth/identity.ts` 或 `src/lib/visitor/identity.ts` —— **纯搬家不是删除**，且要同批改 4 个 import 路径。建议 **B8 可选做，优先级低**，避免「删顺手删错」。

### 6.2 `src/lib/agent/edit-proposal.ts` —— **原判断需纠偏**

原判断说「编辑器『应用提案』落库链路」依赖它。核实结果：

```
edit-proposal.ts 的全部外部引用：
  src/components/site/agent/ProposeUnavailableCard.tsx:15
  src/components/site/agent/ProposeReviewCard.tsx:21
  src/components/site/agent/AgentThread.tsx:14
  src/lib/content/proposal-apply.ts:11   ← 仅 import type { ProposeEditsEdit }（纯类型）
proposal-apply.ts 的全部消费方：
  src/components/site/agent/ProposeReviewCard.tsx:22   ← 唯一
```

**即：提案链路的两端都在 agent UI 目录内**（agent 卡 → 评审卡 → `proposal-apply` 定位 → 回写编辑器 textarea → 人工点保存落库）。**没有独立的编辑器侧落库通道依赖它**。

**处置**：`edit-proposal.ts` + `proposal-apply.ts` + `ProposeReviewCard` + `ProposeUnavailableCard` **整体删除**（B4），无人受阻。`propose_edits` 工具随之消失 —— 线下改稿由 Claude Code 直接改 markdown 后 `upsert_article`（slug 幂等覆盖）完成，或人工在后台编辑器改。

### 6.3 `src/lib/agent/cover-tool.ts` —— **需谨慎，且是真实的站点功能损失**

外部引用 4 处：

| 引用方 | 性质 |
|---|---|
| `src/components/admin/editor/PostEditor.tsx:17` + `:227/228` | 监听 `COVER_ADOPTED_EVENT` 刷新封面 —— **唯一非 agent 消费方** |
| `src/components/site/agent/CoverCandidatesCard.tsx:19/:71` | agent 卡内的封面候选卡（随 agent 删） |
| `src/components/site/agent/AgentThread.tsx:15` | 解析 interrupt 载荷 |
| `src/app/api/search/agent/threads/[threadId]/runs/stream/route.ts:19` | 中断载荷白名单 |

**处置**：`cover-tool.ts` 本身是**零依赖契约文件**（只定义常量 + 解析函数），删掉不影响 `src/lib/ai/cover-generate.ts` 的生图核心。**但 `PostEditor` 的「生成封面候选」按钮会失去后端** —— 因为**全站没有任何 HTTP 路由能触发封面生成**（已核实：`/api/posts/cover-candidates/` 下只有 `[id]/raw` 取图路由，无触发路由；封面生成 100% 由 agent 工具发起）。

→ **必须走 D3 决策**：要么 (a) 新增 `POST /api/posts/cover-candidates` 让编辑器保留一键生成（**推荐**），要么 (b) 封面改为线下本地生成后随 bundle 的 `cover:` frontmatter 上传（`bundle-import.ts` 已支持），站内 AI 封面能力彻底退役（连带可删 `QUEUE_COVER_GEN`、`cover-generate.ts`、`cover-candidate-store.ts`、worker job、`cover-prompt-suggest.ts`）。

### 6.4 「看起来像 agent 但不是」清单

| 文件 | 为什么不能顺手删 |
|---|---|
| `src/lib/ai/cover-generate.ts` | 被 `cover-tools.ts`（删）**和**未来的 HTTP 触发共用 —— 是**执行核心**，不是 agent 专属 |
| `src/lib/ai/illustration-generate.ts` / `illustration-studio.ts` / `illustration-edit.ts` | HTTP 消费方：`/api/illustration/generate`、`/api/pins/[id]/generate`、`/api/illustration/studio/*` —— **必须保留** |
| `src/lib/card/render.ts` | card-renderer HTTP 客户端 —— 保留（改由 `/api/cards/render` 调用） |
| `src/lib/topics/compose.ts`（`finalizeCompose`） | agent 的 `save_topic_draft` 走它；但它同时是 `topics/repo` 的落库实现 —— **保留**（只删调用方） |
| `src/lib/pins/assemble.ts`（`createPinWithImages`） | agent 与 MCP **共用** —— **保留**（只删调用方） |
| `src/lib/ai/usage-log.ts` | 多方共用 —— 保留 |
| `src/lib/queue.ts` | `QUEUE_ILLUSTRATION_STUDIO` 有 HTTP 消费方 —— 保留；`QUEUE_COVER_GEN` 视 D3 |

### 6.5 双入库路径（`topics/compose.ts#finalizeCompose` vs `content/publish-api.ts`）

- `save_topic_draft` → `topics/compose.ts#finalizeCompose` → 建/更新 `content_post` + 关联 `Topic.linked_post_id` + 建 `TopicItem` 关联
- MCP `upsert_article` → `content/publish-api.ts` → 建/更新 `content_post`（slug 幂等，恒落草稿）

**处置**：两条路径**并存但不冲突** —— 它们写同一张 `content_post` 表的不同列组（compose 还写 topic 关联与素材关联）。agent 路径删除后只剩 MCP 路径，**compose.ts 的 `finalizeCompose` 是否还有调用方需在 B4 确认**（若只被 `save_topic_draft` 调用，则随之退化为死代码，一并删；若 `/api/topics` 也在用，则保留）。**这一项必须实测 grep 后再定，不预设。**

### 6.6 前台搜索问答能力 —— 保留但设「降级护栏」

B5 之后 agent 只读，护栏三闸（arch §3.4）继续生效；`agent.admin.*` 档位下调。**风险是访客问答变慢/变钝**（只读工具原本就给访客用，不变）。真正变化的是：**admin 身份不再有额外能力** → 前台 FAB 对所有人是同一个助手，行为更可预期。

---

## 7. 风险清单

| # | 风险 | 概率 | 影响 | 缓解 |
|---|---|---|---|---|
| R1 | **访客体验退化**：删工具面时误删只读工具，或 B6 砍 deepagents 后 Drawer 失去多轮追问 | 中 | 高（访客留存 + SEO 入口） | 只读 6 只**逐只白名单**删除；B6 前先用 `ai_usage_log` 量化实际 run 量与用户反馈；B6 独立 PR + 独立回滚开关 |
| R2 | **SEO/内容供给断档**：站内生成停了，线下生产节奏跟不上 → 新文章断供 | **高** | 高（SEO 是生命线） | B3 前先用线下闭环**真实产出 3~5 篇并发布**；B3 后设**内容供给看板**（每周新增原创篇数），低于阈值则熔断（kv 置回 true） |
| R3 | **发帖节奏变化**：线下创作是「人触发」，站内是「点按钮」，节奏可能显著变慢 | **高** | 中 | 把线下流程做成**半自动**：Claude Code + MCP + 定时触发（如每周固定跑一次选题→成稿→落草稿），人工只做审阅；`list_signals` 增量信号已支持轮询 |
| R4 | **既有草稿/topic 数据安置** | 中 | 中 | 草稿是 `content_post`，**完全不受影响**（MCP/后台照常读写）；`Topic` 表**保留降级**不删（见 D5），确需归档时先导 CSV |
| R5 | **`agent_skill` 表数据归属**：DB 里的 `guideMd` 可能被后台手改，与 `writing-guides.ts` 漂移，删表即丢内容 | **高**（漂移几乎必然发生） | 高 | **删表前逐行 diff DB `guideMd` ↔ `writing-guides.ts`**，DB 独有内容并入 `skills/writing/*.md`；`pg_dump` 备份到 `workspace/backups/agent_skill_<date>.sql` |
| R6 | **卡片能力断链**：MCP 无 `render_card`，线下无法出「信息卡」，文章视觉质量断崖 | **高**（必现） | 高 | B1 的 P0 头号项；或退而求其次：线下本地出图 → `/api/media` 上传（B4 后 `/api/cards/render` 未上线时的兜底） |
| R7 | **封面能力断链**（同 6.3） | 中 | 中 | D3 决策；兜底：bundle 的 `cover:` frontmatter |
| R8 | **指南重写引入语义漂移**：7 个指南从「agent 工具语境」改到「本地工具语境」，改错一条纪律 → 文章质量下滑 | 中 | 中 | B2 逐条重写 + 与旧文本做**条款级 diff 复核**；B3 后首月 A/B：同题材对比「站内产出 vs 线下产出」 |
| R9 | **双写/双入库混乱**：agent 与 MCP 同时可写 `content_post`，产生两条来源的稿 | 低 | 中 | B3 关站内生成后只剩一条路；B3 前用 `origin` 字段（`ai_assisted` / `ai_generated`）区分追溯 |
| R10 | **PG checkpoint 遗留**：B6 若删 deepagents，`PostgresSaver` 自管的表需手工清理 | 低 | 低 | 框架自管 DDL 不进 migrations，删框架后表残留无害；清理由一次性脚本处理并记录 |
| R11 | **`QUEUE_ILLUSTRATION_STUDIO` 误删**：它是 HTTP 面在用的 | 低 | **高**（贴图组装台瘫） | B8 明确列为「必须保留」；删前 grep 消费方 |
| R12 | **回滚路径断裂**：`AgentSkill` 表 drop 是 forward-only 迁移 | 中 | 中 | 前置 `pg_dump`；B7 单独 PR，不与代码删除混批 |
| R13 | **下游依赖 PAT 的外部 agent**：已有 workbuddy/codex 等在用 21 只工具 | 中 | 中 | **B1 只增不改**：现有工具签名与行为**冻结**；新增工具另起；`SERVER_INSTRUCTIONS` 文本变更需在 PR-1 末尾单列并公告 |
| R14 | **P6 决策拖延**：B6 迟迟不决，deepagents 依赖与 PG checkpoint 长期滞留 | 中 | 低 | B6 给出**明确判定截止条件**（量测数据 + 一次决定），不做「待定」状态 |

---

## 8. 工作量与收益粗估

> ⚠️ 全部为**粗估**（1 人日 = 1 名熟悉本仓库的全栈工程师 1 个工作日），不含需求澄清、评审等待、线上灰度观察期。误差 ±30%。

### 8.1 工作量

| 批次 | 内容 | 人日（估） |
|---|---|---|
| B0 | kv 开关 + 工具面分档简化 | **1** |
| B1 | MCP 补 9~10 只工具 + 3 个 HTTP 路由 + 统一错误形状 + 单测 | **5~7** |
| B2 | 7 个指南重写 + INDEX + 本地 skill + 守卫单测 + 端到端验证 | **5~8**（内容工作占 3~5） |
| B3 | 关生成入口 + studio 降级改造 + topics export + 编辑器封面改造 | **3~5** |
| B4 | 删 17 个 agent 文件 + 19 只工具 + ~20 个测试文件 + 提示词瘦身 | **4~6** |
| B5 | 只读运行时收窄 + 配额下调 + 清理 | **2~3** |
| B6（可选） | 换薄 tool-calling 循环或退到答案卡 | **6~10** |
| B7 | skill 层删除 + 迁移 + 文档同步 | **3~4** |
| B8 | 队列/绑定/文档收尾 | **2~3** |
| **合计（不含 B6）** | | **25~37** |
| **合计（含 B6）** | | **31~47** |

### 8.2 收益

| 维度 | 现状 → 目标 | 说明 |
|---|---|---|
| **代码量** | `src/lib/agent` 5629 行 → ≈2200 行（只读骨架）；净减 ≈3400 行 + 39 个测试文件 | 删的是**最难维护**的部分（19 只工具 + 5 个 middleware 的组合爆炸） |
| **服务端负载** | admin 档 run：120 tool calls / 600k tokens → 只读问答（≤12 calls / 50k）；系统提示 90 行 → 30 行 | **这是问题 1 的直接答案**：重迭代生成（7~8 步 × 多轮自审 × 大 HTML 卡 8~12k token/轮）全部离开服务器 |
| **站点生图计费** | 若 D3 选 (b)，站点侧文生图调用归零；若选 (a)，保留封面单图 | 生图是最贵的一环（10~60s/张，按张计费） |
| **迭代速度** | 调写作 skill：改 TS → seed 落库 → 构建镜像 → 发版 → 改指南 → **再走一遍** → 改指南正文需发版 | 改为：改 `skills/writing/*.md` → commit → 本地立即生效 |
| **扩展性** | 加一个创作能力 = 加一只 agent 工具 + 改系统提示 + 改 prompt-parity 单测 + 发版 | 改为：加一个 MCP 工具（客户端侧）或改一行 markdown |
| **发布节奏** | 创作能力与站点发布节奏强耦合（改 skill 必须发版） | 解耦：创作能力迭代不再触发站点发版 |

### 8.3 成本对照（粗估）

- 一次性：B0~B5、B7~B8 ≈ **25~37 人日**；含 B6 ≈ **31~47 人日**
- 持续节省：agent 运行时维护（每次框架升级的适配）预期显著下降；写作指南迭代周期从「天」降到「小时」
- **不省钱的地方**：MCP 工具多了、线下 Claude Code 需要订阅成本（用户侧）、站点生图若走 D3(a) 仍照旧计费

---

## 9. 迁移后仍留在站内的「创作相关」职责清单（防删过头）

**这 9 项必须留下**，它们是「管理/分发」而非「生成」：

| # | 职责 | 落点（保留） |
|---|---|---|
| 1 | **稿件入库**（草稿落库、slug 幂等、前置元数据、封面路径、分类/标签、作者归属 `content_post.author_id`） | `src/lib/content/publish-api.ts`（`upsertArticle`）+ `bundle-import.ts` + `/api/posts/bundle` + `/api/posts` |
| 2 | **人工审核与发布**（草稿池、发布/下架、SEO 字段、原创/AI 标识筛选） | `src/app/(admin)/admin/posts/*` + `src/lib/content/posts.ts:32` + `origin` 筛选 |
| 3 | **文章编辑**（后台富文本编辑、人工改稿、封面选用、标签/分类） | `src/app/(admin)/admin/posts/*` + `src/components/admin/editor/*` |
| 4 | **封面素材**：媒体库 + sha1 去重 + 封面路径绑定；**可选**保留站内 AI 封面生成（D3） | `src/lib/media/service.ts` + `/api/media` + `src/lib/ai/cover-generate.ts`（若 D3=a） |
| 5 | **贴图管理与组装台**（图片序列、裁剪档、轻文字、状态机 draft→pending→synced→published） | `src/app/(admin)/admin/pins/*` + `src/lib/pins/constants.ts:8` + `pins/assemble.ts` + `/api/pins/**` + `/api/illustration/**` |
| 6 | **公众号分发**（草稿箱同步、预览、批量、复制、排版、渠道尾注） | `src/lib/distribute/**` + `/api/distribute/wechat/{sync,batch,preview,copy}` + `wechat-config` |
| 7 | **素材台账**（电报/视频解读、素材挂载、写作配置、参照图库） | `src/lib/topics/**` + `/api/topics/**` + `/admin/studio`（降级）+ `writing_sample_image` 表 |
| 8 | **外部创作入口（MCP + PAT）** | `src/lib/mcp/**` + `/api/mcp` + `/api/pats` |
| 9 | **读侧检索与访客问答** | `src/lib/search/**` + `/api/search/answer` + `/api/search/agent/**`（只读）+ Drawer |

**明确「不留在站内」的（对照）**：正文生成（write_article）、信息卡渲染（render_card，**但渲染能力留在站内供线下调用**）、文生图（generate_illustration，**但生图管线与队列留在站内**）、站内封面候选 HITL（若 D3=b）、技能后台管理（agent_skill 表 + 页面）、专题文章自动合成流程。

> 一句话区分：**「生成内容的动作」移到线下；「承载内容的容器、管道与闸门」全部留在站内。**

---

## 10. 决策点清单（D1/D3/D5/D7 已拍板，其余按推荐默认）

| # | 决策 | 推荐 | 理由 | 不选的后果 |
|---|---|---|---|---|
| **D1** | **前台 FAB/Drawer 留否？** | **【已定】留**（降级为全员只读问答） | 它是读侧访客能力（`AGENT_SYSTEM_PROMPT` 明确定位），与创作无关；公众号私信问答不依赖 agent | 删 → 访客失去站内问答入口、检索转化路径断裂；需另做搜索 UI，工作量 +3~5 人日且体验降级 |
| **D2** | **deepagents 运行时留否？** | **先留**（B5 后量测再定 B6，不预设） | 只读问答用 deepagents 偏重但稳定；B6 风险最高且收益依赖真实负载数据 | 现在就删 → 可能误伤访客问答且无法回退；拖太久 → 依赖与 PG checkpoint 长期滞留 |
| **D3** | **站内 AI 封面生成留否？** | **【已定】留，但改为 HTTP 触发**（`POST /api/posts/cover-candidates`），不经 agent | 编辑器的「生成封面候选」按钮 100% agent 驱动（全站无 HTTP 触发路由）；封面是站点自有能力，不是「重迭代创作」 | 选「删」 → 编辑器封面按钮消失、封面纯靠线下生成上传，站内生图能力与 `QUEUE_COVER_GEN` 一并退役（B8 多 2~3 人日）；选「照旧留 agent」 → 与瘦身目标冲突 |
| **D4** | **卡片渲染（render_card）如何供给线下？** | **新增 `POST /api/cards/render` + MCP `render_card`**（B1 P0 首项） | 站内强能力目前只挂在 agent 工具上；写作指南「数据密集内容必出卡」是质量底线 | 不补 → 线下文章视觉质量断崖（信息卡是本站标志性呈现），`card-rendering` skill 变成废纸 |
| **D5** | **Topic / 创作中心留否？** | **【已定】降级保留**为「素材台账 + 写作配置 + 导出给线下」，**不删表**；新增 `GET /api/topics/[id]/export` | Topic 承载「素材接地」这一独特资产（已解读视频笔记、批注、参照图库），线下无法替代；且 arch 红线是 PAT 不得**操纵**创作域，读/导出不违规 | 删 → 素材接地能力彻底丢失，线下只能从零找素材（内容断档）；且 `/api/topics/**` 5 个路由 + `src/lib/topics/**` + studio 组件全废，收益不抵风险 |
| **D6** | **MCP 是否开放 Topic 只读（`list_topics` / `get_topic_brief`）？** | **不开放**（导出走 admin session 的 HTTP） | 严守 arch §3.6「PAT 不得操纵创作域」这条已拍板的红线，避免为便利破例 | 开放 → 破红线先例，线上 PAT 一旦泄漏即暴露创作域读权限 |
| **D7** | **`agent_skill` 表删否 / 站内留副本？** | **【已定】删表 + 删后台页 + 不留副本**；真相源 = `skills/writing/*.md` | 表内容与 `writing-guides.ts` 是双副本，必然漂移（后台可手改不回写）；这就是「改 skill 要发版」的机制来源 | 留表 → 漂移继续，问题 2 未解决；留副本 → 两处真相源，永远对不齐 |
| **D8** | **skill 供给机制选哪种？** | **repo 内 `skills/writing/*.md` 为唯一真相源，本地 Claude Code 直读；MCP 只读兜底** | 改 = 改 git 文件 = 零发版；与仓库现有 `.claude/skills/` 约定一致 | 只做 MCP 供给 → skill 变更要等镜像重建（问题 2 原样保留）；只做本地 → 异地 agent 拿不到 skill |
| **D9** | **批量入库草稿开不开？** | **开**（`/api/posts/bundles`，只落草稿） | 一周多篇是常态，逐篇调用效率低；草稿态有人工审核闸，风险可控 | 不开 → 线下批量生产体验差，回退到手工逐篇（R3 节奏问题加剧） |
| **D10** | **批量同步公众号开不开？** | **不开**（沿用 arch §3.6 M72 裁定 3） | 一次 30 篇无人审内容进草稿箱，人工审阅成本放大 30 倍 | 开 → 内容质量失控风险，公众号是主渠道，事故成本高 |
| **D11** | **admin 档 agent 配额何时下调？** | **B3 关站内生成入口的同一批**下调至 user 档（12 calls / 50k） | 没有长编排任务了，继续留 120/600k 是无意义敞口 | 不调 → 熔断闸关闭后仍可能被超长 run 拖垮 |
| **D12** | **`identity.ts` 是否迁出 `lib/agent/`？** | **不迁**（B8 可选，优先级低） | 迁移收益仅是目录整洁，风险是「删顺手删错」；且需同批改 4 个 import 路径 | 迁 → 目录更干净，但增加一批无业务价值的改动与 review 噪音 |

---

## 附：需用户补充的信息（不影响方案骨架，但影响 B1/B2 细节）

1. 线下 Claude Code 的**使用场景**是否只有站长一人？若多人/多机，skill 供给与 PAT 策略需按人分（建议每机一枚 PAT，`/api/pats` 已支持吊销）。
2. `skills/writing/` 是否进 git？（默认进 —— 不进就无法「改 skill 零发版」。）
3. 是否有**已知的下游 agent**（workbuddy/codex 等）在用现有 21 只 MCP 工具？若有，B1 的工具签名变更需先公告。

---

## 附：关键文件索引

| 文件 | 角色 |
|---|---|
| `src/lib/agent/agent.ts` | 工具面装配单点（`agentToolsFor` :138）与 `ADMIN_PROMPT_ADDENDUM`（:78）；B0/B4 主战场 |
| `src/lib/mcp/tools.ts` | `SERVER_INSTRUCTIONS`（:33-64，已自包含发文/贴图/公众号全流程）+ 工具注册装配点；B1 主战场 |
| `src/lib/ai/writing-guides.ts` | 7 个写作 skill 的现真相源；B2 迁移的源文件 |
| `src/lib/agent/identity.ts` | 8 处外部引用中 4 处非 agent，**绝不可删** |
| `src/app/(admin)/admin/studio/[id]/page.tsx` + `src/components/admin/studio/StudioActions.tsx` | 创作中心本体与其唯一生成触发点（`openAgentAssistant` :75/:89） |
| `src/lib/pricing/*`（无关域，仅记录） | 本轮未涉及 |
