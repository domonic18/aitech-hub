/**
 * interrupt 类工具单飞守卫单测(纯函数 judgeInterruptFlight):并行首调用放行、
 * 次调用拦「合并」、非 interrupt 工具无关、反向遍历取最新触发消息、
 * 找不到触发 fail-closed。M72 瘦身 B4 后只剩 ask_user 一只 interrupt 工具。
 */
import { AIMessage, HumanMessage } from "@langchain/core/messages";
import { describe, expect, it, vi } from "vitest";

import { interruptGuardMiddleware, judgeInterruptFlight } from "./ask-user-guard";

function aiWithCalls(calls: Array<{ id: string; name: string }>): AIMessage {
  return new AIMessage({
    content: "",
    tool_calls: calls.map((c) => ({ ...c, args: {} })),
  });
}

describe("judgeInterruptFlight", () => {
  it("本批首个 ask_user 放行", () => {
    const msgs = [new HumanMessage("q"), aiWithCalls([{ id: "a1", name: "ask_user" }])];
    expect(judgeInterruptFlight(msgs, "a1")).toBe("pass");
  });

  it("并行次调用拦截合并(首个在前)", () => {
    const msgs = [
      new HumanMessage("q"),
      aiWithCalls([
        { id: "a1", name: "ask_user" },
        { id: "a2", name: "ask_user" },
      ]),
    ];
    expect(judgeInterruptFlight(msgs, "a1")).toBe("pass");
    expect(judgeInterruptFlight(msgs, "a2")).toBe("merge");
  });

  it("与其他工具混排:首个(唯一)interrupt 放行(非 interrupt 工具在中间件层短路,不进判定)", () => {
    const msgs = [
      new HumanMessage("q"),
      aiWithCalls([
        { id: "s1", name: "search_site" },
        { id: "a1", name: "ask_user" },
      ]),
    ];
    expect(judgeInterruptFlight(msgs, "a1")).toBe("pass");
  });

  it("反向遍历取最新触发消息:历史同 id 不误判", () => {
    const msgs = [
      new HumanMessage("q1"),
      aiWithCalls([{ id: "old", name: "ask_user" }]), // 历史轮
      aiWithCalls([
        { id: "old", name: "ask_user" }, // id 复用/回放:反向先命中本条
        { id: "new", name: "ask_user" },
      ]),
    ];
    // old 在最新消息里是首个 → pass;new 是次个 → merge
    expect(judgeInterruptFlight(msgs, "old")).toBe("pass");
    expect(judgeInterruptFlight(msgs, "new")).toBe("merge");
  });

  it("触发消息不存在 → fail-closed degraded", () => {
    expect(judgeInterruptFlight([new HumanMessage("q")], "missing")).toBe("degraded");
    expect(judgeInterruptFlight([], "x")).toBe("degraded");
  });

  it("回归锚(白名单修正):候选工具 generate_cover_candidates 不吃单飞名额——混批 ask_user 判 pass", () => {
    // 旧白名单误收候选工具名(非 interrupt)时,此场景会把 ask_user 误拦合并
    const msgs = [
      new HumanMessage("q"),
      aiWithCalls([
        { id: "c0", name: "generate_cover_candidates" },
        { id: "a1", name: "ask_user" },
      ]),
    ];
    expect(judgeInterruptFlight(msgs, "a1")).toBe("pass");
  });
});

describe("interruptGuardMiddleware", () => {
  const wrap = interruptGuardMiddleware.wrapToolCall!;
  type Req = Parameters<NonNullable<typeof wrap>>[0];
  type Handler = Parameters<NonNullable<typeof wrap>>[1];

  function makeRequest(toolCall: { name: string; args: unknown; id?: string }): Req {
    return {
      toolCall: {
        id: toolCall.id ?? "call_1",
        name: toolCall.name,
        args: toolCall.args,
        type: "tool_call",
      },
      state: { messages: [] },
    } as unknown as Req;
  }

  it("ask_user 空 state → fail-closed 拦截(非 interrupt 工具不受影响)", async () => {
    const handler = vi.fn();
    const out = await wrap(
      makeRequest({ name: "ask_user", args: { question: "q" } }),
      handler as Handler,
    );
    expect(handler).not.toHaveBeenCalled();
    expect((out as { content?: string }).content).toContain("系统状态异常");

    const handler2 = vi.fn();
    await wrap(makeRequest({ name: "search_site", args: { q: "x" } }), handler2 as Handler);
    expect(handler2).toHaveBeenCalledTimes(1);
  });
});
