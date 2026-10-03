# AI Agent 体系设计(骨架 + Agent 搜索锚点)

> 状态:占位骨架(2026-09-30 建立);同日补「Agent 搜索」需求锚点(§3)与「AI 服务治理后台」原型锚点(§4),细化待二期立项。

## 1. 定位

智能体在本站的接入形态与演进路线:从「工具被调用」(MCP)到「agent 自主执行任务」(采集/创作/分发/搜索作答)。

## 2. 已有决策锚点

- **一期(M5)创作 MCP**:`/api/mcp` Streamable HTTP 端点,Bearer PAT 鉴权,upsert_article / upload_media / publish(requirement §3.6)——**已交付(M5-c,2026-10-03)**:六工具(增 get_article/list_articles/unpublish)一律 slug 为键,stateless 每请求新建 transport 适配多实例,e2e 钉协议面;真机接入:`claude mcp add --transport http aitech-hub <base>/api/mcp/ --header "Authorization: Bearer ahp_<token>"`(trailingSlash 站点带尾斜杠)
- **二期站点内容 MCP**:同端点扩对外只读工具集(搜索/读文章;development-plan §3)
- **二期封面 AI 文生图**(混元);开发期的图片素材管线用本机 zhipu-image MCP 辅助——属开发工具,非站内能力
- 异步底座:agent 触发的长任务一律 BullMQ(arch/05-services §4);短视频解读管道(arch/02 §3.2)是第一个 LLM 生产任务

## 3. Agent 搜索(2026-09-30 需求锚点,二期)

首页控制台输入框 + `/search?q=` 结果页的 Agent 化形态(需求 requirement §4;原型 site-search.html):

- **检索聚合**:一次 query 并发检索三域——`telegram`(资讯,含短视频解读)/ `content_post`(教程,博主文章)/ `github_repo`(项目),合并分组返回;与站点内容 MCP 的「搜索」工具**共用同一 service 层**(给人搜索 = 给智能体检索,同源不漂移)
- **AI 答案卡**:命中达到阈值时生成——结论段 + 引用角标 `[n]` 溯源到站内条目 + 「✦ AI 生成 · 基于 N 条站内内容」标注 + 追问建议 chips;**答案必须可溯源**,站内 0 命中时明示「站内无命中,AI 直接作答」,不伪装检索结果
- **展示**:分组命中列表(mark 高亮 + 渠道 chip + 命中度)+ 空态保留基础检索兜底;生成失败降级为纯检索结果页
- **实现选项(立项评审)**:检索 = PG 全文(tsvector)起步 vs pgvector embedding 混合(多语言中文分行情待测);生成 = 直连 LLM API vs 经自有 MCP 端点复用;与 §2 站点内容 MCP 的关系 = 同检索层、不同鉴权与工具面

## 4. AI 服务治理后台(2026-09-30 原型 v0.4.0 锚点,二期)

所有 LLM/ASR 生产任务(电报解读 / 文字摘要 / Agent 搜索 / 封面生图)共用的治理后台;原型 [admin-models](../prototypes/admin-models.html) / [admin-usage](../prototypes/admin-usage.html) / [admin-sessions](../prototypes/admin-sessions.html):

- **模型配置(admin-models)**:模型条目台账(供应商/协议/模型 ID/Base URL/API Key 加密落库仅回显尾 4 位/用途与能力/默认与备用定位/启停/最后测试)+ ASR 渠道配置(转写即删,arch/02 §3.2)+ 任务绑定(电报解读/文字摘要/Agent 搜索/封面生图四角色槽的主力与备用);测试连通性入口
- **用量统计(admin-usage)**:近 7/30/90 天 tokens 与估算费用 / ASR 时长 / 降级次数 KPI,日消耗趋势、按任务与按模型分布、按任务明细(含 CSS sparkline)——数据源为调用日志聚合,与成本护栏(arch/02 §3.2)共用口径
- **会话管理(admin-sessions)**:按任务类型/状态/触发/日期筛选调用记录;详情抽屉展示入参出参 JSON 与垂直执行时间线(listing→下载→抽轨→ASR→LLM 解读→入库→转写即删,节点带耗时),失败记录可重跑

## 5. 待明确(细化时回答)

- agent 编排形态:单 agent 工具集 vs 多 agent 流水线
- agent 身份与配额:复用 PAT 还是独立主体、计量口径
- 安全边界:哪些 mutation 允许 agent 触达、审计要求
- Agent 搜索的检索/生成选型(§3,随二期立项)
