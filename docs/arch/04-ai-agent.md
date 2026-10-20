# AI Agent 体系设计(骨架 + Agent 搜索锚点)

> 状态:占位骨架(2026-09-30 建立);同日补「Agent 搜索」需求锚点(§3)与「AI 服务治理后台」原型锚点(§4)。**2026-10-06 Agent 搜索立项定稿**(§3:交互两层/检索基座/技术栈全 TS/成本护栏/分期),K1 检索基座 + K2 答案卡进入实施(第一迭代),K2.5 Drawer 会话 Agent 第二迭代。

## 1. 定位

智能体在本站的接入形态与演进路线:从「工具被调用」(MCP)到「agent 自主执行任务」(采集/创作/分发/搜索作答)。

## 2. 已有决策锚点

- **一期(M5)创作 MCP**:`/api/mcp` Streamable HTTP 端点,Bearer PAT 鉴权,upsert_article / upload_media / publish(requirement §3.6)——**已交付(M5-c,2026-10-03)**:六工具(增 get_article/list_articles/unpublish)一律 slug 为键,stateless 每请求新建 transport 适配多实例,e2e 钉协议面;真机接入:`claude mcp add --transport http aitech-hub <base>/api/mcp/ --header "Authorization: Bearer ahp_<token>"`(trailingSlash 站点带尾斜杠);2026-10-07 起 server instructions 随 initialize 下发发文工作流——大图 curl multipart 直传 `/api/media/`(PAT 双通道,≤10MB/张)→ 本地重写链接 → `upsert_article` 纯文本落草稿,封面经 frontmatter `cover:` 引用站内路径;base64 带内通道仅限 <100KB 小图(二进制字节不过 agent 模型上下文,M18)
- **二期站点内容 MCP**:同端点扩对外只读工具集(搜索/读文章;development-plan §3)
- **二期封面 AI 文生图**(混元);开发期的图片素材管线用本机 zhipu-image MCP 辅助——属开发工具,非站内能力
- 异步底座:agent 触发的长任务一律 BullMQ(arch/05-services §4);短视频解读管道(arch/02 §3.2)是第一个 LLM 生产任务

## 3. Agent 搜索(2026-09-30 需求锚点;2026-10-06 立项定稿)

首页控制台输入框 + `/search?q=` 结果页的 Agent 化(需求 requirement §4;原型 site-search.html)。2026-10-06 与站长讨论定稿如下,原「留立项评审」项就地收敛。

### 3.1 交互定稿:页面为体、Drawer 为翼(两层)

- **第一层 页面式首搜**:`/search?q=` 结果页——分组命中列表(mark 高亮 + 渠道 chip + 命中度)**即时 SSR**(URL 可分享/可回退,命中是真实 HTML);AI 答案卡为流式增强,不阻塞命中呈现。hero 输入框回车即跳此页,交互心智是「找内容」
- **第二层 继续追问 Drawer**:答案卡追问 chips 或结果页「继续深挖」入口唤起右侧抽屉会话——**ai-invest-assisstant 同款交互**:线程列表(今/昨/更早 + 新建)+ 执行计划条(deepagents todo,✓/◐/○)+ 工具调用过程块;自绘件**结构平移、样式换装终端风 token**(前台不引 antd)。交互心智是「问助手」,多步深挖(对比/展开/归纳)才付 agent 成本
- **红线不变**:答案必须可溯源(引用角标 [n] 锚站内条目),站内 0 命中明示「AI 直接作答」不伪装检索;生成失败/配额超限**降级纯检索结果页**,前台无感

### 3.2 检索基座(K1):三域统一检索 service

- 一次 query 并发检索三域——`telegram`(资讯,含短视频解读)/ `content_post`(教程,博主文章)/ `github_repo`(项目),合并分组返回;**给人搜索 = 给智能体检索**:同层供 K2 答案卡、K2.5 agent 工具与 K3 站点内容 MCP「搜索」工具,同源不漂移
- ~~PG 全文(tsvector)起步;中文分词实效待测~~ **实施定稿(2026-10-06,第一迭代)**:ILIKE 词项计分起步——PG simple 分词器对中文无效(无空格整段一个 token),tsvector 全文对中文查询无召回;q 切词(`src/lib/search/tokenize.ts`,CJK 连续段整词、≤8 词)逐词 `contains insensitive`(OR)取候选(每域 50 条预排),JS 侧加权计分重排(title 3 > 摘要 2 > 正文 1,`search-view.ts#scoreTerms`),命中度 = 词项覆盖率%。零迁移零扩展;已知限制:长无空格 CJK 问句召回弱,实测差再追加 bigram 词项(仍零迁移),zhparser/pgvector 升级路径不变。落点 `src/lib/search/unified-search.ts#searchAll`(唯一碰 Prisma 的检索入口)
- **混合检索定稿(2026-10-08,M20 批①~③,`feature/search-hybrid`)**:立项依据 = 生产数据实证(3 天仅有的 1 条真实查询词三域 ILIKE 全零命中而语料含词,词项检索对自然语句召回失效);用户定调「借助 agent 能力提供更智能的搜索答案」,且 embedding 选智谱 embedding-3、向量存储选 pgvector(与所辖项目技术栈统一)、不做多跳 agentic loop(搜索及时性优先,答案卡维持「一次检索+生成」节奏)。分层:
  - **词项层不变**(上述 ILIKE 词项计分,序与命中率口径不动);
  - **语义层**:查询向量化(`query-embedding.ts`:embedding-3 1024 维,Redis 缓存 24h,key 绑 modelId+sha1(q);未绑定/失败 → null 降级,台账记 degraded)→ pgvector 余弦召回(`search_embedding` 表,三域分部 HNSW 索引,每域 top 30,`embedding-repo.ts#topVectorMatches`);
  - **融合**:`unified-search.ts#fuseDomain` 双榜 RRF(k=60)+ 词法证据 tiebreak(RRF 同分时字面词项命中压过纯语义)→ 截组限量;语义命中 UI 以「语义匹配」标替代命中百分比;组头 total = 词项命中数 + 语义补召可见数;
  - **降级纪律**:embedding 未绑定(功能关闭)或查询向量化失败 = 语义层整体缺席,结果与纯词项逐字节一致——检索永不因 AI 挂而挂;
  - **内容向量供给**:worker 每 15 分钟对账自愈(`embed-reconcile.ts` + `embed-content` 队列:扫 stale → 批量 embed → upsert,孤儿清理同 job)——发布/入库管道零侵入,新内容最迟一个周期可被语义召回;`npm run embed:run` 手动回填;
  - **基建红线**:现网 PG 是 alpine(musl,`datcollversion=NULL`),禁用官方 Debian pgvector 镜像原位替换(文本排序静默变更),一律自编译镜像(standard/02 §3.3);
  - 已知边界:换绑 embedding 模型(维度/语义空间双变)需手动清 `search_embedding` 重嵌;长尾查询向量质量随语料规模增长,实效上线后按 /admin/usage 与查询日志回调
- 生成选型定稿:**直连 LLM(进程内),不经自有 MCP 复用**——与 §2 站点内容 MCP 的关系保持「同检索层、不同鉴权与工具面」

### 3.3 技术栈定稿:全 TS,无 Python sidecar(2026-10-06)

- **deepagents(npm 官方 TS 版)**:`deepagents@1.x`(2026-10 实测 latest 1.14.2 活跃维护,LangChain 出品,LangGraph.js 之上;计划 todo 工具/文件系统/子 agent/checkpoint 与 Python 版对齐)。讨论中曾预设 Python sidecar(平移 ai-invest 后端),经查证 TS 版成熟后改为**进程内全 TS**——省一个容器与镜像 CI 线,且直连复用现有 AI 治理管线(下条)
- **直连复用现有管线**:`src/lib/ai/resolver.ts#resolveAiModel("search")` 角色绑定(主力/备用,`ai_task_binding` 槽位现成,M15 批② 起配额输入框就位)+ `getRoleDailyMax` 配额 + `ai_usage_log`(role=search)台账 + /admin/usage 费用看板,零桥接
- **前端 assistant-ui 组合**(ai-invest 同源实测):`@assistant-ui/react` + `@assistant-ui/react-langgraph`(`useLangGraphRuntime` 吃 LangGraph 兼容消息流)+ `@langchain/langgraph-sdk`(useStream 传输);后端为 Next.js Route Handler 自实现流式契约(ai-invest FastAPI 同款自实现先例)
- **线程持久化**:LangGraph.js checkpoint-postgres 复用生产 PG;**checkpoint 表框架自管(`setup()` 幂等建),不进 Prisma migrations**——边界同 ai-invest 先例(其头注:checkpoint 表不进 Alembic)
- **SSE**:Route Handler 直出流;nginx 需对该路由 `proxy_buffering off`(配置变更随批走)

