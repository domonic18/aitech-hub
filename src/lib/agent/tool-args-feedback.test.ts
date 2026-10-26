/**
 * 参数反馈中间件单测:ask_user options 归一改写(handler 收到收敛后的
 * args,模型 spec 不变)+ ToolInputParsingException 中文反馈 ToolMessage +
 * 非校验错误原样上抛 + 非 ask_user 透传。
 */
import { ToolInputParsingException } from "@langchain/core/tools";
import { type ToolMessage } from "langchain";
import { describe, expect, it, vi } from "vitest";

import { toolArgsFeedbackMiddleware } from "./tool-args-feedback";

type ToolCallRequest = Parameters<NonNullable<typeof toolArgsFeedbackMiddleware.wrapToolCall>>[0];
type Handler = NonNullable<
  Parameters<NonNullable<typeof toolArgsFeedbackMiddleware.wrapToolCall>>[1]
>;

const wrap = toolArgsFeedbackMiddleware.wrapToolCall!;

function makeRequest(toolCall: { name: string; args: unknown; id?: string }): ToolCallRequest {
  return {
    toolCall: {
      id: toolCall.id ?? "call_1",
      name: toolCall.name,
      args: toolCall.args,
      type: "tool_call",
    },
  } as unknown as ToolCallRequest;
}

/** 测试桩 handler:回传收到的 args(断言归一效果),类型对齐中间件契约 */
function echoHandler(): { fn: Handler; received: () => unknown } {
  let latest: unknown;
  const fn = (async (req: ToolCallRequest) => {
    latest = req.toolCall.args;
    return { stub: true } as unknown as ToolMessage;
  }) as Handler;
  return { fn, received: () => latest };
}

describe("toolArgsFeedbackMiddleware", () => {
  it("ask_user 对象数组 options 执行前归一为 string[](handler 收到收敛后 args)", async () => {
    const { fn, received } = echoHandler();
    const request = makeRequest({
      name: "ask_user",
      args: {
        question: "封面想要哪种风格方向?",
        options: [{ content: "极简科技风" }, { content: "对比叙事风" }],
      },
    });
    await wrap(request, fn);
    expect((received() as { options: string[] }).options).toEqual(["极简科技风", "对比叙事风"]);
  });

  it("有效项不足 2:options 归一为 undefined(降级无选项提问,不硬拒)", async () => {
    const { fn, received } = echoHandler();
    const request = makeRequest({
      name: "ask_user",
      args: { question: "选哪个?", options: [{ content: "只有一条" }] },
    });
    await wrap(request, fn);
    expect((received() as { options: unknown }).options).toBeUndefined();
  });

  it("save_topic_draft tags 顿号/逗号单串执行前拆为 string[]", async () => {
    const { fn, received } = echoHandler();
    const request = makeRequest({
      name: "save_topic_draft",
      args: { topic_id: "1", title: "T", content_md: "B", tags: "AI、教程, 实战" },
    });
    await wrap(request, fn);
    expect((received() as { tags: string[] }).tags).toEqual(["AI", "教程", "实战"]);
  });

  it("save_topic_draft tags 数组逐项 trim 去空;无 tags 与其他工具透传", async () => {
    const { fn, received } = echoHandler();
    const arr = makeRequest({
      name: "save_topic_draft",
      args: { topic_id: "1", title: "T", content_md: "B", tags: [" AI ", "", "教程"] },
    });
    await wrap(arr, fn);
    expect((received() as { tags: string[] }).tags).toEqual(["AI", "教程"]);

    const passthrough = makeRequest({ name: "save_topic_draft", args: { topic_id: "1" } });
    const spy = vi.fn(async () => ({ stub: true }) as unknown as ToolMessage) as unknown as Handler;
    await wrap(passthrough, spy);
    expect((spy as unknown as { mock: { calls: unknown[][] } }).mock.calls[0]?.[0]).toBe(
      passthrough,
    );
  });

  it("无 options 的 ask_user 与其他工具原样透传", async () => {
    const spy = vi.fn(async () => ({ stub: true }) as unknown as ToolMessage) as unknown as {
      mock: { calls: unknown[][] };
    };
    const handler = spy as unknown as Handler;
    const ask = makeRequest({ name: "ask_user", args: { question: "q?" } });
    await wrap(ask, handler);
    const other = makeRequest({ name: "search_site", args: { query: "gemini" } });
    await wrap(other, handler);
    expect(spy.mock.calls[0]?.[0]).toBe(ask);
    expect(spy.mock.calls[1]?.[0]).toBe(other);
  });

  it("schema 校验失败:回中文修正反馈 ToolMessage(status=error)而非英文 dump", async () => {
    const failing = (async () => {
      throw new ToolInputParsingException(
        "Received tool input did not match expected schema",
        '{"question":"q","options":[{"content":"x"},{"content":"y"}]}',
      );
    }) as unknown as Handler;
    const request = makeRequest({ name: "ask_user", args: {}, id: "call_err_1" });
    const out = (await wrap(request, failing)) as ToolMessage;
    expect(out.tool_call_id).toBe("call_err_1");
    expect(out.status).toBe("error");
    expect(String(out.content)).toContain("工具参数不符合 schema");
    expect(String(out.content)).toContain("Received tool input did not match expected schema");
  });

  it("非校验类错误原样上抛(交 ToolNode 常规处理)", async () => {
    const failing = (async () => {
      throw new Error("网络异常");
    }) as unknown as Handler;
    const request = makeRequest({ name: "search_site", args: {} });
    await expect(wrap(request, failing)).rejects.toThrow("网络异常");
  });
});
