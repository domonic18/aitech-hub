/**
 * interrupt 类工具单飞守卫单测(纯函数 judgeInterruptFlight,M27 批⑧-c 白名单
 * 扩 propose_edits):并行首调用放行、次调用拦「合并」、ask_user 与
 * propose_edits 同批互斥、非 interrupt 工具无关、反向遍历取最新触发消息、
 * 找不到触发 fail-closed。
 */
import { AIMessage, HumanMessage } from "@langchain/core/messages";
import { describe, expect, it } from "vitest";

import { judgeInterruptFlight } from "./ask-user-guard";

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
});
