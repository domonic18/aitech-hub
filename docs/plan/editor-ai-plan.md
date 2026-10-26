# 编辑器 AI 化实现方案(agent 对话改稿 + diff 评审 + 自动保存)

> 2026-10-12 立项(M27):M26 专题文档 compose 初稿的人工定稿效率工程。用户定调「编辑全流程系统内闭环」——侧边栏 deepagents 对话改稿、局部修改以类 VSCode 的 diff 过程呈现、编辑器自动保存。三块地基已在:编辑主面 Vditor(`MdEditor.tsx`)/ `read_post` 工具(`src/lib/agent/tools.ts`)/ ask_user HITL 往返(hitl.ts 契约 + interrupt 卡)。方案锚回管线 [topic-pipeline-plan.md](topic-pipeline-plan.md),里程碑 **M27**([development-plan.md](development-plan.md))。
>
> **2026-10-13 验收反馈修订(本版)**:真机两问题——① 后台助手卡看不到会话列表,历史会话无法回查;② 编辑页呼出助手要求改文,AI 答「无法访问文章管理后台,请告诉我标题」——上下文断链 + 改稿工具未建。修订:**批②③ 与两新需求合并为 M27 批⑧**,交互基建对照 ai-invest 三件套(§3),方案本版定稿。批①(自动保存/乐观锁/影子副本/上下文 chip)已交付(feature/editor-ai,87fa784)。

## 1. 背景与问题实录

**已交付(批①)**:编辑主面 MdEditor(Vditor dynamic 封装)手动保存走 `PUT /api/posts/[id]`;自动保存 `usePostAutosave`(debounce 2.5s + `expectedUpdatedAt` 乐观锁 409 人话 + localStorage 影子副本)仅编辑态草稿启用;编辑页 `EditorAssistant` 唤起 `AssistantCard(embedded)` 并传 `editContext {postId,title}`,卡片内 chip 呈现。

**验收暴露的断链(本版要修的)**:

| # | 问题 | 根因 |
|---|------|------|
| P1 | 后台侧边栏 AI 对话无会话列表,历史会话查不到 | 会话列表功能只在 `/search` 全高抽屉常驻(`AgentDrawer.tsx` 176px 左栏);后台 FAB/编辑页用的 `AssistantCard`(400px 卡)是**汉堡钮→整卡覆盖层**,默认不可见、无搜索,体验与 ai-invest 常驻侧栏不一致 |
| P2 | 编辑页对助手说「改这篇文章」,AI 反问「是哪篇文章」 | `editContext` 仅前端 chip 视觉呈现:run 请求体无 context 字段、服务端消息无注入、graph 工具面无编辑工具——模型侧零感知;`read_post` 又仅 PUBLISHED 可读,草稿场景双断 |
| P3 | 对话改稿 + VSCode 式 diff 确认未实现 | 即原方案批②③,待开发(本版细化为可实施契约) |

## 2. 总体架构(核心原则:提案不落笔)

agent 工具只出提案,**写库永远 = 人点「接受」→ 编辑器回写 → 既有自动保存 `PUT /api/posts/[id]`**(admin 会话)。agent 无独立写凭据,权限边界与「PAT 拒绝 mutation」惯例同构。

```
admin 编辑页(唯一助手入口 EditorAssistant,该路由隐藏全站 FAB 防双实例)
      ↓ 打开卡片:member 常驻会话左栏(P1 修复)+ 编辑上下文 chip
对话:「第二段展开,按我的口径」
      ↓ stream body 携 context{page,edit{postId,title}}(仿 ai-invest page_context)
服务端把 [编辑上下文] JSON 前缀注入本条 human 消息 → agent 经 read_draft 读到 ≈屏幕稿件
      ↓ agent → propose_edits(S/R 块/整档重写)→ interrupt 挂起(hitl 同款)
提案随流下发 → 评审面(@codemirror/merge,chunk 级 accept/reject)
      ↓ 接受 → 应用器生成新全文 → setContentMd 写回 Vditor(undo 口径见 §7)
自动保存(debounce PUT)→ DB;agent 下一轮 read_draft 即最新
      ↓ 拒绝(可带评语)→ resume 回流,agent 可继续迭代(ask_user 同款)
```

