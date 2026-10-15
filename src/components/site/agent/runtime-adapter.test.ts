/**
 * 防腐层出线契约(M31 验收反馈修复回归):SDK 在中断挂起时再发新消息会前置
 * type:"tool" 取消桩(autoCancelPendingToolCalls 默认开),后端只收单条
 * human——适配层必须收敛出线批次,桩不入线;resume 空消息批原样透传。
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import type { LangChainMessage } from "@assistant-ui/react-langgraph";

import { createAgentRuntimeAdapter } from "./runtime-adapter";

/** 空流响应(read 立即 done,生成器收尾不产出帧) */
function emptyStreamResponse(): Response {
  return {
    ok: true,
    body: {
      getReader: () => ({
        read: async () => ({ done: true, value: undefined }),
        releaseLock: () => {},
      }),
    },
  } as unknown as Response;
}

function captureFetchBodies(): string[] {
  const bodies: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_input: string, init?: RequestInit) => {
      bodies.push(String(init?.body));
      return emptyStreamResponse();
    }),
  );
  return bodies;
}

async function drain(
  stream: AsyncGenerator<unknown> | Promise<AsyncGenerator<unknown>>,
): Promise<void> {
  const gen = await stream;
  for (;;) {
    const r = await gen.next();
    if (r.done) break;
  }
}

function buildAdapter(getContext?: () => unknown): ReturnType<typeof createAgentRuntimeAdapter> {
  return createAgentRuntimeAdapter(getContext ? { getContext } : {});
}

function runConfig(command?: unknown): never {
  return {
    initialize: async () => ({ externalId: "t1" }),
    abortSignal: new AbortController().signal,
    ...(command !== undefined ? { command } : {}),
  } as never;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("agent runtime adapter stream 出线收敛", () => {
  it("普通新提问:单条 human 原样出线,附页面上下文", async () => {
    const bodies = captureFetchBodies();
    const adapter = buildAdapter(() => ({ postId: "271" }));
    await drain(
      adapter.stream(
        [{ type: "human", content: "为本文生成封面候选" }] as LangChainMessage[],
        runConfig(),
      ),
    );
    const body = JSON.parse(bodies[0]) as {
      input: { messages: LangChainMessage[] };
      context?: unknown;
    };
    expect(body.input.messages).toHaveLength(1);
    expect(body.input.messages[0].type).toBe("human");
    expect(body.context).toEqual({ postId: "271" });
  });

  it("中断挂起时再发消息:SDK 前置的 tool 取消桩被剥离,仅最后一条 human 入线", async () => {
    const bodies = captureFetchBodies();
    const adapter = buildAdapter();
    const batch = [
      {
        type: "tool",
        name: "generate_post_cover",
        tool_call_id: "call_1",
        content: '{"cancelled":true}',
        status: "error",
      },
      { type: "human", content: "重新生成封面候选" },
    ] as unknown as LangChainMessage[];
    await drain(adapter.stream(batch, runConfig()));
    const body = JSON.parse(bodies[0]) as {
      input: { messages: Array<{ type: string }> };
      command?: unknown;
    };
    expect(body.input.messages).toHaveLength(1);
    expect(body.input.messages[0].type).toBe("human");
    expect(body.command).toBeUndefined();
  });

  it("HITL resume 空消息批:input=null + command 原样透传,不带上下文", async () => {
    const bodies = captureFetchBodies();
    const adapter = buildAdapter(() => ({ postId: "271" }));
    const command = { resume: { decision: "adopt", candidateId: "16" } };
    await drain(adapter.stream([] as LangChainMessage[], runConfig(command)));
    const body = JSON.parse(bodies[0]) as { input: unknown; command: unknown; context?: unknown };
    expect(body.input).toBeNull();
    expect(body.command).toEqual(command);
    expect(body.context).toBeUndefined();
  });
});
