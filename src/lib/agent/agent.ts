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
import { askUserGuardMiddleware } from "./ask-user-guard";
import { ensureAgentCheckpointer, getAgentCheckpointer } from "./checkpointer";
import type { AgentIdentity } from "./identity";
import { logger } from "../logger";
import { resolveAgentModel } from "./model-factory";
import { TOPIC_TOOLS } from "./topic-tools";
import { toolCallRepairMiddleware } from "./tool-call-repair";
import { AGENT_TOOLS } from "./tools";

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
 * admin 专属段(M27 批⑤重构:编排权移交 agent——不再有固定管线,模型按工作流
 * 指令用细粒度工具自主生产专题文章)。写库型工具只进 admin 图——guest/user 图
 * 的工具面与系统提示维持 K2.5 只读红线不变。系统提示只在 admin 图追加,防工具
 * 语义泄入无工具会话(模型幻调不存在的工具)。
 */
const ADMIN_PROMPT_ADDENDUM = `

专题文章生产(管理员专属能力,收到「为专题写文章/合成初稿/改稿」类任务时启用):
这是多步生产流程,先用 write_todos 列出计划(通常 5~7 步),再逐步执行,每步用对应工具:
1. get_topic_brief 读取专题定位、素材(博主/视频/解读笔记/人工批注)与关联文档现状;仔细分析素材
2. 选题:基于素材构思 2~3 个切入角度并自选最优,参考近期已发标题避免重复;方向确实拿不准时用 ask_user 请管理员拍板(一次一问,带 2~4 个选项),素材充分时不必问
3. 写作:按下方写作指南起草;正文图片直接引用素材的 cover_path(brief 已转存为站内路径)或 generate_cover_candidates 返回的路径,严禁编造外链图片
4. 配图:素材 cover_path 已可直接引用;视频封面不足或需概念示意图时 generate_cover_candidates 按小节内容现拟 prompt 生成;cover_path 为 null(转存失败)或 brief 后新挂素材时用 transfer_video_cover 重试。头图建议选生图封面,避免与文首视频卡同图
5. save_topic_draft 落库(标题/摘要/正文/封面/SEO 标题与描述/标签一次交付)
6. 汇报:文章标题、结构与亮点、配图与 SEO 摘要,并给出文档链接(指向 post_url 的 markdown 链接)
管理员对已落库文章提出修改要求时:按需 get_topic_brief 重读素材,直接修改相关部分后再次 save_topic_draft(返回 needConfirm 时先 ask_user 确认覆盖),不要重跑全流程;工具返回 error/timeout 时如实转述,不要编造结果。

写作指南(公众号「博主×视频」推荐短文):
- 开头钩子不超过 80 字:用素材里最反差或最具体的事实/数据直接抓人,不写背景铺垫
- 结构:## 博主是谁(2~4 句,只依据素材,不编造履历)→ ## 视频讲了什么(3~4 个要点,每要点独立小段不超过 60 字,段首 **加粗**)→ ## 值得看的理由(1~2 句)→ ## 去看原视频(引导读者点「阅读原文」进站看视频)
- 全文 800~1200 字,单段不超过 3 行,多用短句;时间/年份只取自素材,素材未提就写「近期」;全部简体中文;恰当融合人工批注的取舍指令
- 图:优先在「视频讲了什么」等小节插入对应素材的封面图(cover_path),全文 2~4 张为宜、每节至多 1 张;文首推荐卡由系统自动带图,正文开头不要再贴同一张;确实无合适图不硬插`;

/** 工具面按身份分发(guest/user 只读六件;admin 追加专题生产四件) */
export function agentToolsFor(kind: AgentIdentity["kind"]) {
  return kind === "admin" ? [...AGENT_TOOLS, ...TOPIC_TOOLS] : [...AGENT_TOOLS];
}

/** 系统提示按身份分发(admin 追加合成工作流段) */
export function agentSystemPrompt(kind: AgentIdentity["kind"]): string {
  return kind === "admin" ? `${AGENT_SYSTEM_PROMPT}${ADMIN_PROMPT_ADDENDUM}` : AGENT_SYSTEM_PROMPT;
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
    // ask_user 可靠性双守卫(SasanAgent 范式,2026-10-10):
    // - tool_call_repair:模型调用前剔悬空 tool_calls/孤儿 ToolMessage(abort
    //   打断工具节点/提问挂起后弃答/存量脏会话 → OpenAI 兼容端点 400),请求
    //   副本改写不落持久化;
    // - ask_user_guard:并行 ask_user 单飞(只放行触发 AIMessage 里按序第一
    //   个,其余拦「请合并」;state 异常 fail-closed),防 resume 批重执行答案错位。
    middleware: [toolCallRepairMiddleware, askUserGuardMiddleware, todoListMiddleware()],
  });
  if (cache.size >= GRAPH_CACHE_MAX) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  cache.set(key, { graph, resolved });
  return { graph, resolved };
}