### 3.4 成本与护栏定稿(2026-10-06,上线后按 /admin/usage 真实数据回调)

| 项 | 定稿值 | 说明 |
|----|--------|------|
| 答案卡日配额 | `search` 角色 **100 次/日**(`ai_task_binding.daily_max`) | 超限**自动降级纯检索结果页**,前台不报错 |
| Drawer 会话日配额 | **20 次/日** | 独立计数,超限入口置灰 + 提示 |
| 单会话上限 | **≤12 步 / ≤50k tokens**(默认;后台「站点设置」可调) | agent 主动收束并提示,防多步失控 |
| 单会话上限(admin 档) | **≤80 步 / ≤400k tokens / recursion 200**(默认;2026-10-17 验收反馈) | 专题文章生产是多步自主编排,细粒度工具链 + HITL resume + 每轮重灌全量历史,30/150k/60(M27 批⑤首档)实测中途打满;recursionLimit 须随步数同步放大(≈2×步数留裕量),护栏防失控兜底而非计费 |
| 额度可调 | 三档(游客/用户/管理员)×步数/tokens 六键入 `site_config`(键族 `agent.*`,后台站点设置编辑;recursion 按 2.5×toolCalls 派生不开放设置,2026-10-17) | 缺行/非法回默认+clamp(1..200 步 / 1k..200 万 tokens);run 路由每请求读档,保存即时生效(下一条消息) |
| 答案缓存 | 同 `q=` **24h** 内复用 | 省钱 + 秒开;缓存行落 Redis/PG 实施时定 |
| 模型建议 | search 角色绑国产模型(DeepSeek/GLM/Qwen 级) | 单次答案卡 ¥0.005~0.1、会话 ¥0.05~1;Claude 级成本 ×10 收益边际 |

**K2 实施注记(2026-10-06,第一迭代批②/③,`src/lib/search/answer-*` + `GET /api/search/answer/`)**:

