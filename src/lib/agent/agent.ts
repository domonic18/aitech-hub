/**
 * deepagents 会话 agent 构造(K2.5,arch/04 §3.3):createDeepAgent 按绑定
 * 身份缓存(id:source 变了就重建——主备切换/key 轮换即时生效,构造含提示词
 * 组装不值得每次 run 重复)。系统提示定调:计划先行(write_todos)、三域工具
 * 规范、引用作答;内置文件系统工具默认 StateBackend 无磁盘访问,明示禁用防跑偏。
 */
import { createDeepAgent, type DeepAgent } from "deepagents";

import { ensureAgentCheckpointer, getAgentCheckpointer } from "./checkpointer";
import { resolveAgentModel } from "./model-factory";
import { AGENT_TOOLS } from "./tools";

export const AGENT_SYSTEM_PROMPT = `你是「一起AI」(17aitech.com)站内搜索助手,帮助用户深挖 AI 资讯、教程与开源项目。

工作方式:
- 开始处理多步任务前,先用 write_todos 列出简短计划(2-5 项),随进展更新状态
- 涉及站内内容的事实性问题,先用 search_site 检索,再按需 read_post / read_repo 展开正文
- 站内没有相关内容时,直接用你自己的知识回答,并说明「站内暂无相关内容」

回答规范:
- 用中文回答;简洁、分点、直给结论
- 引用站内内容时标注来源链接(href);不要编造站内不存在的文章或项目
- 站内内容与你的知识冲突时,以站内内容为准并指出差异
- 内置文件工具(ls/read_file/write_file 等)与本任务无关,不要使用`;

const globalForAgent = globalThis as unknown as {
  agentGraph?: { key: string; graph: DeepAgent };
};

/**
 * 构造/取用 agent 图(checkpointer 挂 PostgresSaver,线程状态跨请求持久)。
 * 首次调用触发 checkpoint setup(幂等);绑定身份(id:source)变化即重建,
 * 未变化复用——admin 侧主备切换/启停最迟下一次 run 生效。
 */
export async function getAgentGraph(): Promise<DeepAgent> {
  await ensureAgentCheckpointer();
  const { model, resolved } = await resolveAgentModel();
  const key = `${resolved.id}:${resolved.source}`;
  const cached = globalForAgent.agentGraph;
  if (cached?.key === key) return cached.graph;
  const graph = createDeepAgent({
    model,
    tools: AGENT_TOOLS,
    systemPrompt: AGENT_SYSTEM_PROMPT,
    checkpointer: getAgentCheckpointer(),
  });
  globalForAgent.agentGraph = { key, graph };
  return graph;
}
