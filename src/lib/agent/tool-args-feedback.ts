/**
 * 工具参数漂移归一 + 校验失败反馈中间件(M31 验收反馈 2026-10-15 系统化收口)。
 *
 * 背景(checkpoint 实证):MiniMax 发 ask_user 时 options 反复发成对象数组
 * [{content:"…"}],StructuredTool zod 硬拒 → ToolNode 回英文 dump("Error
 * invoking tool … Please fix your mistakes."),弱模型读不懂、原样重发三连败、
 * 弃问降级——「报错后自纠」对弱模型不可靠,必须在执行链路上系统化兜住。
 *
 * 三处:
 * - 归一改写(ask_user):执行前把 options 经 normalizeAskUserOptions 收敛
 *   (对象数组/JSON 串/分隔符串 → string[]);工具 spec 保持纯 string[] 不变,
 *   模型侧零感知;
 * - 归一改写(save_topic_draft):tags 惯发顿号/逗号分隔单串(schema 要
 *   string[]),执行前拆分收敛(2026-10-15 验收反馈问题一);
 * - 校验失败反馈(全工具面):StructuredTool 抛 ToolInputParsingException 时
 *   记 agent.tool_args_invalid(args 截断入日志,现场可查)+ 回中文精确修正
 *   提示 ToolMessage——模型拿到可执行的修正指令而非英文堆栈。
 */
import { ToolMessage, createMiddleware } from "langchain";
import { ToolInputParsingException } from "@langchain/core/tools";

import { logger } from "../logger";

import { AGENT_ASK_USER_TOOL, normalizeAskUserOptions } from "./hitl";

import type { AgentMiddleware } from "langchain";

/** save_topic_draft 工具名(锚 topic-draft-tool.ts;字面量内联防把工具模块的
 * prisma 依赖链拖进本件) */
const TOPIC_DRAFT_TOOL = "save_topic_draft";

/** 校验失败日志里原始入参的截断长度(问题文本非敏感值,现场排查必需) */
const ARGS_LOG_MAX = 400;

/**
 * tags 参数漂移归一(仅 save_topic_draft):分隔符单串 → string[];
 * 数组逐项 trim 去空;其余形状原样交 zod(校验失败反馈兜底)。
 */
function normalizeTagsArg(value: unknown): unknown {
  if (typeof value === "string") {
    return value
      .split(/[,，、\n;;]+/)
      .map((t) => t.trim())
      .filter((t) => t !== "");
  }
  if (Array.isArray(value)) {
    return value
      .map((t) => (typeof t === "string" ? t.trim() : t))
      .filter((t) => !(typeof t === "string" && t === ""));
  }
  return value;
}

/** 校验失败反馈文案(模型能据此自纠:指明根因类别 + 修正方向 + 原始校验信息) */
function argsFeedbackContent(e: ToolInputParsingException): string {
  return (
    "工具参数不符合 schema,本次未执行。请修正后重新调用:字段名/类型/嵌套层级严格按工具" +
    "定义,字符串数组不要包裹对象、数字不要加引号、顿号/逗号分隔的多个标签要拆成字符串" +
    "数组、缺省可选字段直接省略。原始校验信息:" +
    e.message.slice(0, 500)
  );
}

export const toolArgsFeedbackMiddleware: AgentMiddleware = createMiddleware({
  name: "tool_args_feedback",
  wrapToolCall: async (request, handler) => {
    // ask_user options 归一改写(漂移形态收敛)
    if (request.toolCall.name === AGENT_ASK_USER_TOOL) {
      const args = request.toolCall.args as Record<string, unknown> | undefined;
      if (args !== null && typeof args === "object" && "options" in args) {
        return handler({
          ...request,
          toolCall: {
            ...request.toolCall,
            args: { ...args, options: normalizeAskUserOptions(args.options) },
          },
        });
      }
    }
    // save_topic_draft tags 归一改写(顿号/逗号单串 → string[])
    if (request.toolCall.name === TOPIC_DRAFT_TOOL) {
      const args = request.toolCall.args as Record<string, unknown> | undefined;
      if (args !== null && typeof args === "object" && "tags" in args) {
        return handler({
          ...request,
          toolCall: {
            ...request.toolCall,
            args: { ...args, tags: normalizeTagsArg(args.tags) },
          },
        });
      }
    }
    try {
      return await handler(request);
    } catch (e) {
      if (!(e instanceof ToolInputParsingException)) throw e; // 非 schema 失败原样上抛
      logger.warn({
        event: "agent.tool_args_invalid",
        tool: request.toolCall.name,
        args: (e.output ?? "").slice(0, ARGS_LOG_MAX),
      });
      return new ToolMessage({
        tool_call_id: request.toolCall.id ?? "",
        name: request.toolCall.name,
        content: argsFeedbackContent(e),
        status: "error",
      });
    }
  },
});
