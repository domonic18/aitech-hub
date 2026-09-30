# AI Agent 体系设计(占位)

> 状态:占位骨架(2026-09-30 建立)。需求明确后补充细化。

## 1. 定位

智能体在本站的接入形态与演进路线:从「工具被调用」(MCP)到「agent 自主执行任务」(采集/创作/分发)。

## 2. 已有决策锚点

- **一期(M5)创作 MCP**:`/api/mcp` Streamable HTTP 端点,Bearer PAT 鉴权,upsert_article / upload_media / publish(requirement §3.6)
- **二期站点内容 MCP**:同端点扩对外只读工具集(搜索/读文章;development-plan §3)
- **二期封面 AI 文生图**(混元);开发期的图片素材管线用本机 zhipu-image MCP 辅助——属开发工具,非站内能力
- 异步底座:agent 触发的长任务一律 BullMQ(arch/05-services §4)

## 3. 待明确(细化时回答)

- agent 编排形态:单 agent 工具集 vs 多 agent 流水线
- agent 身份与配额:复用 PAT 还是独立主体、计量口径
- 安全边界:哪些 mutation 允许 agent 触达、审计要求
