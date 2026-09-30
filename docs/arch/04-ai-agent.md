# AI Agent 体系设计(骨架 + Agent 搜索锚点)

> 状态:占位骨架(2026-09-30 建立);同日补「Agent 搜索」需求锚点(§4),细化待二期立项。

## 1. 定位

智能体在本站的接入形态与演进路线:从「工具被调用」(MCP)到「agent 自主执行任务」(采集/创作/分发/搜索作答)。

## 2. 已有决策锚点

- **一期(M5)创作 MCP**:`/api/mcp` Streamable HTTP 端点,Bearer PAT 鉴权,upsert_article / upload_media / publish(requirement §3.6)
- **二期站点内容 MCP**:同端点扩对外只读工具集(搜索/读文章;development-plan §3)
- **二期封面 AI 文生图**(混元);开发期的图片素材管线用本机 zhipu-image MCP 辅助——属开发工具,非站内能力
- 异步底座:agent 触发的长任务一律 BullMQ(arch/05-services §4);短视频解读管道(arch/02 §3.2)是第一个 LLM 生产任务

## 3. Agent 搜索(2026-09-30 需求锚点,二期)

首页控制台输入框 + `/search?q=` 结果页的 Agent 化形态(需求 requirement §4;原型 site-search.html):

- **检索聚合**:一次 query 并发检索三域——`telegram`(资讯,含短视频解读)/ `content_post`(教程,博主文章)/ `github_repo`(项目),合并分组返回;与站点内容 MCP 的「搜索」工具**共用同一 service 层**(给人搜索 = 给智能体检索,同源不漂移)
- **AI 答案卡**:命中达到阈值时生成——结论段 + 引用角标 `[n]` 溯源到站内条目 + 「✦ AI 生成 · 基于 N 条站内内容」标注 + 追问建议 chips;**答案必须可溯源**,站内 0 命中时明示「站内无命中,AI 直接作答」,不伪装检索结果
- **展示**:分组命中列表(mark 高亮 + 渠道 chip + 命中度)+ 空态保留基础检索兜底;生成失败降级为纯检索结果页
- **实现选项(立项评审)**:检索 = PG 全文(tsvector)起步 vs pgvector embedding 混合(多语言中文分行情待测);生成 = 直连 LLM API vs 经自有 MCP 端点复用;与 §2 站点内容 MCP 的关系 = 同检索层、不同鉴权与工具面

## 4. 待明确(细化时回答)

- agent 编排形态:单 agent 工具集 vs 多 agent 流水线
- agent 身份与配额:复用 PAT 还是独立主体、计量口径
- 安全边界:哪些 mutation 允许 agent 触达、审计要求
- Agent 搜索的检索/生成选型(§3,随二期立项)
