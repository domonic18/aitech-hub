/**
 * tool-call-repair 单测(纯函数,零依赖):干净序列零开销引用透传、悬空
 * tool_calls 剥除、空壳整条丢弃、孤儿 ToolMessage 剔除、AI/Human 边界隔离
 * (边界前的应答不救边界后的悬空调用)。
 */
import { AIMessage, HumanMessage, ToolMessage } from "@langchain/core/messages";
import { describe, expect, it } from "vitest";

import { repairToolCallMessages } from "./tool-call-repair";

function aiWithCalls(ids: string[], content = ""): AIMessage {
  return new AIMessage({
    content,
    tool_calls: ids.map((id) => ({ id, name: "ask_user", args: {} })),
  });
}

function toolReply(id: string, content = "ok"): ToolMessage {
  return new ToolMessage({ tool_call_id: id, content });
}

describe("repairToolCallMessages", () => {
  it("干净序列原样引用透传(零开销快路径)", () => {
    const msgs = [
      new HumanMessage("hi"),
      aiWithCalls(["c1"]),
      toolReply("c1"),
      new AIMessage({ content: "done" }),
    ];
    const out = repairToolCallMessages(msgs);
    expect(out.droppedToolCalls).toBe(0);
    expect(out.droppedToolMessages).toBe(0);
    expect(out.messages).toBe(msgs);
  });

  it("悬空 tool_call 剥除,已应答的保留", () => {
    const msgs = [
      new HumanMessage("q"),
      aiWithCalls(["c1", "c2"]),
      toolReply("c1"), // c2 无应答(abort 打断工具节点)
    ];
    const out = repairToolCallMessages(msgs);
    expect(out.droppedToolCalls).toBe(1);
    expect(out.droppedToolMessages).toBe(0);
    const ai = out.messages[1] as AIMessage;
    expect(ai.tool_calls ?? []).toHaveLength(1);
    expect((ai.tool_calls ?? [])[0]?.id).toBe("c1");
  });

  it("tool_calls 剥空且无内容 → 空壳整条丢弃", () => {
    const msgs = [new HumanMessage("q"), aiWithCalls(["c1"], "")];
    const out = repairToolCallMessages(msgs);
    expect(out.droppedToolCalls).toBe(1);
    expect(out.messages).toHaveLength(1); // 只剩 HumanMessage
  });

  it("tool_calls 剥空但有文本 → 保留纯内容 AIMessage(reasoning/文本不丢)", () => {
    const msgs = [new HumanMessage("q"), aiWithCalls(["c1"], "让我想想…")];
    const out = repairToolCallMessages(msgs);
    expect(out.messages).toHaveLength(2);
    const ai = out.messages[1] as AIMessage;
    expect(ai.content).toBe("让我想想…");
    expect(ai.tool_calls ?? []).toHaveLength(0);
  });

  it("孤儿 ToolMessage 剔除(所属 AIMessage 已被切走)", () => {
    const msgs = [new HumanMessage("q"), toolReply("ghost")];
    const out = repairToolCallMessages(msgs);
    expect(out.droppedToolMessages).toBe(1);
    expect(out.messages).toHaveLength(1);
  });

  it("AI/Human 边界隔离:边界后的应答不救边界前的悬空调用", () => {
    const msgs = [
      new HumanMessage("q1"),
      aiWithCalls(["c1"]),
      new HumanMessage("q2"), // 边界:c1 的应答被这一轮打断
      toolReply("c1"),
    ];
    const out = repairToolCallMessages(msgs);
    // c1 悬空剥除;孤儿 ToolMessage 剔除;两条 Human 保留
    expect(out.droppedToolCalls).toBe(1);
    expect(out.droppedToolMessages).toBe(1);
    expect(out.messages).toHaveLength(2);
    expect(out.messages.every((m) => m.getType() === "human")).toBe(true);
  });

  it("正常轮内工具循环完整保留(先问后答再总结)", () => {
    const msgs = [
      new HumanMessage("q"),
      aiWithCalls(["c1"]),
      toolReply("c1"),
      new AIMessage({ content: "答案是…" }),
    ];
    const out = repairToolCallMessages(msgs);
    expect(out.messages).toBe(msgs);
  });
});
