/**
 * interrupt 类工具单飞守卫单测(纯函数 judgeInterruptFlight,M27 批⑧-c 白名单
 * 扩 propose_edits;2026-10-20 白名单修正收 generate_post_cover 真名 + auto 档
 * 短路):并行首调用放行、次调用拦「合并」、跨工具互斥、非 interrupt 工具无关、
 * 反向遍历取最新触发消息、找不到触发 fail-closed、中间件 auto 档短路放行。
 */
import { AIMessage, HumanMessage } from "@langchain/core/messages";
import { describe, expect, it, vi } from "vitest";

import { interruptGuardMiddleware, judgeInterruptFlight } from "./ask-user-guard";
import { GENERATE_POST_COVER_TOOL } from "./cover-tool";

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

  it("propose_edits 同口径:首个放行、次个合并拦截", () => {
    const msgs = [
      new HumanMessage("q"),
      aiWithCalls([
        { id: "p1", name: "propose_edits" },
        { id: "p2", name: "propose_edits" },
      ]),
    ];
    expect(judgeInterruptFlight(msgs, "p1")).toBe("pass");
    expect(judgeInterruptFlight(msgs, "p2")).toBe("merge");
  });

  it("ask_user 与 propose_edits 混批:仅按序第一个 interrupt 类放行(跨工具互斥)", () => {
    const msgs = [
      new HumanMessage("q"),
      aiWithCalls([
        { id: "a1", name: "ask_user" },
        { id: "p1", name: "propose_edits" },
      ]),
    ];
    expect(judgeInterruptFlight(msgs, "a1")).toBe("pass");
    expect(judgeInterruptFlight(msgs, "p1")).toBe("merge");
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

  it("generate_post_cover 同口径:首个放行、次个合并拦截(2026-10-20 入白名单)", () => {
    const msgs = [
      new HumanMessage("q"),
      aiWithCalls([
        { id: "g1", name: GENERATE_POST_COVER_TOOL },
        { id: "g2", name: GENERATE_POST_COVER_TOOL },
      ]),
    ];
    expect(judgeInterruptFlight(msgs, "g1")).toBe("pass");
    expect(judgeInterruptFlight(msgs, "g2")).toBe("merge");
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

describe("interruptGuardMiddleware(auto 档短路,2026-10-20)", () => {
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
      state: { messages: [] }, // 空消息态:auto 短路在判定前,不查 state 即放行
    } as unknown as Req;
  }

  it("auto_adopt:true → 判定前短路放行(空 state 也不 fail-closed)", async () => {
    const handler = vi.fn(async () => ({ stub: true }) as unknown as Awaited<ReturnType<Handler>>);
    await wrap(
      makeRequest({ name: GENERATE_POST_COVER_TOOL, args: { id: "9", auto_adopt: true } }),
      handler as Handler,
    );
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("手动档(未传 auto_adopt)照常进单飞判定:空 state fail-closed 拦截", async () => {
    const handler = vi.fn();
    const out = await wrap(
      makeRequest({ name: GENERATE_POST_COVER_TOOL, args: { id: "9" } }),
      handler as Handler,
    );
    expect(handler).not.toHaveBeenCalled();
    expect((out as { content?: string }).content).toContain("系统状态异常");
  });
});
