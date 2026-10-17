/**
 * run 编排单测(getAgentGraph mock):帧序列 metadata→…→end、todos 提取、
 * usage 聚合、工具调用去重计数、护栏按身份档主动收束(基础档 12/50k,
 * admin 档放宽见 config/agent-limits 默认值,M27 批⑤/2026-10-17 验收反馈;
 * 额度经 limits 入参注入——后台站点设置可调,2026-10-17)、
 * 断开(signal aborted)即停不产 end 前的更多帧。
 */
import { AIMessageChunk, ToolMessage } from "@langchain/core/messages";
import { Command, isCommand } from "@langchain/langgraph";
import { beforeEach, describe, expect, it, vi } from "vitest";

const getAgentGraphMock = vi.hoisted(() => vi.fn());

vi.mock("./agent", () => ({ getAgentGraph: getAgentGraphMock }));

import { DEFAULT_AGENT_LIMITS, deriveRecursionLimit } from "../config/agent-limits";
import { extractTodos, runAgentTurn, type AgentTodo } from "./run";

/** 测试档 = 默认额度 + 派生 recursion(与路由侧 toRunLimits 同构) */
function runLimits(kind: "guest" | "user" | "admin" = "guest") {
  return {
    ...DEFAULT_AGENT_LIMITS[kind],
    recursion: deriveRecursionLimit(DEFAULT_AGENT_LIMITS[kind].toolCalls),
  };
}

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
      identityKind: "guest",
      limits: runLimits(),
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

  it("页面上下文(批⑧-b):新提问 human 消息加 [页面上下文] 前缀;缺省不注入", async () => {
    const fg = fakeGraph([]);
    getAgentGraphMock.mockResolvedValue(fg);
    await runAgentTurn({
      threadId: "t1",
      message: "帮我校对这篇文章",
      context: { page: "文章编辑", edit: { postId: "123", title: "标题" } },
      identityKind: "admin",
      limits: runLimits("admin"),
      signal: signalSettled(false),
      onFrame: () => {},
    });
    const calls = fg.graph.stream.mock.calls as unknown[][];
    const withCtx = calls[0][0] as { messages: { content: string }[] };
    expect(isCommand(withCtx)).toBe(false);
    expect(withCtx.messages[0].content).toContain("[页面上下文]");
    expect(withCtx.messages[0].content).toContain('"postId":"123"');
    expect(withCtx.messages[0].content.endsWith("帮我校对这篇文章")).toBe(true);

    await runAgentTurn({
      threadId: "t1",
      message: "普通提问",
      identityKind: "guest",
      limits: runLimits(),
      signal: signalSettled(false),
      onFrame: () => {},
    });
    const plain = calls[1][0] as { messages: { content: string }[] };
    expect(plain.messages[0].content).toBe("普通提问");
  });

  it("50k 超限:主动收束,truncatedReason 人话,end 帧仍发", async () => {
    const big = new AIMessageChunk({
      content: "",
      usage_metadata: {
        input_tokens: DEFAULT_AGENT_LIMITS.guest.tokens,
        output_tokens: 1,
        total_tokens: DEFAULT_AGENT_LIMITS.guest.tokens + 1,
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
      identityKind: "guest",
      limits: runLimits(),
      signal: signalSettled(false),
      onFrame,
    });
    expect(outcome.truncatedReason).toContain("用量已达上限");
    expect(frames.filter((f) => f.startsWith("event: messages"))).toHaveLength(0); // 检在发前
    expect(frames.at(-1)).toContain("event: end");
  });

  it("12 次工具调用超限:主动收束", async () => {
    const framesIn: [string, unknown][] = [];
    for (let i = 0; i < DEFAULT_AGENT_LIMITS.guest.toolCalls + 1; i++) {
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
      identityKind: "guest",
      limits: runLimits(),
      signal: signalSettled(false),
      onFrame,
    });
    expect(outcome.truncatedReason).toContain("工具调用已达上限");
    expect(outcome.toolCalls).toBe(DEFAULT_AGENT_LIMITS.guest.toolCalls + 1); // 档+1 次触发即断,计数如实
    expect(frames.filter((f) => f.startsWith("event: messages"))).toHaveLength(
      DEFAULT_AGENT_LIMITS.guest.toolCalls,
    );
    expect(frames.at(-1)).toContain("event: end");
  });

  it("admin 档护栏放宽:recursionLimit 跟档(2.5× 派生),工具调用超限(档+1)主动收束", async () => {
    const adminToolCalls = DEFAULT_AGENT_LIMITS.admin.toolCalls;
    const framesIn: [string, unknown][] = [];
    for (let i = 0; i < adminToolCalls + 1; i++) {
      framesIn.push([
        "messages",
        [
          new AIMessageChunk({
            content: "",
            tool_call_chunks: [{ name: "get_topic_brief", args: "{}", id: `call-${i}`, index: 0 }],
          }),
          {},
        ],
      ]);
    }
    const g = fakeGraph(framesIn);
    getAgentGraphMock.mockResolvedValue(g);
    const { frames, onFrame } = captureFrames();
    const outcome = await runAgentTurn({
      threadId: "t1",
      message: "q",
      identityKind: "admin",
      limits: runLimits("admin"),
      signal: signalSettled(false),
      onFrame,
    });
    const config = (
      g.graph.stream.mock.calls as unknown as [[unknown, { recursionLimit: number }]]
    )[0]?.[1];
    expect(config?.recursionLimit).toBe(deriveRecursionLimit(DEFAULT_AGENT_LIMITS.admin.toolCalls));
    expect(outcome.truncatedReason).toContain("工具调用已达上限");
    expect(outcome.toolCalls).toBe(adminToolCalls + 1);
    expect(frames.filter((f) => f.startsWith("event: messages"))).toHaveLength(adminToolCalls);
  });

  it("断开(signal 已 abort):循环即停,end 帧不发", async () => {
    getAgentGraphMock.mockResolvedValue(
      fakeGraph([["messages", [new AIMessageChunk({ content: "x" }), {}]]]),
    );
    const { frames, onFrame } = captureFrames();
    const outcome = await runAgentTurn({
      threadId: "t1",
      message: "q",
      identityKind: "guest",
      limits: runLimits(),
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
      identityKind: "guest",
      resume: { message: "报问题", option: "报问题" },
      limits: runLimits(),
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

describe("死端检测(max_tokens 截断零产出,2026-10-17)", () => {
  it("思考型空轮 stop=max_tokens → deadEndReason 人话(前轮工具调用不串味)", async () => {
    const framesIn: [string, unknown][] = [
      // 第 1 轮:正常工具调用,stop=tool_use(应结算并复位)
      [
        "messages",
        [
          new AIMessageChunk({
            content: "",
            tool_call_chunks: [{ name: "write_todos", args: "{}", id: "call-1", index: 0 }],
            response_metadata: { stop_reason: "tool_use" },
          }),
          {},
        ],
      ],
      // 第 2 轮:纯思考(零文本零工具调用),stop=max_tokens → 死端
      ["messages", [new AIMessageChunk({ content: "", response_metadata: {} }), {}]],
      [
        "messages",
        [new AIMessageChunk({ content: "", response_metadata: { stop_reason: "max_tokens" } }), {}],
      ],
    ];
    getAgentGraphMock.mockResolvedValue(fakeGraph(framesIn));
    const { frames, onFrame } = captureFrames();
    const outcome = await runAgentTurn({
      threadId: "t1",
      message: "q",
      identityKind: "admin",
      limits: runLimits("admin"),
      signal: signalSettled(false),
      onFrame,
    });
    expect(outcome.deadEndReason).toContain("max_tokens 截断");
    expect(outcome.deadEndReason).toContain("max_tokens");
    expect(outcome.truncatedReason).toBeNull();
    expect(frames.at(-1)).toContain("event: end");
  });

  it("有文本或有工具调用的截断轮不误报;正常 end_turn 不触发", async () => {
    const framesIn: [string, unknown][] = [
      // 截断但有部分文本 → 不算死端(UI 有可见产出)
      [
        "messages",
        [
          new AIMessageChunk({
            content: "写到一半被截",
            response_metadata: { stop_reason: "max_tokens" },
          }),
          {},
        ],
      ],
      // 工具调用轮截断 → 不算死端(参数修复中间件兜)
      [
        "messages",
        [
          new AIMessageChunk({
            content: "",
            tool_call_chunks: [{ name: "search_site", args: "{}", id: "call-9", index: 0 }],
            response_metadata: { stop_reason: "max_tokens" },
          }),
          {},
        ],
      ],
      // 正常收尾
      [
        "messages",
        [new AIMessageChunk({ content: "完", response_metadata: { stop_reason: "end_turn" } }), {}],
      ],
    ];
    getAgentGraphMock.mockResolvedValue(fakeGraph(framesIn));
    const outcome = await runAgentTurn({
      threadId: "t1",
      message: "q",
      identityKind: "guest",
      limits: runLimits(),
      signal: signalSettled(false),
      onFrame: () => {},
    });
    expect(outcome.deadEndReason).toBeNull();
  });

  it("openai 口径 finish_reason=length 同样识别", async () => {
    const framesIn: [string, unknown][] = [
      [
        "messages",
        [new AIMessageChunk({ content: "", response_metadata: { finish_reason: "length" } }), {}],
      ],
    ];
    getAgentGraphMock.mockResolvedValue(fakeGraph(framesIn));
    const outcome = await runAgentTurn({
      threadId: "t1",
      message: "q",
      identityKind: "guest",
      limits: runLimits(),
      signal: signalSettled(false),
      onFrame: () => {},
    });
    expect(outcome.deadEndReason).toContain("max_tokens");
  });
});