**编辑面与评审面分离**:编辑体验零回归(Vditor 不换、不动);diff 是叠加的评审层,评审在独立面完成,接受后整段写回。

## 3. ai-invest 对照借鉴(三件套)

| ai-invest 模式 | 本项目现状 | 批⑧ 动作 |
|---|---|---|
| **① 会话列表常驻左栏**(`AssistantSidebar`:今天/昨天/更早分组 + 搜索 + 切换/删除,`AssistantPanel` 左栏常驻) | `AgentSidebar` 组件已平移(Drawer 常驻 176px 在用);`AssistantCard` 退化为汉堡覆盖层 | AssistantCard 改**常驻左栏双栏卡**(§5),补搜索框 |
| **② page_context 上下文注入**(`buildPageContext(window.location)` 纯函数发送瞬间取 → run `metadata.page_context` → 后端 `_with_page_context` 把 `[页面上下文] {json}` 前缀注入 human 消息) | 无。run body 只有 `input`/`command`(`runtime-adapter.ts`),服务端原样入图 | 全链平移:`buildAgentContext` 纯函数 + stream body `context` 字段 + 服务端消息前缀注入(§4);防腐纪律同款(adapter 不订阅 React 状态,getter 快照) |
| **③ HITL 卡片往返**(QuestionCard 选项点击即续跑) | ask_user 底座已在(hitl.ts 零依赖契约 + 工具体裸 interrupt + resume 回流 + 断线水合),PR #65 三件守卫 | **复用不新造**:propose_edits 走同一机制,契约新开 `edit-proposal.ts`(§6),前端按 interrupt kind 分发卡片(§7) |

## 4. 上下文注入链(P2 修复,批⑧-b)

**契约**:`AgentRunContext = { page: string; edit?: { postId: string; title: string } }`(zod:`page` ≤64 字;`edit.postId` 数字串 ≤32;`edit.title` ≤300 字)。

- **前端构建**:新纯函数 `src/lib/agent/run-context.ts#buildAgentPageContext(location)`(发送瞬间读,零订阅;路由→page 名映射表:`/admin/posts/:id|/new`→「文章编辑」、`/admin/topics`→「专题治理」、`/telegram`→「电报流」等,未命中回落 pathname 首段)。`edit` 段不走 URL 推导——由 `AssistantCard` 已持有的 `editContext` props 提供(单一真相源, postId 不是 URL 可独存的事实)。
- **传输**:`runtime-adapter.ts` stream body 增 `context` 字段;adapter options 增 `getContext?: () => AgentRunContext | null` getter,由宿主(AssistantCard)以 ref 快照注入(防腐纪律:adapter 不订阅 React 状态,发送瞬间取值)。
- **服务端注入**:stream 路由 bodySchema 扩 `context`(可选);**非 admin 身份一律剥除 `edit` 段**(fail-safe,游客/普通用户无编辑语义)。注入点在 `runAgentTurn` 入口前拼消息前缀(ai-invest `_with_page_context` 同款,模板常量收口在 `run-context.ts`):

  ```
  [页面上下文] {"page":"文章编辑","edit":{"postId":"123","title":"…"}}\n\n<用户原话>
  ```

  resume 分支(Command)不注入——上下文已在 checkpoint 历史。图缓存键不变(身份档已含,注入在消息层不动图)。
- **chip 保留**:AgentThread 编辑上下文 chip 照旧(人眼确认注入生效);服务端注入对用户不可见(不进消息气泡,仅入模型输入)。

## 5. 会话列表常驻化(P1 修复,批⑧-a)

对照 ai-invest `AssistantPanel` 左栏常驻 + 本项目 Drawer 既有 176px 左栏,**AssistantCard 改双栏**:

