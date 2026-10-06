# AI Agent 体系设计(骨架 + Agent 搜索锚点)

> 状态:占位骨架(2026-09-30 建立);同日补「Agent 搜索」需求锚点(§3)与「AI 服务治理后台」原型锚点(§4)。**2026-10-06 Agent 搜索立项定稿**(§3:交互两层/检索基座/技术栈全 TS/成本护栏/分期),K1 检索基座 + K2 答案卡进入实施(第一迭代),K2.5 Drawer 会话 Agent 第二迭代。

## 1. 定位

智能体在本站的接入形态与演进路线:从「工具被调用」(MCP)到「agent 自主执行任务」(采集/创作/分发/搜索作答)。

## 2. 已有决策锚点

- **一期(M5)创作 MCP**:`/api/mcp` Streamable HTTP 端点,Bearer PAT 鉴权,upsert_article / upload_media / publish(requirement §3.6)——**已交付(M5-c,2026-10-03)**:六工具(增 get_article/list_articles/unpublish)一律 slug 为键,stateless 每请求新建 transport 适配多实例,e2e 钉协议面;真机接入:`claude mcp add --transport http aitech-hub <base>/api/mcp/ --header "Authorization: Bearer ahp_<token>"`(trailingSlash 站点带尾斜杠)
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

- **配额口径**:`countTodayRoleUsage("search")` = `ai_usage_log` 当日(北京日界)`role=search` 且 `status∈{ok,degraded}` 行数(终败不占);缓存命中**计配额**(落 tokens 0 行);无绑定/超配额单帧 `unavailable` 不落台账(无 LLM 调用)
- **降级三路径**(no_binding/quota/error)一律 SSE `unavailable` 事件,不占 HTTP 状态,前台无感;IP 频控 10 次/分(`rate-limit.ts`,Redis 挂放行)
- **0 命中仍生成**(requirement §4 红线「AI 直接作答」):prompt 换无资料变体(凭模型知识、不用 [n]),meta.noHits 标注,答案卡明示「站内无命中 · AI 直接作答」
- **追问 chips**:单次调用哨兵分隔(`###FOLLOW###` + 恰好 3 行,≤20 字/条);流式侧 `visiblePrefix` 扣住哨兵与半截哨兵防泄漏;漏哨兵 → 无 chips 优雅降级
- **流式**:openai `stream:true + include_usage`(400 点名剥参重发,镜像 response_format 先例);anthropic 非流式兜底单 delta;断流有增量按 done 收尾(degraded 行,不写缓存)、零增量 unavailable(error)+ failed 行;备用模型 → degraded 行
- **nginx**:`location ^~ /api/search/` `proxy_buffering off`(配置随批落地);响应头 `x-accel-buffering: no`

### 3.5 分期

- **第一迭代:K1 检索基座 + K2 答案卡**——**已交付(2026-10-06,批①②③)**:页面式;TS 进程内单轮 RAG,SSE 流式(K1 落点 `src/lib/search/unified-search.ts`,K2 落点 `src/lib/search/answer-*` + `GET /api/search/answer/`;实施注记 §3.2/§3.4)
- **第二迭代:K2.5 Drawer 会话 Agent**(deepagents + assistant-ui + checkpoint)
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
- ~~Agent 搜索的检索/生成选型(§3,随二期立项)~~ **已定并实施(2026-10-06,§3.2)**:检索 ILIKE 词项计分起步(PG simple 分词对中文无效,tsvector 弃);生成直连 LLM 进程内;zhparser/pgvector 混合留实效实测后再评审
- 会话留存期与清退(Drawer 线程 checkpoint 数据保留多久、是否给用户「删除会话」)——K2.5 实施前定
- Drawer 抽屉在 /search 之外的入口范围(全局 FAB vs 仅搜索场景)——K2.5 实施前定