- **配额口径**:`countTodayRoleUsage("search")` = `ai_usage_log` 当日(北京日界)`role=search` 且 `status∈{ok,degraded}` 行数(终败不占);缓存命中**计配额**(落 tokens 0 行);缓存回放 meta 沿用**生成时刻** `generatedAt`(北京格式,不把命中时刻当生成时刻);无绑定/超配额单帧 `unavailable` 不落台账(无 LLM 调用)
- **降级三路径**(no_binding/quota/error)一律 SSE `unavailable` 事件,不占 HTTP 状态,前台无感;IP 频控 10 次/分(`rate-limit.ts`,Redis 挂放行)
- **0 命中仍生成**(requirement §4 红线「AI 直接作答」):prompt 换无资料变体(凭模型知识、不用 [n]),meta.noHits 标注,答案卡明示「站内无命中 · AI 直接作答」
- **追问 chips**:单次调用哨兵分隔(`###FOLLOW###` + 恰好 3 行,≤20 字/条);流式侧 `visiblePrefix` 扣住哨兵与半截哨兵防泄漏;漏哨兵 → 无 chips 优雅降级
- **答案渲染**:受约束 markdown 子集(`answer-markdown.ts`:**加粗**/`行内代码`/`[文本](URL)` 链接(href 单行无空白才成链,渲染侧 http(s) 非本站开新窗)/`-` 与 `1.` 列表/`#`~`####` 标题(收敛 2~4 级)/``` 代码围栏(未闭合到 EOF 按代码块收尾)/GFM 表格(表头+分隔行开启,单元格行内解析;行内代码含 `|` 的瑕疵接受)/空行分段/独占一行的站内卡片图 `![](/wp-content/uploads/…)`(2026-10-20 补:render_card 的 `markdown_line` 原样写入正文即在答案卡与 Drawer 出图;只认站内媒体路径,外链图片按字面量,不渲染任意远端资源);标题/围栏/表格/链接系 K2.5 验收反馈补充——技术问题下模型习惯性输出,渲染器扩子集而非 prompt 对抗),子集外字面量;prompt 同步约束排版;纯函数解析 → React 节点,不经 dangerouslySetInnerHTML(无注入面);`[n]` 上标在文本叶内二次解析
- **流式**:双协议均 SSE——openai `stream:true + include_usage`(400 点名剥参重发,镜像 response_format 先例);anthropic 标准 `content_block_delta` 流式(usage 两段式 message_start/message_delta 按 max 合并;400 点名 stream 参数回落非流式整段单 delta,同款先例——首迭代初版 anthropic 非流式兜底致答案整段一次性出现,验收反馈后升级);断流有增量按 done 收尾(degraded 行,不写缓存)、零增量 unavailable(error)+ failed 行;备用模型 → degraded 行
- **nginx**:`location ^~ /api/search/` `proxy_buffering off`(配置随批落地);响应头 `x-accel-buffering: no`

**K2.5 实施注记(2026-10-07,第二迭代批①~⑤,`src/lib/agent/*` + `/api/search/agent/*`)**:

- **wire 契约以已装 SDK 实测钉死**(`@langchain/langgraph-sdk` 1.12.1 dist 逐行核对,不信旧文档):SDK 透传原始 `{event,data}` SSE 帧;前端 `useLangGraphMessages` 识别 `messages`(tuple `[message, metadata]`)/`messages/partial`/`updates`/`values`/`metadata`/`error` 等,未知事件走 custom;chunk 形态要求 `tool_call_chunks[].index` 为 number——序列化单点收敛 `src/lib/agent/wire.ts`;客户端解码单点 `src/lib/agent/sse.ts`(K2.6 修复批,见下)
- **会话 30 天自动清退 + 用户可删(2026-10-07 用户拍板)**:行 `lastMessageAt` 超 30 天 worker 日清(STATS 队列 `purge-agent-session`,04:33 错峰)行+checkpoint 同删;用户删除走 DELETE 路由(归属校验 404 不泄露存在性,checkpoint 删失败不反噬)
- **入口仅 /search 场景(2026-10-07 用户拍板;~~不做全局 FAB~~——**2026-10-09 M22 批④ 推翻,全站悬浮助手上线,见 K2.7 注记**)**:答案卡追问 chips(直发)+「继续深挖」按钮(仅预填)派发 `search:agent-ask` 事件唤起 Drawer
- **身份**:匿名 cookie `ah_av`(uuid,365d,httpOnly)即 visitor,会话行与其绑定;换设备/清 cookie 失联,30 天清退兜底;三期登录后再议账号绑定
- **模型绑定即时性**:agent 图进程级缓存按 `${resolved.id}:${resolved.source}` 键控(M27 批④ 起追身份档后缀 `:kind`,见 K2.8 注记),admin 改 search 绑定下一次 run 即生效(重建落 `agent.graph_built` 日志);台账记独立角色 `search_agent`(与答案卡 `search` 的 100/日 互不侵占)
- **前端**:ai-invest 自绘件结构平移(`src/components/site/agent/` 七件),终端风 token 换装,不引 antd/zustand/react-query;threads 建删与 state 走自有 fetch(apiEnvelope);`runs.stream` K2.6 起亦为自有 fetch+SSE 解析(SDK AsyncCaller 对非 2xx reject Response 且包装 `new Error(response)`,apiEnvelope 人话/状态码全丢 → 429 配额/404 过期无法分流还会盲重试等待,用户实测 3 问后静默停止);程序化发送直写 `thread.append`(composer.setText 同 tick send 会静默 no-op);todos 提取零依赖模块 `lib/agent/todos` 客户端可安全引入;Drawer 左缘可拖拽调宽(420~920px 夹取,localStorage `agent.drawer.width` 记忆)

**K2.6 实施注记(2026-10-07,第三迭代批①~④,游客模式 + 后台会话管理 + 工具面收紧)**:

- **身份分流**(`src/lib/agent/identity.ts`):`ah_at` JWT role=admin → `{kind:"admin", key:"admin:<sub>"}`(走会话行路径,20 会话/日照旧);其余一律游客(`ah_av` cookie)。一期「登录账号」即 admin(三期才有普通用户)
- **游客线程生命周期**(零新表,`guest-threads.ts`):thread_id=`g_<uuid>`(前缀即 kind 标记);归属 Redis `search:agent:gthread:{id}`=visitorId,2h 滑动 TTL(run 成功后 EXPIRE 续期);**不落会话行**(多轮上下文由 checkpoint 承载);归属校验 fail-closed(Redis 挂 → 404 自愈开新会话),配额 fail-open(护栏非计费)
- **游客双闸配额**(`quota.ts`):3 问/日/visitor + 30 问/日/IP(防清 cookie 刷,NAT 多游客互不挤占);模型终败也计数;超限 429「今日游客提问次数已用完」
- **过期自愈**:worker 日清扫 `checkpoints` 表 `g_%` 线程,Redis 键已消失 → deleteThread(并入 04:33 job);前端 adapter 识别 404「会话已过期/不存在」→ 复位新会话 + 横幅指引重发
- **审计锚**:迁移 `20261007045121_ai_usage_log_session_id` 增 `session_id varchar(40)` + 索引——`recordAgentRun` 带 threadId,游客不触碰会话行但台账照落;后台会话管理以此聚合游客统计(见 §4 会话管理)
- **工具面收紧 + get_time**:AGENT_TOOLS 收口四只读工具(search_site/read_post/read_repo/get_time),系统提示明示「四工具之外无任何能力(无站外网页/文件系统/代码执行/写入)」超范围直说做不到;`get_time` 返回北京时区 `{iso,beijing,timezone}` 锚定相对时间
- **后台会话管理**(`src/lib/agent/admin-sessions.ts` + `/api/agent-sessions*` + `/admin/usage/sessions`,侧栏精简批② 起为 AI 用量「会话」页签):成员=会话行+台账 runs 计数;游客=`ai_usage_log` 按 session_id 聚合(`LIKE 'g%'`——成员 uuid 首字符必为 hex 不会撞 g)还原统计,活跃态查 Redis 归属键(只查当前页);两源合并按最近活动倒排内存分页;详情读 checkpoint 时间线,游客过期只留台账统计标「已过期」;侧栏「会话管理」占位激活

**K2.7 实施注记(2026-10-09,M22 迭代批①~⑤,全站悬浮 AI 助手 + 用户额度 + 反馈系统)**:

- **入口全局化(M22 批④,推翻 2026-10-07「不做全局 FAB」决策)**:`AssistantFab` 挂 `(site)/layout.tsx`(SSR 恒 null,身份/显隐判定全在客户端),点开 ≈400px 悬浮聊天卡片(非全高抽屉;`AssistantCard` 编排复用 AgentRuntimeProvider/AgentThread/AgentSidebar,懒挂载纪律同 Drawer;卡片/抽屉/编辑器助手三入口统一**常驻化**(2026-10-14):首开才挂,此后关闭仅 `display:none` 不卸载——在跑 agent run 不随卡关闭中断,再开即回(ai-invest 同款交互));/search 的 `search:agent-ask` Drawer 原样保留,新全局协议为 `CustomEvent("agent:open", {detail:{mode, ask}})`(Footer「联系我们」等消费;ask 直发/预填经 nonce 注入 pending,不整卡重挂)
- **身份三路**(`identity.ts`):admin(`admin:<sub>`)/ **user(`user:<sub>`,M22 起普通用户不再是游客)**/ 游客(`ah_av`)——user 复用会话行路径(threads 列表/创建/删除与 admin 同构,30 天日清统一),游客 K2.6 双闸配额照旧
- **余额扣减(免费额度制,M22 批①定稿,不接支付)**:`user_token_wallet` 余额行 + `user_token_ledger` append-only 流水(同事务防并发扣穿),注册送 20 万 tokens/月、读时惰性月重置(periodKey,零 cron);run 前 `hasTokenBalance` 预检(≤0 → SSE 429「本月 AI 额度已用完」不进 run),run 后 `consumeTokens` 按实际 tokens 实扣(可微穿仓至单轮 50k 护栏下限;扣减失败只告警不反噬已完成 run);**admin/游客不扣余额;答案卡不扣余额(范围红线)**——答案卡是站点级公共检索增强,走 100 次/日站配额,非个人资产
- **显隐偏好(需求7)**:登录账号写 `user_account.assistant_visible`(PATCH `/api/account/assistant-visible`,账号级跨设备);游客 localStorage 键独立互不影响;隐藏后右下角留极小唤起点兜底
- **反馈系统(M22 批⑤,需求8/9)**:`submit_feedback` 为工具面唯一可写口(入参共用 `feedback-schema.ts` submitFeedbackSchema;sessionId 取 run 注入 LangChain config 的 `configurable.thread_id`,不在模型参数面不可伪造,归属经会话表溯源,不直落 userId/visitorId);系统提示六工具口径(2026-10-10 ask_user 恢复后)+ 联系话术(ask_user 确认内容→ask_user 询问联系方式可拒→落库后简短告知不复述);Footer「联系我们」派发 `agent:open` 直发引导(未登录可用,游客配额天然覆盖);admin `/admin/feedback` 四分段 + 搜索 + 分页 + 行内流转(open→processing→resolved,可回退重开;无删除无邮件——用户声音留档);API 按仓库惯例落顶层域目录 `/api/feedback`(GET 列表)+ `/api/feedback/[id]`(PUT 流转,requireAdminRequest)
- **ask_user 结构化提问(HITL,2026-10-09 验收反馈)**:工具面第五只 `ask_user`(六工具口径)——工具体内裸调 langgraph `interrupt()` 暂停图(checkpointer 持久),`__interrupt__` updates 帧经 wire 原样透传,前端 `AgentInterruptCard`(问题 + 候选选项点选 + 自由文本)替换输入区(中断期间禁言,防新消息打到悬空 tool_call);回答经 `useLangGraphSendCommand` → POST `command.resume`(`{message,option?}`,resume run 以 `new Command({resume})` 作图输入,工具重放后以正常 ToolMessage 拿到答案继续)。**选型注记**:deepagents TS 版 HITL 中间件(`interruptOn`)的 reject 决策会把回复合成 `status:"error"` 的 ToolMessage(语义错),故不用;裸 interrupt 回传即成功结果,载荷形状收口 `src/lib/agent/hitl.ts`(零依赖前后端共用)。护栏口径:resume 不计游客 3 问/日(非新 ask)、不回填标题;IP 10 次/分与余额/50k 累计照计(真模型消耗)。**可靠性收口(2026-10-10,SasanAgent 范式)**:中断水合——刷新/切会话经 state 路由透出挂起中断(checkpointer getTuple pendingWrites 的 `__interrupt__` 通道防御性窄化),SDK load 契约 `interrupts` 字段恢复提问卡;悬空 tool_calls/孤儿 ToolMessage(中止打断工具节点、提问挂起后弃答、存量脏会话 → OpenAI 兼容端点 400)由 `tool_call_repair` 中间件模型调用前修复(wrapModelCall 请求副本改写,不落持久化,无脏数据零开销透传);并行 ask_user 由 `ask_user_guard` 单飞守卫拦截(只放行触发 AIMessage 按序第一个,其余拦「请合并」;state 异常 fail-closed,防 resume 批重执行答案错位)。
- **dev 注意**:turbopack 下 langsmith 可选依赖 `ws` 缺失使 `/api/search/agent/*/runs/stream` 编译失败;分支切换触发全量重编译时该错误会全站化(所有路由 500),重启 dev server 即恢复按路由隔离(prod webpack standalone 不受影响,未加依赖)

**K2.8 实施注记(2026-10-13,M27 批④,专题合成 agent 化——admin 工具档 + 对话框可视化执行,1276 验收反馈)**:

- **工具面按身份分发(editor-ai 方案「graph 缓存键身份档」提前落地)**:`agentToolsFor/agentSystemPrompt(kind)` 纯函数收口(agent.ts)——guest/user 维持只读六件 + 基线提示;admin 追加第七只 `compose_topic_draft`(写库型工具只进 admin 图)与合成工作流提示段。图缓存键 `${resolved.id}:${resolved.source}:${kind}`(Map ≤6 FIFO;原单槽缓存在双档混访下会逐请求重建);工具体内再验会话行归属 `admin:` 前缀(纵深防御,fail-closed)
- **compose_topic_draft(admin 会话)**:共享资格预检 `checkComposeEligibility`(自 POST 路由上提,路由与工具同一真相源:素材非空/重合成 needConfirm)→ `enqueueTopicCompose` 入队 → 工具体内轮询 `getTopicComposeState` 至终态(2.5s × 6min 上限,与专题页按钮同口径)。生产核仍是 worker 四步管线(可视化的是过程,确定性的是生产):关闭对话框/断连只影响对话流,BullMQ job 照常落库。needConfirm 语义 = 工具返回标记 → 模型经 ask_user 征确认 → confirm=true 重调(HITL 回路);未绑模型/409 进行中/素材空均人话回传由模型转述
- **前端**:专题详情页「合成初稿/重合成」改为唤起 embedded AssistantCard(与编辑页 EditorAssistant 同形态)并注入带专题 id 的合成任务(nonce 机制);`ToolCallBlock` 对 compose 工具恒显过程面板 `ComposeToolProgress`(运行中轮询四步进度,终态摘要 + 跳转文档链接;历史回放按 result 直接渲染终态不轮询)。空素材在按钮侧就地拦截(零真网防线,e2e 34 同文);按钮侧旧轮询逻辑退役(POST /compose/ 路由保留:e2e 防线 + API 面)

**K2.8 补注(2026-10-13,M27 批⑤,专题文章生产重构——编排权移交 agent,固定管线退役;1276 验收反馈「看不到过程/固定管线输出质量差」)**:

- **退役清单**:批③ BullMQ 四步管线(compose-agent + QUEUE_TOPIC_COMPOSE + worker processor)、批④ compose_topic_draft 单工具 + ComposeToolProgress 轮询面板、POST/GET `/api/topics/[id]/compose/` 路由、「专题合成」AI purpose 绑定槽(六角色收五;历史台账 role=compose 行读侧回退原值展示)——生产模型绑定收敛到 search(Agent 搜索),封面生图仍走 cover
- **admin 工具档换装细粒度四件**(`lib/agent/topic-tools.ts`;工具体内 `admin:` 会话校验沿用):`get_topic_brief`(专题定位 + 素材全集 + 关联文档现状 + 近期已发标题,分析底料)/ `transfer_video_cover`(首视频封面转存,B 站防盗链)/ `generate_cover_candidates`(复用 M14 cover-gen 管线,工具体内轮询 ≤120s 取多候选)/ `save_topic_draft`(落稿锚定核 finalizeCompose 扩 SEO/标签——undefined=不动/null=清空,防覆盖人工已改字段;正文图片防幻觉校验只认站内 `/wp-content/uploads/`、`/media/` 路径,编造外链直接拒)
- **编排权在模型**:ADMIN_PROMPT_ADDENDUM 重写为工作流指令(write_todos 计划先行 → 读素材 → 选题(拿不准 ask_user)→ 写作 → 配图 → 落库 → 汇报 post_url;修订 = 重读素材直接改再 save,不重跑全流程);批① STRUCTURE_SPEC 固定结构降格为系统提示「写作指南」(五节推荐体保留为指南,图片引用从禁止放开为库内路径)。过程可视性 = 每只工具卡逐个出现(替代轮询面板),不依赖 todo 条(MiniMax write_todos 触发率已知风险)
- **护栏按身份档**(`run.ts#AGENT_LIMITS`,2026-10-17 起迁 `config/agent-limits` 后台可调):guest/user 12 步 / 50k tokens / 递归 30 不变;admin 放宽 30 步 / 150k / 递归 60(细粒度多步生产天然多工具),stream 路由会话预检同档
- **写核保留**:`topics/compose.ts` 收敛为确定性写核(素材块拼装 / 封面转存 / 落稿锚定 / 近期标题),文首视频推荐卡仍确定性注入;后补能力锚点:视频关键帧(douyin-gateway 侧)与 HTML→截图基建(R③,待立项)

**K2.8 补注二(2026-10-13,M27 批⑥,正文配图全链路 + todo 计划条修复;1276 验收反馈「重合成正文 0 图 / 侧边栏 todo 不显示」)**:

- **正文 0 图根因与链路**:批⑤ 分配面缺失(brief 给 B 站外链 cover_url 而 save 拒外链,模型「看得到用不上」,唯一合法通道只转存首条封面)+ 提示层「无合适图不硬插」双杀 + 批② 文首卡纯文字口径。正解是建链路不打 patch:任何进正文的图片路径必来自 uploadMedia(盘上必有文件、sha1 去重幂等)→ 公众号 transloadContentImages 天然转 mmbiz,同步失败面不扩大。四环:**供给** `transferVideoCovers`(compose.ts)全量转存视频封面,brief / transfer_video_cover / finalize 卡图三方共用;**分配** get_topic_brief 现场转存,materials[] 输出站内 `cover_path`(替代外链 cover_url)+ 顶层 `cover_transfer_failed` 失败清单,transfer_video_cover 重定位为重试/补传钮(返回 covers/failed 全量清单);**消费** 文首推荐卡升级带图(首视频自己的封面,图上文下 blockquote;finalizeCompose 确定性自取不依赖模型传参,失败降级文字卡),提示层同步改写(正文直引 cover_path、生图放开为小节概念示意图、头图避让卡图、全文 2~4 张引导、无合适图不硬插);**校验** `findNonSiteImageRefs` 收窄 uploads-only(`isUploadsPath`——`/media/` 无服务路由是幻觉洞;`isSiteMediaPath`/`extractMediaRefs` 引用追踪口径不变),save 的 cover_path 入参同口径。降级三级一致:单素材失败→null+失败清单,卡图失败→文字卡,均不阻塞落稿;ArticleBody 正文图 lazy 加载
- **todo 计划条修复**:deepagents 1.14.2 仅给 Codex harness 档自动挂 todoListMiddleware,自定义 ChatOpenAI(EMPTY_HARNESS_PROFILE)不带 → write_todos 从未存在于图中(系统提示「计划先行」是无工具可调的空话,侧边栏计划条恒空)。修复 = agent 图显式挂 `todoListMiddleware()`(langchain 导出;guest/user/admin 全身份档) + load 恢复:runtime-adapter 从 state 顶层 `values.todos` 白名单过滤后经 onTodos 回写(切会话先清空防残显;`extractTodos` 只认 updates 帧形态,顶层值用 `extractTodosFromValues`),arch/04 §3.1「执行计划条」自此名实相符
- R③(关键帧/HTML 截图)维持原排期,悬于版权口径裁决

**K2.8 补注三(2026-10-17,M37 封面纪律收敛;呈现协调性验收反馈:写手把竖版封面当正文配图小节间乱插、同图重复)**:上文批⑥「正文直引 cover_path」消费口径**退役**——封面收敛单一职责「只服务系统注入的文首推荐卡 + save_topic_draft 的 cover_path(头图)」,禁止入正文。write_article(M37 单任务)底料剔除 coverPath 不再转存;brief/transfer_video_cover/generate_cover_candidates 工具描述与编排提示改为禁止性表述;指南 L2 删「小节间插 1~2 张」;落稿侧双硬校验——checkCardEmbeds 增同图重复拒收 + checkCoverMisuse 拒封面入正文(均在 finalizeCompose 注入前跑);自评审第⑥项读者视角版面协调。正文配图最终口径 = render_card 卡图 + generate_cover_candidates 生成图两类

**K2.8 补注三(2026-10-13,M27 批⑦,验收反馈四项修复之二/之三)**:(1) **后台 AI 助手 FAB**——AssistantFab 挂进 admin/layout(此前仅 (site)/layout,专题/编辑页侧边助手卡误关后无路可回);admin 会话经 /api/search/agent 解析 admin 身份档(生产四工具在位),SSR 恒 null 免水合不一致。(2) **写作质量与自评审闭环**——ADMIN_PROMPT_ADDENDUM 重写:写作指南反模板腔(钩子 ≤80 字禁「随着…的快速发展」式开场、背景与来龙去脉节、要点递进禁平行罗列、禁「总而言之」类套话、具体数字/句式交错);「去看原视频」小节硬要求给 video_url 行内链接(公众号渲染器外链转角标+文末 References,wechat-safe;「阅读原文」指向站内文章,正文带原链是公众号读者抵达视频的唯一通路);第 5 步新增**强制自评审**(不可跳过:挑剔读者视角逐项检查开头钩子/背景完整性/要点逻辑/原链在位/配图合理并直接改写;**轮数封顶 2**——第 1 轮通读改写,仅硬伤才第 2 轮,2 轮后必须进 save,防无限重写烧 token),save 后汇报须说明自评审改动。

**K2.8 补注四(2026-10-13,M27 批⑧-a/b/c/d,编辑页改稿闭环 + 会话侧栏常驻化;方案 v2 锚 editor-ai-plan §2「提案不落笔」/§4 上下文注入/§6 工具面/§7 评审面)**:

- **会话侧栏常驻化(⑧-a)**:AssistantCard member 身份左栏 176px 常驻(AgentSidebar 平移 Drawer 件,新建/切换/删除全量在位),窄屏(<640px)退化为覆盖式面板(头部汉堡钮唤起);游客无列表语义单列不变。会话刷新即时(GET 无害),受控 threadId 回写仍守「运行中暂缓、run 收尾对账」纪律(闪断根因不变量)
- **页面上下文注入链(⑧-b)**:纯函数 `buildAgentPageContext`(run-context.ts,pathname → 页面语义路由枚举)在 AssistantCard 发送瞬间取 `getContext()`(零订阅、ref 快照,引用稳定防 adapter 重建)→ runtime-adapter stream body 带 `context`(仅 input 分支,resume 跳过——checkpoint 历史已持久化注入)→ stream route 宽松解析(garbage context 不 400)+ `sanitizeAgentRunContext` 按 identity 收敛(**非 admin 剥 edit 段**,fail-safe)→ HumanMessage 前缀 `[页面上下文] {json}`。edit 段仅 `{postId,title}` 上行,getContent/onApplyContent 函数型 props 不过 wire
- **admin 工具面扩至 12(⑧-b/⑧-c)**:base 6 + `read_draft`(adminThreadDeny 会话级守卫 + status≠deleted 过滤 + TOOL_BODY_MAX 截断)+ `propose_edits` + topic 4。纵深防御:工具体内 `assertAdminThread`(searchAgentSession visitorId `admin:` 前缀)二次校验;ADMIN_PROMPT_ADDENDUM 增「文章编辑上下文/改稿纪律」两节(oldString 逐字符复制且全文唯一、提案不落笔、严禁被接受前声称已修改、unavailable 引导回编辑页、连续提案至多两轮)
- **propose_edits HITL 链路(⑧-c)**:bare `interrupt()` 双模(edits ≤20 块 S/R,old/new 各 ≤8000;rewrite ≤50000 整档;zod XOR 校验)→ 前台按 interrupt value.kind 分发:有评审接线(embedded + 函数型 props)走评审模态,否则降级卡(ProposeUnavailableCard 自动 resume unavailable,零服务端状态);resume 四态 applied/partial/rejected/unavailable。ask-user-guard 泛化改名 **interrupt_guard**(INTERRUPT_TOOLS = ask_user ∪ propose_edits,judgeInterruptFlight 反向扫描首触发 AIMessage,同类单飞防并行中断 resume 错投);stream resume union 按 kind 判别(kind 省缺 ask_user 向后兼容)
- **封面候选 HITL(M31 验收反馈,2026-10-15)**:`generate_post_cover`(admin,工具名与 topic 域 `generate_cover_candidates` 错开防注册冲突)——loadCoverPostContext 直读库内上下文(全部标签+正文)→ cover-gen 队列 **hold 生图**(临时盘 `$MEDIA_DIR/.cover-gen-tmp/<token>/`,虚拟路径,不进媒体库)→ 工具体内轮询出图后 bare `interrupt()` 挂起,前端 `CoverCandidatesCard`(候选图 fetch 带 `x-cover-token` 头走 `GET /api/posts/cover-candidates/[id]/raw` 预览接口后转 blob——token 不进 URL 不落访问/代理日志(技术债批④),会话鉴权;已入库行 302 正式路径)+ 每张「入库」/整批「放弃」;resume `{decision:"adopt",candidateId}|{decision:"discard"}` 回灌,adopt 分支才 `uploadMedia` 入库(行 mediaPath 切正式路径+清临时,幂等),discard 清整批临时;悬空中断/顶替遗留的孤儿目录由 cover-gen 队列 `temp-sweep` job 日频清扫(24h 过期回收)。**确认入库是机制保证**(HITL 卡),非提示词约定;方向对齐 = ask_user(种子消息+工具描述双重引导)。编辑页弹窗「AI 生成封面」入口改为唤起侧边栏 Agent(EditorAssistant `launch` prop → injectAsk 直发)。INTERRUPT_TOOLS 同步收编(单飞守卫覆盖)
- **diff 评审面(⑧-d)**:proposal-apply.ts 纯函数定位/合并——精确唯一命中(exact)→ 多处命中歧义直判 miss(不走模糊兜底)→ dmp match_main 模糊兜底(相似度 ≥0.6 才收,fuzzy)→ miss 不阻塞其他块;merge 按起点正序、区间重叠丢弃后者。ProposeReviewCard 全屏模态(overlay 即评审互斥,免编辑器 readOnly 接线):逐块 dmp diff 视图 + 接受/放弃 toggle + 应用所选(经 editContext.onApplyContent 写回编辑器 setContentMd → 既有自动保存链落库)+ 拒绝;rewrite 档 @codemirror/merge 只读对照。undo 口径降级:写回同 shadow restore 路径,undo 历史自写回点重启,真机验证遗留批⑨
- **三入口常驻化(2026-10-14,用户反馈「编辑页关侧栏即杀 run」)**:AssistantCard(FAB/编辑器 embedded)与 AgentDrawer(搜索页)统一改「首开才挂载(`everOpened`),此后关闭仅 `display:none` 隐藏」——run 活跃期关卡不再触发 SDK 卸载 abort(卸载=流取消,服务端 run 一并终止且零 checkpoint);线程/会话/输入态跨开关保留。身份判定仍按 open 逐次复判(Drawer),显隐偏好语义不变

**K2.8 补注五(2026-10-14,M30 批①~④,Agent 技能化——流程纪律为后台可管理资产;skill 扩展性三层定调)**:用户定调未来 agent 写作等功能持续扩展(「公众号文章必须提炼要点渲染 HTML 以配图加入」类业务过程会越来越多),扩展性做系统考量以支撑更多 skill、MCP 与工具调用。落成三层:**知识层** = `agent_skill` 表(流程纪律 markdown,后台「模型配置→Agent 技能」页签建改即时生效零发版);**能力层** = 代码工具(agentToolsFor 单点装配,机械执行不进 skill);**接入层** = MCP(未来在同一点挂 adapter,不预建)。分工纪律:skill 教 agent **决策与纪律**(markdown 引用工具名),工具/管线做机械执行。

- **`agent_skill` 通用技能表(批①,迁移 `20261014200000_agent_skill`)**:`key varchar(50)` 唯一(agent 稳定引用,建后不可改)/`name/scenario(一行,agent 对号场景)/guide_md text(指南正文)/enabled`(停用后 agent 侧即时不可见)。**通用表定位**:写作指南、分发流程等知识型纪律均落此表,不预建 kind/结构化匹配(YAGNI);种子(upsert `update:{}` 不覆盖后台编辑)收编原 ADMIN_PROMPT_ADDENDUM 硬编码「博主×视频」指南并增**码点预算段**(markdown ≤4500 码点/表格每张 ~2200/超限删除优先级);soft ref 语义:skill 删/停后专题绑定降级为按场景自动匹配,不阻塞
- **渐进披露工具(批②,`skill-tools.ts`)**:`list_skills`(元数据清单 key/name/scenario,写前对号)/`get_skill`(按 key 取全文)——与 deepagents 1.14.2 `createSkillsMiddleware`(SKILL.md frontmatter → 元数据缓存 → wrapModelCall 注入 → read_file 按需)同范式,差异:真相源为 DB 行非静态文件(后台建改即时生效),每次 list 恒新(无线程级缓存陈旧风险);prompt 注入换显式中文时序条款(系统提示只留「技能调度」段:动笔前必先 list_skills → 按 scenario 对号 → 命中 get_skill 全文,**指南优先于提示通用写法**;topic.skill_key 已指定直取不自行匹配;清单为空按常识写并汇报「未命中适用技能」)
- **专题定向绑定(批②,`topic.skill_key` 可空列,迁移 `20261014210000_topic_skill_key`)**:专题面板 select 绑定(仅列启用技能,PATCH 存在性核验 400);get_topic_brief 载荷携 skill_key,合成写稿定向取指南
- **码点预算自查(批③,`measure_wechat_budget` 工具 + `wechat-budget.ts`)**:落稿前对拟交 markdown 服务端真跑 renderWechatHtml 计码点(与推送校验同口径,非文字数估算),返回总/纯文本/表格/标记四段分解 + usagePct + 超限判定与精简建议(超预算必精简后复核再交稿);同步弹窗正文码点实时计数复用 preview HTML(客户端 `[...html].length`,与服务端同口径零新 API)
- **admin 防线同构**:两批工具体内 `assertAdminThread` + fail-closed deny(纵深防御同 topic-tools);e2e 38 钉技能页签 CRUD/启停落库/专题绑定/非法 skillKey 400(零真网)

**K2.8 补注六(2026-10-17,M31,图文卡片——agent 把编排 HTML 渲染成图嵌入文章与公众号;笔记富排版核心功能)**:

- **分层定稿(用户核对:架构清晰、层次分明,不在代码中 hardcode 业务需求逻辑)**:**知识层** = `agent_skill` DB 行「卡片使用指南」(何时用 preset vs 自由 HTML/嵌入纪律,后台建改零发版,不进代码种子);**工具层** = `render_card`(`lib/agent/card-tools.ts`,admin 档,`assertAdminThread` 同构防线);**业务层** = `src/lib/card/`(presets.ts 五模板 + sanitize.ts 消毒 + render.ts 渲染客户端);**设施层** = `services/card-renderer` sidecar(纯渲染引擎,零业务语义)。工具调返回 `{ok,url,width,height,hint}`,hint 引导正文以 `![](url)` 嵌入——产物经 `uploadMedia` 入库(sha1 去重幂等),公众号 transload 链路天然兼容零扩面
- **双模工具(用户选定)**:`preset`(quote 金句/points 要点/stats 数据指标/compare 双栏对比/steps 步骤,数据入 schema zod 校验,~300-600 token/卡,常规优先)+ `html`(自由 HTML,工具入参 zod 12k 硬顶,消毒白名单闸后入服务,~800-2000 token/卡);二选一互斥。**token 五层控制**:额度档兜底(agent 既有)→ 工具入参 12k 硬顶 → preset 骨架省写(模型只出数据不出样式)→ 禁手写 base64(消毒 img src 仅认 data:image 与站内 `/wp-content/uploads/`,提示引导站内引图)→ 返回极简四键
- **消毒(`sanitize.ts`,自由模唯一入服务闸)**:cheerio 白名单——script/iframe/svg/math 等危险标签整体报错、无害未知标签解包保文本;属性仅留 class/style(img 另留 src/alt/宽高),on* 与 javascript: 必拒;`<style>` 放行但滤 @import 与外联 url()。**有意违规不静默剥除而是整体报错**(人话逐条 cap 5)——agent 自纠重试;service 侧硬闸兜底(纵深双层)
- **站内引图零 token 链**:消毒放行的 `/wp-content/uploads/` URL 经 `rewriteLocalMediaRefs` 改写 `file://$CARD_RENDERER_MEDIA_ROOT/…`(前缀剥掉直接拼根,storage.ts 同约定)→ 服务侧 `inlineLocalMedia` 读盘(路径包含校验防遍历 + 8MB 上限)转 **data-URI 内联**——chromium 完全不触文件系统(about:blank 源默认禁 file:// 子资源,直读路线不可行,内联是正解);读失败降级 1x1 透明占位不整卡失败
- **sidecar 契约**(arch/05 §4.6):`POST /render {html,width?,scale?}` → PNG 字节 + `X-Card-Width/Height` 头;javaScriptEnabled=false + 请求级硬闸(仅放行 data:/about:blank)+ 并发信号量满员 429 + 高度 413(超 4000px 提示拆卡)+ 504 超时,错误全人话短句供 agent 直接转述;CARD_RENDERER_URL / CARD_RENDERER_MEDIA_ROOT 双 env(与 compose 挂载三处一致)。CI 增 card-renderer 单测 job(node --test 零依赖)+ docker-release-card-renderer 镜像段;生产部署(175 加容器)合并后另批请批
- **工具参数漂移收编(2026-10-18,ledger rows 整线程三连败 checkpoint 取证)**:弱模型会把 JSON 数组包成 `{"item":{"item":[…]}}` 单键对象再发(与 ask_user options 漂移同源同键名),且 zod 英文原话报错回喂也无法自纠。三层修正:`lib/card/normalize.ts` 在校验前递归展开实证包裹形态(单键 item 且链终为数组,未知形态仍 fail-closed,命中记 `agent.card_args_normalized` 观测漂移率)→ preset 报错人话化(中文类型说明 + 直接传数组修正示例)→ 工具 describe 补数组字段纪律。数据形状属机制(harness)不入指南 L2

**K2.8 补注七(2026-10-17,M35,Agent 宿主唯一化——run 生命周期与页面组件树解耦;M31 验收两问根因修复)**:

- **根因**:专题合成/编辑页均页面自持 AssistantCard,路由切换 → 页面组件树卸载 → SDK 断 SSE 流 → stream route `cancel()` → `abort.abort()` 服务端 run 终止(usage 照记,不可恢复)。生产实证:合成 run 止步 write_todos(4h 唯一一条 search_agent 用量),关联文档无新稿
- **红线(ESLint `no-restricted-imports` 机器守)**:`AssistantCard` 全站仅宿主 `AssistantFab` 一处实例化——宿主挂**根 layout**(跨路由持久,admin↔site 同理),首开才挂(零前置开销),此后关闭/隐藏/切页仅 display:none,在跑 run 不中断
- **页面接入两协议**(`src/lib/agent/agent-host.ts`,window CustomEvent 机制,零组件树耦合):① **唤起** `openAgentAssistant(ask?)`→ `agent:open` 开卡+可选预置问句直发/预填(ContactLauncher/TopicComposeActions/EditorAssistant 同款);② **能力注册** `useAgentEditSurface(surface)`→ `agent:surface` 挂载注册/卸载自动注销编辑面 getContent/onApplyContent 写回接线(注册句经 getter 透传最新引用,宿主 state 仅在场性变更)——能力不在场时 propose_edits 评审自动降级 ProposeUnavailableCard(既有语义,run 存活),切回编辑页且中断未 resume 则评审面恢复
- **路由策略**(纯函数 `agentFabButtonVisible`,单测覆盖):编辑页 `/admin/posts/<id>` 与登录页 `/admin/login` **藏按钮不卸卡**(M27「编辑页顶栏入口」UX 保留,退役令收窄);卡永驻全路由
- **诚实边界**:刷新/关标签页仍断 run(SSE 流式架构固有,跨刷新存活需后台化=BullMQ+流重连,量级另立);/search AgentDrawer 独立会话面不收编(页面即场景)

**K2.8 补注八(2026-10-17,M38,卡片视觉系统——11 卡型双主题 + 信息设计纪律;美观问题立项:preset 版面素、自由模天花板低)**:

- **卡型扩容 7→11**:dark 深空系=观点/数据(quote/points/stats/bars/ledger),light 浅色系=流程/方法(compare/steps/flow/timeline/matrix/photo);新增 bars 量级条形、ledger 键值台账、matrix 要素矩阵、photo 大图卡(图片呈现降级为常规一卡,「图文并茂」语义=可视化/美观化/清晰,非补图)。全文同色系不混彩(跨系以小节为界);强调色模板按数据确定性轮换(`pickAccent` hash,同数据同色,3 深色系+3 浅色系 CSS 变量注入),agent 不指定
- **去 AI 味视觉纪律(frontend-design 清单校准)**:去发光光斑/渐变强调字/全大写字距眉题;「越大越轻」字重(display 700 非 800/900),数值 tabular-nums;编号只用于真序列(steps/timeline),并列要点用方点/图标标记;单装饰原则(.ac-line 顶条+.ring 弱圆);stats 首条自动放大为主指标 + delta 涨跌自动着色(▲绿▼红)
- **结构拆分**:`preset-schemas.ts`(11 zod schema 即数据契约)/`preset-samples.ts`(样张,CardTemplateLab 调试台同源)/`templates/data-cards.ts`+`templates/photo-cards.ts`(新卡面);presets.ts 只留注册表与分发。渲染管线与消毒不变
- **知识层归位**:卡片选型纪律此前只存 DB(M31 旧文本,五卡型口径已过时)——M38 起指南文本真相源在 `src/lib/ai/writing-guides.ts`(`CARD_RENDERING_GUIDE` 常量,与 seed 同源),DB 行走 oneoff(`scripts/oneoff/blogger-guide-m38/`)整体替换;卡型路由/信息设计纪律(压缩阶梯/标题动词后果/结构即信息/版面节奏禁连续同型)只住指南 L2,agent.ts 提示词不 hardcode(既有测试断言锁)
- **全站统一深空(2026-10-18,用户裁定:一篇文章配图风格必须统一——M38 双主题/内容定系口径退役)**:根因复盘:①「同色系不混彩」写成指南纪律(跨系以小节为界)即依赖模型自觉,实测模型循指南跨节混用产出暗浅混排文章;② per-card `pickAccent(hash(数据))` 按卡轮换是第二不一致源(同篇各卡强调色各自为政)。修正属确定性机制,不入指南 L2(harness-vs-hardcode 分层判据——改规则要发版的进代码):(a) 11 卡型全量统一深空主题:`light-cards/light-flow` 更名 `structure-cards/swimlane-cards` 并深空重皮,`wrapDocLight`/浅色 accent 组退役,`PRESET_META` 去 theme 字段;(b) accent 改**按文章锚定**:工具层传 `thread_id` 作 accentSeed(`renderPreset(preset, data, seed)`),同篇恒同 accent 组、跨篇轮换破「每篇同款」,缺省(admin 实验室预览)退回按卡内容取组;(c) 指南同步:卡型路由去(深色)/(浅色) 标注、主题系纪律条目退役、html 自由卡底色口径对齐深空系(#0b1220 系),oneoff `scripts/oneoff/guide-dark-unify/` 落库;回归锚:11 卡型输出必含 #0b1220 + 同 seed 同 accent 组单测

**K2.8 补注九(2026-10-18,render_card 传参容错扩编 + 自由 HTML 宽容化——生产两连败复盘)**:

- **根因复盘(checkpoint 取证,生产 ledger/matrix 三连败 + 自由模 accent 盲猜)**:① 弱模型工具参数漂移不止单键包裹一形——实证四形态:`{item:[…]}` 包裹(PR #105 已收编)、**字符串化 JSON**(`rows: "[[{…}]]"`,JSON.stringify 后再嵌引号)、**双重嵌套**(`[[{…}]]`)、**二元数组行**(`[["键","值"],…]`);错误反馈触发「自纠」反而产出新漂移形态(越修越歪,不收敛);② 失败侧零日志(仅 normalized 有 `agent.card_args_normalized`),每次排障都要翻 checkpoint;③ 自由 HTML 模式消毒壳是 M31 白底硬壳(`background:#ffffff`),模型按指南手写深空壳时 thread accent 不可见只能盲猜(实证猜 #38bdf8、本篇实锚 #a78bfa,色组错位)
- **P1 传参容错(1~2 轮收敛)**:(a) 归一层扩编三个实证修复(字符串化 JSON 解析/单元素外层剥壳/二元数组行→`{k,v}`;仍 fail-closed,只收编实证形态,零合法冲突——无 preset 消费数组套数组);(b) 报错具体化:`formatPresetError` 按 issue.path 回查原始入参形态给「收到了什么」+ 可抄修正示例(嵌套数组模式在外层点破,逐行修不收敛;补 zod v4 `received` 取不到的缺口);(c) 观测补齐:失败侧落 `agent.card_preset_invalid`(数据截断 800 字符)。回归锚:normalize.test 四形态 × renderPreset 串联
- **P2 自由 HTML 宽容化(用户裁定:任意合法 HTML 都可渲染;美观走指南 L2 + 自检,机制不强制)**:(a) 消毒安全红线不变(危险标签/事件属性/js URL/外联整体报错),文档结构标签(html/head/body/meta/title/doctype)改静默摘除——写整份文档不再撞「禁用标签 <meta>」整体报错,写片段即可;属性白名单放宽 id/colspan/rowspan(无脚本面);(b) 输出壳白底改**深空基线**(#0b1220 底+浅字+Noto CJK+min-height:600 与 preset 壳同语言)——模型没写样式也落全站统一深空,自带样式文档序后置可整体覆盖(白底等自定义照常渲染);(c) **accent 通道**:工具响应回传 `accent{main,soft,text}`(thread 锚定同组),自由模取用即与同篇 preset 卡恒同组,盲猜通道退役;(d) 美观纪律(深空可视化系统 token 表:底色/文字三级/accent 用法/tabular-nums/单装饰器 + **出卡自检清单**:对比度/单 accent/height 正常/3 秒读懂)只住 `CARD_RENDERING_GUIDE` L2(oneoff `scripts/oneoff/card-guide-html/` 落库),harness 不 hardcode——与补注八分层判据一致

**K2.8 补注十(2026-10-18,post-319 双问题复盘——教程意图无入口 + 文章上下文够不着素材)**:

- **根因(checkpoint + 库取证)**:① post 319(WorkBuddy做汇报ppt,教程类视频)按专题治理按钮合成,话术「合成**推荐文章**」写死于 `TopicComposeActions`(体裁被焊死),专题定位即推荐系,技能表仅 blogger-video(推荐短文)——「教程」意图在链路上**无任何入口**,编排模型显式选 blogger-video 出推荐稿(模型无过错);② agent 取素材唯一入口 `get_topic_brief` 必须给专题 id,而文章编辑上下文只有 post id,无 post→topic 反查工具——实证对话:agent 只能 `read_draft` 读正文,答「原始材料是抖音视频」(1594 字解读笔记在库不可达)。
- **修法三层**:(a) **指南 L2**:BLOGGER_VIDEO_GUIDE 增「教程类视频」分支——判据(标题/解读笔记含教程·实战·保姆级等信号或用户点名)+ 写法(核心内容笔记=可跟做的文字版教程:第二人称分步/界面动作与输入内容/关键数字保留/结尾验收点)+ 反例禁令(禁「视频演示了…」式第三人称转述);oneoff `scripts/oneoff/blogger-guide-tutorial/` 落库。(b) **撰写目的预置**(`src/lib/topics/constants.ts#TOPIC_PURPOSES`):user-facing 目的=定位模板+合成话术体裁词,落库走 positioning 零 schema 变更;面板「绑定技能」下拉退役换「撰写目的」(切目的自动带模板,自定义文案不覆盖),关联文章 id 改只读展示;合成区加目的 picker(缺省按定位匹配)+ 可选补充要求单行框,话术带体裁词;admin 提示词补「指令指定体裁时以其为准,不被定位惯性带偏」。(c) **`get_post_sources(post_id)` 只读工具**(post→topic(linked_post_id)→挂载素材,解读笔记全文/人工批注/视频地址/文章节选;纯读零副作用与 brief 分工——brief 是生产底料装配含封面转存);改稿纪律同步「文章上下文用 get_post_sources、已知专题 id 用 get_topic_brief」。

**K2.8 补注十一(2026-10-20,撰写体验三问题复盘——「卡住」与「只会套模板」;富 HTML 正式化)**:

- **根因(实测 + checkpoint 取证)**:① 每轮把指南 + 素材 + 完整 draft_md + 每张卡的自由 HTML **全量重发**,token 近平方增长,单轮 40 万撞会话闸 → 表现为「生成中突然停住」;② nginx `/api/search/` `proxy_read_timeout 120s` + SSE 无心跳,长工具调用(出卡/封面)静默断流,客户端 reader 正常结束、UI 无提示;③ 护栏触发无结构化日志,排障只能翻 checkpoint;④ 指南「出卡自检(逐条过,不过就改了重渲)」诱导盲重渲——模型看不到成图,凭想象反复重渲(实证同一诉求 11 次 render_card、MiniMax 与 Kimi 同样发生),叠加大 HTML 重发把预算烧穿;⑤ 答案卡/Drawer 的受约束渲染器无图片支持,`![](url)` 按字面量显示,卡片在 Drawer 里「看不见」
- **修法(机制层,发版生效)**:`contextTrimMiddleware`(`src/lib/agent/context-trim.ts`,wrapModelCall 请求副本改写、零持久化、无改动同引用透传)——规则 1 把**已渲染**的 render_card 调用 `args.html` 换成占位文本(preset/data/width/maxHeight 保留;**最近 2 次不剥**——实测模型会回读自己上一轮的 tool_call 参数,看到占位即误判「我刚才传的是占位符、写漏了 HTML」而重渲,重渲又被剥成占位,形成一轮 20+ 次 render_card 的死循环,Kimi/MiniMax 同现;留最近两次破环),规则 2 仅当估算 >150k 字符时把较早的 `get_topic_brief`/`get_skill`/`list_skills` 结果换占位(每种留最近一次);`write_article`/`save_topic_draft`/render_card 结果/human 消息永不动。**占位回显防呆**:render_card 收到含占位文本的 html 直接拒渲(模型偶有抄回占位再渲,出的是无意义卡)。SSE 每 15s `: ping` 注释帧 + nginx read timeout 300s。admin 默认额度 120 次工具 / 60 万 token(site_config 可覆盖)。护栏与收尾落 `agent.run_guard_tripped` / `agent.run_done` / `agent.context_trimmed`
- **纪律层(指南 L2,oneoff `scripts/oneoff/card-guide-rich-html/` 落库)**:自检改「在写 HTML 时逐条过,渲染出来后就不再返工」,补布局自查(class 必须在同一份 `<style>` 里定义,否则 flex/grid 塌成单列);**一次定稿**——渲染成功即采用,仅工具报错或返回 height 异常矮/超高时修正一次,同一张卡至多 2 次,禁止连环重渲;工具描述同步同一纪律
- **答案卡/Drawer 出图**:受约束 markdown 增 img 块(见上文 K2「答案渲染」注记),render_card 返回的 `markdown_line` 原样写入正文即可见

**K2.8 补注十二(2026-10-20,WorkBuddy PPT 合成验收反馈——多卡叙事与双端适配)**:

- **反馈**:PPT 式题材合成仍落 preset 常规卡(指南双路径下 preset 是常规形态默认,弱模型循省 token 惯性);内容一张卡承载不了时缺主动拆卡策略(只有 413 被动兜底);产物要便于手动发公众号与小红书。
- **修法(纪律层 L2,真相源仍 `writing-guides.ts`,oneoff `scripts/oneoff/card-guide-multicard-platform/` 落库)**:①成品感题材(PPT 式汇报/全景长图/多栏海报/数据看板)默认 html 整版设计;②多卡叙事——预计超高或版式异质即按叙事弧拆卡(总览主卡→论证各卡→结论/行动卡),系列统一 accent/版式、卡角 N/M、单张独立可发布,拆卡不降级回 preset;③双端适配——公众号 900 宽默认即适配,小红书素材 html 竖版 3:4(1080×约 1440,maxHeight 1440 防溢出)或 1:1。机制零变更(1080/1440 均在既有 width 320~1600 / maxHeight 400~8000 契约内)。

### 3.5 分期

- **第一迭代:K1 检索基座 + K2 答案卡**——**已交付(2026-10-06,批①②③)**:页面式;TS 进程内单轮 RAG,SSE 流式(K1 落点 `src/lib/search/unified-search.ts`,K2 落点 `src/lib/search/answer-*` + `GET /api/search/answer/`;实施注记 §3.2/§3.4)
- **第二迭代:K2.5 Drawer 会话 Agent**——**已交付(2026-10-07,批①~⑤)**:deepagents + assistant-ui + checkpoint(落点 `src/lib/agent/*` + `/api/search/agent/*` + `src/components/site/agent/`;实施注记见上)
- **第三迭代:K2.6 游客模式 + 后台会话管理 + 工具面收紧**——**已交付开发(2026-10-07,分支 feature/agent-guest-mode 批①~④,用户六项需求;实施注记见上)**
- **M22 迭代:K2.7 全站悬浮助手 + 用户 Token 额度 + 反馈系统**——**已交付开发(2026-10-09,批①~⑤;账号中心/订单/消耗页为 user 域,见 arch/03 §2.2;实施注记见上)**
- K3 站点内容 MCP 随 K1 就绪解锁(同检索层,对外只读工具面)

## 4. AI 服务治理后台(2026-09-30 原型锚点;模型配置 M8 批⑥ 已提前落地,余项二期)

所有 LLM/ASR 生产任务(电报解读 / 文字摘要 / Agent 搜索 / 封面生图)共用的治理后台;原型 [admin-models](../prototypes/admin-models.html) / [admin-usage](../prototypes/admin-usage.html) / [admin-sessions](../prototypes/admin-sessions.html):

- **模型配置(admin-models)**:模型条目台账(供应商/协议/模型 ID/Base URL/API Key 加密落库仅回显尾 4 位/用途与能力/默认与备用定位/启停/最后测试)+ ASR 渠道配置(转写即删,arch/02 §3.2)+ 任务绑定(电报解读/文字摘要/Agent 搜索/封面生图/向量嵌入/文章写作六角色槽的主力与备用——M8 四角色起步,M20 增嵌入、M26 增专题合成(该槽已随 M27 批⑤ 退役,合成走 Agent 搜索绑定)、2026-10-17 增 writing(专题文章起草单任务 write_article 专用,与编排 search 绑定解耦);测试连通性入口
- **用量统计(admin-usage)**:近 7/30/90 天 tokens 与估算费用 / ASR 时长 / 降级次数 KPI,日消耗趋势、按任务与按模型分布、按任务明细(含 CSS sparkline)——数据源为调用日志聚合,与成本护栏(arch/02 §3.2)共用口径
- **会话管理(admin-sessions)**:按任务类型/状态/触发/日期筛选调用记录;详情抽屉展示入参出参 JSON 与垂直执行时间线(listing→下载→抽轨→ASR→LLM 解读→入库→转写即删,节点带耗时),失败记录可重跑

> **落地注记(2026-10-04,M8 批⑥)**:三 Tab 中「模型条目/ASR 渠道/任务绑定」已随 `/admin/models` 提前交付(三表见 [arch/03 §2.4](03-data-model.md);7 路由见 arch/05 §5)。**M30 批① 起增第 4 页签「Agent 技能」**(`agent_skill` CRUD,机制见 §3 K2.8 补注五;路由见 arch/05 §5 agent-skills 行)。
> - 密钥口径:Cookie 池与 API Key 同箱——主钥 HKDF-SHA256 从必有 env `AUTH_SECRET` 派生(`src/lib/crypto/secret-box.ts`),AES-256-GCM 密文落库,write-only 只回显掩码;**轮换 AUTH_SECRET = 存量密文失效**(Cookie 重导、Key 重录)
> - 探针支持面:LLM openai(Bearer,`{base}/chat/completions` max_tokens=1 ping)/ anthropic(`x-api-key`,`/v1/messages`);ASR openai(`{base}/audio/transcriptions`)/ minimax(`/v1/speech_to_text`,`base_resp.status_code` 业务错归因)——1s 正弦波实调转写,转写空文本属成功;`protocol=other` 诚实 skipped 不落 last_test;探针永不 throw,15s 超时
> - 消费入口(**M9 已消费**):`src/lib/ai/resolver.ts#resolveAiModel(role)` 按绑定解析主力/备用(主力停用回落备用),apiKey 解密仅在服务内存——interpret 角色(ASR 走 `asr_config` 直查)已在视频解读管道(`src/lib/telegram/interpret-video.ts`)与 ASR/LLM client(`src/lib/ai/asr-client.ts`/`llm-client.ts`)落地
> - 归二期(M9+):额度降级自动主备切换、用量统计、会话管理、成本护栏联动

## 5. 待明确(细化时回答)

- ~~agent 编排形态:单 agent 工具集 vs 多 agent 流水线~~ **已定(2026-10-06,§3)**:K2 答案卡为单轮 RAG;K2.5 Drawer 为 deepagents 单 agent + 工具循环,子 agent 能力框架预留、首版不启用
- ~~agent 身份与配额:复用 PAT 还是独立主体、计量口径~~ **已定(2026-10-06,§3.3/§3.4)**:无独立主体——复用 `search` 任务绑定(model/key/daily_max)与 `ai_usage_log`(role=search)计量,与 interpret/summarize 同一套治理
- ~~安全边界:哪些 mutation 允许 agent 触达、审计要求~~ **已定(2026-10-06,§3)**:K 系列只读(检索/读站内内容),不触达任何 mutation;审计 = `ai_usage_log` 逐次落行 + 会话管理(admin-schemas 余项,归 arch §4 二期范围)
- ~~Agent 搜索的检索/生成选型(§3,随二期立项)~~ **已定并实施(2026-10-06,§3.2)**:检索 ILIKE 词项计分起步(PG simple 分词对中文无效,tsvector 弃);生成直连 LLM 进程内;zhparser/pgvector 混合留实效实测后再评审——**2026-10-08 M20 已升混合检索**(pgvector + RRF,§3.2),生成侧不变
- ~~会话留存期与清退(Drawer 线程 checkpoint 数据保留多久、是否给用户「删除会话」)~~ **已定(2026-10-07 用户拍板)**:30 天自动清退(worker 日清,行+checkpoint 同删)+ 用户可删(DELETE 路由归属校验)
- ~~Drawer 抽屉在 /search 之外的入口范围(全局 FAB vs 仅搜索场景)~~ **已定(2026-10-07 用户拍板)**:仅 /search 场景——答案卡追问 chips 唤起(直发)+「继续深挖」按钮(预填),不做全局 FAB **(2026-10-09 M22 批④ 推翻:全站悬浮助手上线,入口决策见 K2.7 注记)**
