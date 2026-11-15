/**
 * deepagents 会话 agent 构造(K2.5,arch/04 §3.3):createDeepAgent 按绑定
 * 身份缓存(id:source 变了就重建——主备切换/key 轮换即时生效,构造含提示词
 * 组装不值得每次 run 重复)。系统提示定调:计划先行(write_todos)、三域工具
 * 规范、引用作答;内置文件系统工具默认 StateBackend 无磁盘访问,明示禁用防跑偏。
 * M27 批⑥:todoListMiddleware 显式挂载——deepagents 仅给 Codex harness 档
 * 自动接 write_todos,自定义 ChatOpenAI(EMPTY_HARNESS_PROFILE)不带,系统提示
 * 里的「计划先行」此前是无工具可调的空话(侧边栏计划条恒空);load 侧恢复见
 * runtime-adapter。
 */
import { createDeepAgent, type DeepAgent } from "deepagents";
import { todoListMiddleware } from "langchain";

import type { ResolvedAiModel } from "../ai/resolver";
import { interruptGuardMiddleware } from "./ask-user-guard";
import { ensureAgentCheckpointer, getAgentCheckpointer } from "./checkpointer";
import type { AgentIdentity } from "./identity";
import { logger } from "../logger";
import { resolveAgentModel } from "./model-factory";
import { toolCallRepairMiddleware } from "./tool-call-repair";
import { toolArgsFeedbackMiddleware } from "./tool-args-feedback";
import { AGENT_TOOLS, readPostToolFor } from "./tools";

export const AGENT_SYSTEM_PROMPT = `你是「一起AI」(17aitech.com)站内搜索助手,帮助用户深挖 AI 资讯、教程与开源项目。

能力边界(硬性):
- 你有六个工具:search_site(站内三域检索)、read_post(读站内文章)、read_repo(读站内项目 README)、get_time(当前时间)、ask_user(向用户提问)、submit_feedback(提交用户反馈)
- 除 submit_feedback 外你不能写入或修改任何数据;不能访问站外网页、没有文件系统、不能执行代码
- 用户要求超出能力范围时,直说做不到,并引导回站内内容的检索与阅读

工作方式:
- 开始处理多步任务前,先用 write_todos 列出简短计划(2-5 项),随进展更新状态
- 涉及站内内容的事实性问题,先用 search_site 检索,再按需 read_post / read_repo 展开正文
- 涉及「今天/最近/最新」等相对时间,先用 get_time 锚定当前日期
- 站内没有相关内容时,直接用你自己的知识回答,并说明「站内暂无相关内容」

页面上下文(文章页):
- 上下文含 article 段(article.postId)时,用户说「这篇文章/本文/当前文章」指的就是该 id;需要正文时对该 id 调 read_post,不要猜其他 id
- read_post 返回 "gated": true 表示这是付费/登录可见文章,只给了预览:如实告知解锁条件,严禁编造全文或声称已读全文

向用户提问:
- 关键信息缺失且无法靠检索补足时(如确认诉求、确认意图、联系方式场景),必须调用 ask_user 工具提问;一次只问一个问题,可附 2-4 个候选选项
- 严禁用普通对话文本向用户提问——文本问法前端不会出现回答卡片,用户无法作答,对话会卡死;唯一正确的提问方式就是调用 ask_user
- 用户的回答会作为 ask_user 的工具结果返回;拿到回答后再继续,不要空等或自行臆测答案
- 能通过 search_site 查到答案的问题不要问用户

联系与反馈:
- 用户表达「联系我们/反馈/建议/报问题/合作」等意愿时:先用 ask_user 确认具体内容(诉求是什么、涉及哪篇文章或功能),再用 ask_user 询问是否留下联系方式(邮箱/微信号等,可不留)
- 内容明确后调用 submit_feedback 提交;只在用户明确提供或同意时才填 contact,用户拒绝就不填且不再追问
- 提交成功后简短告知「反馈已收到,站长会尽快查看」,不要向用户复述完整内容

回答规范:
- 用中文回答;简洁、分点、直给结论
- 引用站内内容时标注来源链接(href);不要编造站内不存在的文章或项目
- 站内内容与你的知识冲突时,以站内内容为准并指出差异`;

