/**
 * ask_user 单飞守卫单测(纯函数 judgeAskUserFlight):并行首调用放行、次调用
 * 拦「合并」、非 ask_user 无关、反向遍历取最新触发消息、找不到触发 fail-closed。
 */
import { AIMessage, HumanMessage } from "@langchain/core/messages";
import { describe, expect, it } from "vitest";

import { judgeAskUserFlight } from "./ask-user-guard";

function aiWithCalls(calls: Array<{ id: string; name: string }>): AIMessage {
  return new AIMessage({
    content: "",
    tool_calls: calls.map((c) => ({ ...c, args: {} })),
  });
}

describe("judgeAskUserFlight", () => {
  it("本批首个 ask_user 放行", () => {
    const msgs = [new HumanMessage("q"), aiWithCalls([{ id: "a1", name: "ask_user" }])];
    expect(judgeAskUserFlight(msgs, "a1")).toBe("pass");
  });

  it("并行次调用拦截合并(首个在前)", () => {
    const msgs = [
      new HumanMessage("q"),
      aiWithCalls([
        { id: "a1", name: "ask_user" },
        { id: "a2", name: "ask_user" },
      ]),
    ];
    expect(judgeAskUserFlight(msgs, "a1")).toBe("pass");
    expect(judgeAskUserFlight(msgs, "a2")).toBe("merge");
  });

  it("ask_user 与其他工具混排:首个(唯一)ask_user 放行(非 ask_user 在中间件层短路,不进判定)", () => {
    const msgs = [
      new HumanMessage("q"),
      aiWithCalls([
        { id: "s1", name: "search_site" },
        { id: "a1", name: "ask_user" },
      ]),
    ];
    expect(judgeAskUserFlight(msgs, "a1")).toBe("pass");
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
    expect(judgeAskUserFlight(msgs, "old")).toBe("pass");
    expect(judgeAskUserFlight(msgs, "new")).toBe("merge");
  });

  it("触发消息不存在 → fail-closed degraded", () => {
    expect(judgeAskUserFlight([new HumanMessage("q")], "missing")).toBe("degraded");
    expect(judgeAskUserFlight([], "x")).toBe("degraded");
  });
});
