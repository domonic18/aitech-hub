/**
 * run 编排单测(getAgentGraph mock):帧序列 metadata→…→end、todos 提取、
 * usage 聚合、工具调用去重计数、50k/12 次护栏主动收束(degraded)、
 * 断开(signal aborted)即停不产 end 前的更多帧。
 */
import { AIMessageChunk, ToolMessage } from "@langchain/core/messages";
import { Command, isCommand } from "@langchain/langgraph";
import { beforeEach, describe, expect, it, vi } from "vitest";

const getAgentGraphMock = vi.hoisted(() => vi.fn());

vi.mock("./agent", () => ({ getAgentGraph: getAgentGraphMock }));

import { AGENT_MAX_TOKENS, extractTodos, runAgentTurn, type AgentTodo } from "./run";

/** 假图:getAgentGraph 返回形状({graph, resolved}),按序产出 [mode, payload] 元组 */
function fakeGraph(frames: [string, unknown][], onStream?: () => void) {
  return {
    graph: {
      stream: vi.fn(async function* () {
        onStream?.();
        for (const f of frames) yield f;
      }),
    },
    resolved: null,
  };
}

function captureFrames() {
  const frames: string[] = [];
  return { frames, onFrame: (f: string) => frames.push(f) };
}

function signalSettled(aborted: boolean): AbortSignal {
  const c = new AbortController();
  if (aborted) c.abort();
  return c.signal;
}

beforeEach(() => {
  getAgentGraphMock.mockReset();
});

describe("extractTodos", () => {
  it("扫各节点增量取 todos 数组", () => {
    const todos: AgentTodo[] = [
      { content: "检索", status: "completed" },
      { content: "展开正文", status: "in_progress" },
    ];
    expect(extractTodos({ agent: { todos }, other: { x: 1 } })).toEqual(todos);
  });

  it("无 todos/非对象安全返空", () => {
    expect(extractTodos({ agent: { messages: [] } })).toEqual([]);
    expect(extractTodos(null)).toEqual([]);
    expect(extractTodos("x")).toEqual([]);
  });
});

describe("runAgentTurn", () => {
  it("帧序列 metadata→messages→updates→end;usage 与工具调用计数正确", async () => {
    const aiChunk = new AIMessageChunk({
      id: "ai-1",
      content: "答案",
      tool_call_chunks: [{ name: "search_site", args: '{"q":"x"}', id: "call-1", index: 0 }],
      usage_metadata: { input_tokens: 100, output_tokens: 20, total_tokens: 120 },
    });
    const toolMsg = new ToolMessage({ content: "[]", tool_call_id: "call-1", name: "search_site" });
    getAgentGraphMock.mockResolvedValue(
      fakeGraph([
        ["messages", [aiChunk, {}]],
        ["updates", { tools: { messages: [toolMsg] } }],
        ["updates", { agent: { todos: [{ content: "检索", status: "completed" }] } }],
        ["messages", [new AIMessageChunk({ id: "ai-2", content: "完" }), {}]],
      ]),
    );
    const { frames, onFrame } = captureFrames();
    const outcome = await runAgentTurn({
      threadId: "t1",
      message: "q",
      signal: signalSettled(false),
      onFrame,
    });
    const events = frames.map((f) => f.split("\n")[0].replace("event: ", ""));
    expect(events).toEqual(["metadata", "messages", "updates", "updates", "messages", "end"]);
    expect(outcome.tokensIn).toBe(100);
    expect(outcome.tokensOut).toBe(20);
    expect(outcome.toolCalls).toBe(1); // chunk id 与 tool 消息同集去重
    expect(outcome.truncatedReason).toBeNull();
  });

  it("50k 超限:主动收束,truncatedReason 人话,end 帧仍发", async () => {
    const big = new AIMessageChunk({
      content: "",
      usage_metadata: {
        input_tokens: AGENT_MAX_TOKENS,
        output_tokens: 1,
        total_tokens: AGENT_MAX_TOKENS + 1,
      },
    });
    getAgentGraphMock.mockResolvedValue(
      fakeGraph([
        ["messages", [big, {}]],
        ["messages", [new AIMessageChunk({ content: "不应出现" }), {}]],
      ]),
    );
    const { frames, onFrame } = captureFrames();
    const outcome = await runAgentTurn({
      threadId: "t1",
      message: "q",
      signal: signalSettled(false),
      onFrame,
    });
    expect(outcome.truncatedReason).toContain("用量已达上限");
    expect(frames.filter((f) => f.startsWith("event: messages"))).toHaveLength(0); // 检在发前
    expect(frames.at(-1)).toContain("event: end");
  });

  it("12 次工具调用超限:主动收束", async () => {
    const framesIn: [string, unknown][] = [];
    for (let i = 0; i < 13; i++) {
      framesIn.push([
        "messages",
        [
          new AIMessageChunk({
            content: "",
            tool_call_chunks: [{ name: "search_site", args: "{}", id: `call-${i}`, index: 0 }],
          }),
          {},
        ],
      ]);
    }
    getAgentGraphMock.mockResolvedValue(fakeGraph(framesIn));
    const { frames, onFrame } = captureFrames();
    const outcome = await runAgentTurn({
      threadId: "t1",
      message: "q",
      signal: signalSettled(false),
      onFrame,
    });
    expect(outcome.truncatedReason).toContain("工具调用已达上限");
    expect(outcome.toolCalls).toBe(13); // 第 13 次触发即断(≤12 允许),计数如实
    expect(frames.filter((f) => f.startsWith("event: messages"))).toHaveLength(12);
    expect(frames.at(-1)).toContain("event: end");
  });

  it("断开(signal 已 abort):循环即停,end 帧不发", async () => {
    getAgentGraphMock.mockResolvedValue(
      fakeGraph([["messages", [new AIMessageChunk({ content: "x" }), {}]]]),
    );
    const { frames, onFrame } = captureFrames();
    const outcome = await runAgentTurn({
      threadId: "t1",
      message: "q",
      signal: signalSettled(true),
      onFrame,
    });
    expect(frames).toHaveLength(1); // 仅 metadata
    expect(outcome.truncatedReason).toBeNull();
  });

  it("resume(HITL):Command 作图输入,帧序列与新提问同构", async () => {
    const g = fakeGraph([
      [
        "updates",
        { tools: { messages: [new ToolMessage({ content: "答", tool_call_id: "c1" })] } },
      ],
      ["messages", [new AIMessageChunk({ id: "ai-3", content: "继续" }), {}]],
    ]);
    getAgentGraphMock.mockResolvedValue(g);
    const { frames, onFrame } = captureFrames();
    const outcome = await runAgentTurn({
      threadId: "t1",
      message: null,
      resume: { message: "报问题", option: "报问题" },
      signal: signalSettled(false),
      onFrame,
    });
    const input = (g.graph.stream.mock.calls as unknown as [[unknown]])[0]?.[0] as Command;
    expect(isCommand(input)).toBe(true);
    expect(input.resume).toEqual({ message: "报问题", option: "报问题" });
    const events = frames.map((f) => f.split("\n")[0].replace("event: ", ""));
    expect(events).toEqual(["metadata", "updates", "messages", "end"]);
    expect(outcome.truncatedReason).toBeNull();
  });
});