- 卡片 400px → **600px**(`max-w-[calc(100vw-2rem)]` 保留);member 身份常驻左栏 176px(复用 `AgentSidebar` 组件,与 Drawer 同件同宽),右侧主区 ~424px 维持现状体验。游客单列全宽不变(无列表语义)。
- **AgentSidebar 补搜索框**(ai-invest 有、本项目缺):纯前端标题 contains 过滤(列表 ≤100 条全量在客户端,`AGENT_SESSION_LIST_MAX`),不新增服务端面。
- **窄屏降级**(<640px 视口):左栏退化为覆盖式面板(现 overlay 逻辑保留),汉堡钮仅窄屏显示;宽屏汉堡钮退役。
- **入口收敛**:文章编辑路由(`/admin/posts/[id]` 编辑态)隐藏 admin/layout 全站 FAB——该页唯一助手入口 = 顶栏 `EditorAssistant`(带编辑上下文;FAB 形态无写回接线,留着只会复现 P2 的「AI 不知道哪篇文章」)。其余 admin 页 FAB 照旧(M27 批⑦ 口径)。新建页 `/admin/posts/new` 无 postId,仍走 FAB。
- 会话切换行为不变(受控 threadId + run 收尾对账,`AssistantCard` 既有纪律);切换时清 todos/banner 照旧。

## 6. agent 工具面(批⑧-c)

- **`read_draft`(admin-only)**:读任意状态文章 `{title, contentMd}`(截断沿用 `TOOL_BODY_MAX=6000`,截断时回传实际长度提示),入参 `{postId}`——模型从上下文前缀取当前文章 id。不新开公共读面,纯 admin 身份工具。
- **`propose_edits`(admin-only,zod 双档契约)**:
  - 档一 局部修改:`edits[]: { oldString, newString, note? }`(Claude Code Edit 语义:oldString 须原文唯一命中;≤20 块、单块 ≤8000 字;note = 改动意图,评审面展示)
  - 档二 整档重写:`{ contentMd, note }`(≤50000 字;工具描述引导优先档一,整档重写仅用于「按公众号风重写全文」类大改)
  - 工具端**不写库**:工具体内裸调 `langgraph interrupt()`(ask_user 同款,零 interruptOn 配置),interrupt value 即提案;客户端评审结果 resume 回流,拒绝带评语时 agent 可再提案
- **零依赖契约模块 `src/lib/agent/edit-proposal.ts`**(hitl.ts 同款纪律,客户端 bundle 不经 tools.ts 拉入 prisma/deepagents):
  - `ProposeEditsPayload = { kind: "propose_edits"; mode: "edits"|"rewrite"; note: string; edits?: {oldString,newString,note?}[]; contentMd?: string }`(interrupt value)
  - `ProposeEditsResume = { decision: "applied"|"partial"|"rejected"|"unavailable"; applied?: number; comment?: string }`
- **stream 路由 resume 分流**:bodySchema 的 `command.resume` 改 discriminated union——`{kind:"ask_user", message, option?}`(kind 缺省兼容存量客户端)与 `{kind:"propose_edits", ...ProposeEditsResume}`。
- **工具注册与防线**:`agentToolsFor("admin")` 追加 `EDIT_TOOLS = [readDraftTool, proposeEditsTool]`(guest/user 图零变化);工具体内 `assertAdminThread` 复用(topic-tools 同款纵深防御);**askUserGuard 单飞白名单扩 propose_edits**(interrupt 类工具并行触发防 resume 错位,机制复用,守卫语义改名 interrupt-guard 口径);`ADMIN_PROMPT_ADDENDUM` 增编辑改稿段(先 read_draft 摸稿 → 默认出 S/R 块 → 提案后按 resume 结果转述,unavailable 时引导去编辑页)。
- **无编辑器降级**:admin 在非编辑页(如 FAB 会话)触发 propose_edits → 客户端无评审面,渲染降级卡并自动 resume `{decision:"unavailable"}` → 工具返回 error 语义,agent 引导「到文章编辑页使用」。零服务端状态(不查会话行绑文章,KISS;编辑页入口已唯一化,该路径是兜底)。

## 7. diff 评审面(@codemirror/merge,批⑧-d)

选型维持定稿:Monaco(3-4MB)排除;jsdiff 自绘留备选。依赖已就位(package.json:`@codemirror/{view,state,language,lang-markdown,merge}` + `diff-match-patch`)。

