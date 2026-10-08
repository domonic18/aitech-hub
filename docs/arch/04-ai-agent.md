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
| 单会话上限 | **≤12 步 / ≤50k tokens** | agent 主动收束并提示,防多步失控 |
| 答案缓存 | 同 `q=` **24h** 内复用 | 省钱 + 秒开;缓存行落 Redis/PG 实施时定 |
| 模型建议 | search 角色绑国产模型(DeepSeek/GLM/Qwen 级) | 单次答案卡 ¥0.005~0.1、会话 ¥0.05~1;Claude 级成本 ×10 收益边际 |

**K2 实施注记(2026-10-06,第一迭代批②/③,`src/lib/search/answer-*` + `GET /api/search/answer/`)**:

- **配额口径**:`countTodayRoleUsage("search")` = `ai_usage_log` 当日(北京日界)`role=search` 且 `status∈{ok,degraded}` 行数(终败不占);缓存命中**计配额**(落 tokens 0 行);缓存回放 meta 沿用**生成时刻** `generatedAt`(北京格式,不把命中时刻当生成时刻);无绑定/超配额单帧 `unavailable` 不落台账(无 LLM 调用)
- **降级三路径**(no_binding/quota/error)一律 SSE `unavailable` 事件,不占 HTTP 状态,前台无感;IP 频控 10 次/分(`rate-limit.ts`,Redis 挂放行)
- **0 命中仍生成**(requirement §4 红线「AI 直接作答」):prompt 换无资料变体(凭模型知识、不用 [n]),meta.noHits 标注,答案卡明示「站内无命中 · AI 直接作答」
- **追问 chips**:单次调用哨兵分隔(`###FOLLOW###` + 恰好 3 行,≤20 字/条);流式侧 `visiblePrefix` 扣住哨兵与半截哨兵防泄漏;漏哨兵 → 无 chips 优雅降级
- **答案渲染**:受约束 markdown 子集(`answer-markdown.ts`:**加粗**/`行内代码`/`[文本](URL)` 链接(href 单行无空白才成链,渲染侧 http(s) 非本站开新窗)/`-` 与 `1.` 列表/`#`~`####` 标题(收敛 2~4 级)/``` 代码围栏(未闭合到 EOF 按代码块收尾)/GFM 表格(表头+分隔行开启,单元格行内解析;行内代码含 `|` 的瑕疵接受)/空行分段;标题/围栏/表格/链接系 K2.5 验收反馈补充——技术问题下模型习惯性输出,渲染器扩子集而非 prompt 对抗),子集外字面量;prompt 同步约束排版;纯函数解析 → React 节点,不经 dangerouslySetInnerHTML(无注入面);`[n]` 上标在文本叶内二次解析
- **流式**:双协议均 SSE——openai `stream:true + include_usage`(400 点名剥参重发,镜像 response_format 先例);anthropic 标准 `content_block_delta` 流式(usage 两段式 message_start/message_delta 按 max 合并;400 点名 stream 参数回落非流式整段单 delta,同款先例——首迭代初版 anthropic 非流式兜底致答案整段一次性出现,验收反馈后升级);断流有增量按 done 收尾(degraded 行,不写缓存)、零增量 unavailable(error)+ failed 行;备用模型 → degraded 行
- **nginx**:`location ^~ /api/search/` `proxy_buffering off`(配置随批落地);响应头 `x-accel-buffering: no`

**K2.5 实施注记(2026-10-07,第二迭代批①~⑤,`src/lib/agent/*` + `/api/search/agent/*`)**:

- **wire 契约以已装 SDK 实测钉死**(`@langchain/langgraph-sdk` 1.12.1 dist 逐行核对,不信旧文档):SDK 透传原始 `{event,data}` SSE 帧;前端 `useLangGraphMessages` 识别 `messages`(tuple `[message, metadata]`)/`messages/partial`/`updates`/`values`/`metadata`/`error` 等,未知事件走 custom;chunk 形态要求 `tool_call_chunks[].index` 为 number——序列化单点收敛 `src/lib/agent/wire.ts`;客户端解码单点 `src/lib/agent/sse.ts`(K2.6 修复批,见下)
- **会话 30 天自动清退 + 用户可删(2026-10-07 用户拍板)**:行 `lastMessageAt` 超 30 天 worker 日清(STATS 队列 `purge-agent-session`,04:33 错峰)行+checkpoint 同删;用户删除走 DELETE 路由(归属校验 404 不泄露存在性,checkpoint 删失败不反噬)
- **入口仅 /search 场景(2026-10-07 用户拍板)**:答案卡追问 chips(直发)+「继续深挖」按钮(仅预填)派发 `search:agent-ask` 事件唤起 Drawer;不做全局 FAB
- **身份**:匿名 cookie `ah_av`(uuid,365d,httpOnly)即 visitor,会话行与其绑定;换设备/清 cookie 失联,30 天清退兜底;三期登录后再议账号绑定
- **模型绑定即时性**:agent 图进程级缓存按 `${resolved.id}:${resolved.source}` 键控,admin 改 search 绑定下一次 run 即生效(rebuild 落 `agent.graph_rebuilt` 日志);台账记独立角色 `search_agent`(与答案卡 `search` 的 100/日 互不侵占)
- **前端**:ai-invest 自绘件结构平移(`src/components/site/agent/` 七件),终端风 token 换装,不引 antd/zustand/react-query;threads 建删与 state 走自有 fetch(apiEnvelope);`runs.stream` K2.6 起亦为自有 fetch+SSE 解析(SDK AsyncCaller 对非 2xx reject Response 且包装 `new Error(response)`,apiEnvelope 人话/状态码全丢 → 429 配额/404 过期无法分流还会盲重试等待,用户实测 3 问后静默停止);程序化发送直写 `thread.append`(composer.setText 同 tick send 会静默 no-op);todos 提取零依赖模块 `lib/agent/todos` 客户端可安全引入;Drawer 左缘可拖拽调宽(420~920px 夹取,localStorage `agent.drawer.width` 记忆)

**K2.6 实施注记(2026-10-07,第三迭代批①~④,游客模式 + 后台会话管理 + 工具面收紧)**:

- **身份分流**(`src/lib/agent/identity.ts`):`ah_at` JWT role=admin → `{kind:"admin", key:"admin:<sub>"}`(走会话行路径,20 会话/日照旧);其余一律游客(`ah_av` cookie)。一期「登录账号」即 admin(三期才有普通用户)
- **游客线程生命周期**(零新表,`guest-threads.ts`):thread_id=`g_<uuid>`(前缀即 kind 标记);归属 Redis `search:agent:gthread:{id}`=visitorId,2h 滑动 TTL(run 成功后 EXPIRE 续期);**不落会话行**(多轮上下文由 checkpoint 承载);归属校验 fail-closed(Redis 挂 → 404 自愈开新会话),配额 fail-open(护栏非计费)
- **游客双闸配额**(`quota.ts`):3 问/日/visitor + 30 问/日/IP(防清 cookie 刷,NAT 多游客互不挤占);模型终败也计数;超限 429「今日游客提问次数已用完」
- **过期自愈**:worker 日清扫 `checkpoints` 表 `g_%` 线程,Redis 键已消失 → deleteThread(并入 04:33 job);前端 adapter 识别 404「会话已过期/不存在」→ 复位新会话 + 横幅指引重发
- **审计锚**:迁移 `20261007045121_ai_usage_log_session_id` 增 `session_id varchar(40)` + 索引——`recordAgentRun` 带 threadId,游客不触碰会话行但台账照落;后台会话管理以此聚合游客统计(见 §4 会话管理)
- **工具面收紧 + get_time**:AGENT_TOOLS 收口四只读工具(search_site/read_post/read_repo/get_time),系统提示明示「四工具之外无任何能力(无站外网页/文件系统/代码执行/写入)」超范围直说做不到;`get_time` 返回北京时区 `{iso,beijing,timezone}` 锚定相对时间
- **后台会话管理**(`src/lib/agent/admin-sessions.ts` + `/api/agent-sessions*` + `/admin/agent-sessions`):成员=会话行+台账 runs 计数;游客=`ai_usage_log` 按 session_id 聚合(`LIKE 'g%'`——成员 uuid 首字符必为 hex 不会撞 g)还原统计,活跃态查 Redis 归属键(只查当前页);两源合并按最近活动倒排内存分页;详情读 checkpoint 时间线,游客过期只留台账统计标「已过期」;侧栏「会话管理」占位激活

### 3.5 分期

- **第一迭代:K1 检索基座 + K2 答案卡**——**已交付(2026-10-06,批①②③)**:页面式;TS 进程内单轮 RAG,SSE 流式(K1 落点 `src/lib/search/unified-search.ts`,K2 落点 `src/lib/search/answer-*` + `GET /api/search/answer/`;实施注记 §3.2/§3.4)
- **第二迭代:K2.5 Drawer 会话 Agent**——**已交付(2026-10-07,批①~⑤)**:deepagents + assistant-ui + checkpoint(落点 `src/lib/agent/*` + `/api/search/agent/*` + `src/components/site/agent/`;实施注记见上)
- **第三迭代:K2.6 游客模式 + 后台会话管理 + 工具面收紧**——**已交付开发(2026-10-07,分支 feature/agent-guest-mode 批①~④,用户六项需求;实施注记见上)**
- K3 站点内容 MCP 随 K1 就绪解锁(同检索层,对外只读工具面)

## 4. AI 服务治理后台(2026-09-30 原型锚点;模型配置 M8 批⑥ 已提前落地,余项二期)

所有 LLM/ASR 生产任务(电报解读 / 文字摘要 / Agent 搜索 / 封面生图)共用的治理后台;原型 [admin-models](../prototypes/admin-models.html) / [admin-usage](../prototypes/admin-usage.html) / [admin-sessions](../prototypes/admin-sessions.html):

- **模型配置(admin-models)**:模型条目台账(供应商/协议/模型 ID/Base URL/API Key 加密落库仅回显尾 4 位/用途与能力/默认与备用定位/启停/最后测试)+ ASR 渠道配置(转写即删,arch/02 §3.2)+ 任务绑定(电报解读/文字摘要/Agent 搜索/封面生图四角色槽的主力与备用);测试连通性入口
- **用量统计(admin-usage)**:近 7/30/90 天 tokens 与估算费用 / ASR 时长 / 降级次数 KPI,日消耗趋势、按任务与按模型分布、按任务明细(含 CSS sparkline)——数据源为调用日志聚合,与成本护栏(arch/02 §3.2)共用口径
- **会话管理(admin-sessions)**:按任务类型/状态/触发/日期筛选调用记录;详情抽屉展示入参出参 JSON 与垂直执行时间线(listing→下载→抽轨→ASR→LLM 解读→入库→转写即删,节点带耗时),失败记录可重跑

> **落地注记(2026-10-04,M8 批⑥)**:三 Tab 中「模型条目/ASR 渠道/任务绑定」已随 `/admin/models` 提前交付(三表见 [arch/03 §2.4](03-data-model.md);7 路由见 arch/05 §5)。
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
- ~~Drawer 抽屉在 /search 之外的入口范围(全局 FAB vs 仅搜索场景)~~ **已定(2026-10-07 用户拍板)**:仅 /search 场景——答案卡追问 chips 唤起(直发)+「继续深挖」按钮(预填),不做全局 FAB