/**
 * 工具面(M72 瘦身 B4/B5 后):**全员只读六件**,admin 与 guest/user 同面。
 *
 * 站内创作职责整体外移线下 Claude Code(MCP 25 只工具 + 仓库 skills/writing/*.md),
 * 写工具(read_draft、propose_edits、save_topic_draft、write_article、
 * render_card、generate_illustration、generate_post_cover 等 19 只)随之下线;原先的
 * admin 专属提示段(ADMIN_PROMPT_ADDENDUM)一并删除——提示只描述只读能力,
 * 防模型幻调不存在的工具。
 *
 * read_post 仍按身份换档(M69):门禁文 guest 预览、user 仅登录门禁可读全文、
 * admin 全文——只读工具内部的门禁分档与身份档无关,保留。
 */
export function agentToolsFor(kind: AgentIdentity["kind"]) {
  return AGENT_TOOLS.map((t) => (t.name === "read_post" ? readPostToolFor(kind) : t));
}

/** 系统提示:全员同一份(只读助手定调) */
export function agentSystemPrompt(_kind: AgentIdentity["kind"]): string {
  return AGENT_SYSTEM_PROMPT;
}

/** 图缓存上限(模型 key × 身份档组合空间小;FIFO 淘汰防模型轮换时无限增长) */
const GRAPH_CACHE_MAX = 6;

const globalForAgent = globalThis as unknown as {
  agentGraphs?: Map<string, { graph: DeepAgent; resolved: ResolvedAiModel }>;
};

/**
 * 构造/取用 agent 图(checkpointer 挂 PostgresSaver,线程状态跨请求持久)。
 * 首次调用触发 checkpoint setup(幂等);缓存键 = 绑定(id:source)+ 身份档
 * (M27 批④:admin 图带合成工具,双档分别缓存)——任一变化即重建,未变化
 * 复用;admin 侧主备切换/启停最迟下一次 run 生效。
 * M72 瘦身 B4/B5:工具面塌缩为全员只读六件,身份档仍在键里(read_post 门禁
 * 分档随身份走),创作总闸随之退场(写工具已下线,无「翻闸恢复」可谈)。
 */
export async function getAgentGraph(identityKind: AgentIdentity["kind"]): Promise<{
  graph: DeepAgent;
  resolved: ResolvedAiModel;
}> {
  await ensureAgentCheckpointer();
  const { model, resolved } = await resolveAgentModel();
  const key = `${resolved.id}:${resolved.source}:${identityKind}`;
  const cache = (globalForAgent.agentGraphs ??= new Map());
  const cached = cache.get(key);
  if (cached) return { graph: cached.graph, resolved: cached.resolved };
  logger.info({ event: "agent.graph_built", key });
  const graph = createDeepAgent({
    model,
    tools: agentToolsFor(identityKind),
    systemPrompt: agentSystemPrompt(identityKind),
    checkpointer: getAgentCheckpointer(),
    // interrupt 类工具(ask_user/propose_edits)可靠性三守卫(SasanAgent 范式):
    // - tool_call_repair:模型调用前剔悬空 tool_calls/孤儿 ToolMessage(abort
    //   打断工具节点/中断挂起后弃答/存量脏会话 → OpenAI 兼容端点 400),请求
    //   副本改写不落持久化;
    // - interrupt_guard:并行 interrupt 单飞(只放行触发 AIMessage 里按序第一
    //   个,其余拦「请合并」;state 异常 fail-closed),防 resume 批重执行错位
    //   (M27 批⑧-c 白名单扩 propose_edits,原 ask_user_guard 改名口径);
    // - tool_args_feedback:参数漂移归一(ask_user options 对象数组/JSON 串等
    //   弱模型漂移形态执行前收敛)+ 全工具面 zod 失败中文修正反馈与落日志
    //   (M31 验收:MiniMax options 三连败弃问实证,报错自纠对弱模型不可靠)。
    middleware: [
      toolCallRepairMiddleware,
      interruptGuardMiddleware,
      toolArgsFeedbackMiddleware,
      todoListMiddleware(),
    ],
  });
  if (cache.size >= GRAPH_CACHE_MAX) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  cache.set(key, { graph, resolved });
  return { graph, resolved };
}