- **kind 分发**:`AgentThread` 中断渲染按 interrupt value.kind 分派——`ask_user`→`AgentInterruptCard`;`propose_edits`→新 `ProposeReviewCard`。现状是任意 interrupt 一律按 ask_user 渲染(`parseAgentAskUserInterrupt` 失败落兜底问题文案),分发改造后兜底卡仅收留未知 kind。
- **ProposeReviewCard 流程**:收到 payload → 应用器预定位 → 评审模态(原文/提案对照,diff 高亮)→ 逐 chunk 接受/拒绝 + 「全部接受」→ 应用器生成新全文 → 「应用」回写。
- **应用器(纯函数 `applyProposals`,单测钉死)**:`edits` 档逐块定位——**精确匹配 → diff-match-patch 模糊兜底(归一化相似度阈值命中,命中区间以 patch 为准)→ 未命中标「未能定位」不阻塞其他块**;定位结果 chunk 列表驱动评审面(每块 可见 before/after + note + 状态徽标);`rewrite` 档整档交 @codemirror/merge 出 chunk。评审拒绝的块回退原文,最终 mergedText 仅含接受块。
- **写回接线**:`AssistantCard` 的 `editContext` props 扩为 `{postId, title, getContent: () => string, onApplyContent: (md: string) => void}`(EditorAssistant 从 PostEditor 取 state getter/setter 传入)。注意与 §4 wire 契约的边界:上行 `context.edit` 仅 `{postId, title}`(函数不过线),getContent/onApplyContent 是纯客户端 props,仅 embedded 形态在场,FAB 形态恒缺 → 走 §6 降级。「应用」= `onApplyContent(mergedText)` → PostEditor `setContentMd` → VditorEditor 受控 `setValue`(既有路径)→ 自动保存链接管落库(dirty → debounce PUT + 乐观锁)。
- **Vditor 写回 spike(批⑧-d 首项)**:整段写回后 undo 栈行为验证;若 undo 不可跨写回边界,接受「评审写回后 undo 从此处重新起算」并在界面明示(降级口径,先记后验)。
- **评审互斥**:评审模态打开期间编辑器只读(防评审基线漂移);期间 autosave 若在途先落完(本地 mergedText 以 getContent 快照为基,互不污染)。
- 样式对齐 DESIGN-SPEC 终端风 token。

## 8. 自动保存(批① 已交付)

debounce 2.5s → `PUT /api/posts/[id]`(仅编辑态草稿;published 保持手动)+ `expectedUpdatedAt` 乐观锁(冲突 409 人话横幅,不强覆盖)+ localStorage 影子副本(崩溃恢复)+ 三态角标。**兼作 agent 读一致性前提**:DB ≈ 屏幕(残余漂移窗口 2-3s 可接受,方案 §3 口径不变);提案「应用」以本地全文为基一次落库,无需额外 flush。

## 9. 数据与 API

- **v1 零新表**:提案不落库(评审状态在客户端);版本历史 `post_revision` 留后续(v1 diff 基准 = 客户端 `getContent()` 快照)。注记:rewrite 档全文随 interrupt 入 checkpoint(PG),50k 字符帽可控体积。
- API:复用 `PUT /api/posts/[id]`(乐观锁批①已扩);stream 路由仅扩 `context` 入参与 `resume` union,**零新路由**。

## 10. 安全与权限

- `propose_edits`/`read_draft` 仅 admin 图注册 + 工具体 `assertAdminThread` 双防线;游客/用户 FAB 工具面零变化;`context.edit` 非 admin 服务端剥除。
- 提案随 SSE 下发,服务端持久层零落;日志记事件(edit_proposed/applied/rejected + postId)不记正文。
- 写路径仍 admin 会话 + Origin 校验(既有);agent 无独立写凭据(§2 原则)。

## 11. 非目标(v1 明确不做)

- `post_revision` 版本历史 / 时间线回滚;多人协同(CRDT/Yjs);移动端编辑体验优化
- Vditor WYSIWYG 化;agent 直接发布 / 直接推公众号(定稿与发布永远人工)
- 编辑工具全站 FAB 泛化(仅文章编辑页语义);标题/meta 的提案改写(v1 仅正文 contentMd)
- 前台文章页等非编辑路由的 page_context 深语义(v1 page 名仅助手指代消解,不接工具)

## 12. 实施分批(M27 编号)

| 批 | 内容 | 出口 |
|---|---|---|
| **M27 批①**(已交付,87fa784) | autosave/乐观锁/影子副本/编辑上下文 chip | `make check` + e2e 35 全绿 |
| **M27 批⑧-a 会话列表常驻化**(已交付开发,2026-10-13) | AssistantCard 双栏(600px + 常驻 176px 左栏,窄屏覆盖降级)+ AgentSidebar 搜索框 + 编辑路由隐藏全站 FAB | e2e:member 双栏在位/切换回查/游客单列不回归 |
| **M27 批⑧-b 上下文注入 + read_draft**(已交付开发,2026-10-13) | `run-context.ts`(构建/注入模板)+ adapter `getContext` + 路由 zod/剥除 + `read_draft` 工具注册 + 提示段 | 单测(构建映射/非 admin 剥除/前缀注入/工具截断);真机:「当前文章标题是什么」答对 |
| **M27 批⑧-c propose_edits 提案流**(已交付开发,2026-10-13) | `edit-proposal.ts` 契约 + 工具(interrupt/双档 zod)+ resume union 分流 + guard 白名单扩展 + 降级卡 + 提示段改稿纪律 | 单测(契约/路由分流/resume 规整/unavailable 降级);真机:对话改稿提案到达,拒绝零副作用 |
| **M27 批⑧-d diff 评审面**(已交付开发,2026-10-13) | `proposal-apply.ts` 应用器(精确唯一→模糊≥0.6→未定位不阻塞;多处命中歧义直 miss)+ 评审全屏模态(chunk diff 视图/接受拒绝/写回接线)+ rewrite 档 @codemirror/merge 对照;undo spike 按 §7 降级口径(写回走 setContentMd,undo 自写回点重启,真机验证遗留) | 单测(应用器三态);真机:逐块接受→编辑器更新→autosave 落库→undo 口径确认 |
| **M27 批⑨ 收口**(文档收口已落,真机/PR/部署待用户) | 全链真机(§13)+ 文档收口(arch/04 §3 补注四、development-plan、本表)已落 + PR 合 develop + 生产部署 | 真机全链走通 |

每步独立提交、`make check` 全绿;e2e 零真 LLM(提案流用 fixture payload 驱动组件/纯函数测试,真触发不入 e2e,M25 同口径)。

## 13. 验收标准

- **真机全链**:compose 初稿/任意草稿 → 编辑页对助手说改稿 → 提案卡 → diff 评审逐 chunk 接受 → Vditor 更新(undo 口径明示)→ autosave 落库(角标)→ 发布 → 公众号草箱
- **上下文消解**:编辑页问「这篇 文章的标题/第二段写了什么」AI 免问直达(read_draft);非编辑页不出现编辑工具语义误导
- **拒绝零副作用**:拒绝后内容零变化(提案不落笔断言);带评语拒绝后 agent 可继续修订
- **降级路径**:未定位 S/R 块不阻塞其他块(标「未能定位」);无编辑器页面 unavailable 降级卡;乐观锁 409 人话提示(批①已有);localStorage 恢复提示可唤起(批①已有)
- **会话回查**:后台卡片常驻列表可见历史会话,搜索/切换/删除可用;游客单列与 /search 抽屉零回归
- **权限**:游客/用户会话工具清单无 `propose_edits`/`read_draft`;`context.edit` 非 admin 剥除
- `make check` 全绿;e2e 零真 LLM

**风险注记**:① rewrite 档依赖模型单次输出全文,长文可能截断——工具描述引导优先 S/R 档 + 50k 帽;② MiniMax 对 propose_edits 参数形状的触发质量待真机(ask_user 前科 M22),缓解靠 schema 简洁 + description 示例;③ ask_user 触发率风险不同传 propose_edits(interrupt 是工具配置点,不依赖模型主动询问);「带评语拒绝后 agent 自主继续」依赖 resume 行为,批⑧-c 真机验证。

**状态:批⑧-a/b/c/d 已交付开发(2026-10-13,门禁全绿:单测 1125/全量 e2e 36——next start 产物,dev server 不可信见 memory),批⑨ 文档收口已落;真机全链(§13)+ PR 合 develop + 生产部署待用户。** 状态流转对齐 [development-plan.md](development-plan.md) §5 维护约定。
