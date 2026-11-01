/** chatJsonTask 重试与扩展参数透传单测(2026-10-30:2xx 业务错就地重试一次) */
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { ResolvedAiModel } from "./resolver";

const chatJson = vi.fn();
vi.mock("./llm-client", () => ({ chatJson: (...args: unknown[]) => chatJson(...args) }));

const { chatJsonTask } = await import("./chat-json-task");
const { AiClientError } = await import("./errors");

const model: ResolvedAiModel = {
  id: 1,
  name: "解读主力",
  protocol: "anthropic",
  baseUrl: "https://api.example.com",
  modelId: "MiniMax-M3.1-Flash-Preview",
  apiKey: "k",
  timeoutSec: 30,
  concurrency: 1,
  supportsVision: false,
  extraParams: {},
  source: "primary",
};

const parse = (raw: string) =>
  raw === "ok" ? ({ ok: true, data: "ok" } as const) : ({ ok: false, error: "不是 ok" } as const);

describe("chatJsonTask", () => {
  beforeEach(() => {
    chatJson.mockReset();
  });

  it("2xx 业务错(如响应无 text 块)→ 就地重试一次,不判死", async () => {
    chatJson
      .mockRejectedValueOnce(new AiClientError("business", "响应无 text 块(契约漂移)"))
      .mockResolvedValueOnce("ok");
    await expect(chatJsonTask(model, parse, "sys", "user")).resolves.toBe("ok");
    expect(chatJson).toHaveBeenCalledTimes(2);
  });

  it("契约解析失败同样重试一次", async () => {
    chatJson.mockResolvedValueOnce("bad").mockResolvedValueOnce("ok");
    await expect(chatJsonTask(model, parse, "sys", "user")).resolves.toBe("ok");
    expect(chatJson).toHaveBeenCalledTimes(2);
  });

  it("两次业务错 → 抛业务错(带上末次原因)", async () => {
    chatJson.mockRejectedValue(new AiClientError("business", "响应无 text 块(契约漂移)"));
    await expect(chatJsonTask(model, parse, "sys", "user")).rejects.toThrow(/无 text 块/);
    expect(chatJson).toHaveBeenCalledTimes(2);
  });

  it("网络/HTTP/超时错不重试,原样上抛(交 BullMQ attempts)", async () => {
    chatJson.mockRejectedValue(new AiClientError("timeout", "LLM 超时 30s"));
    await expect(chatJsonTask(model, parse, "sys", "user")).rejects.toThrow(/超时/);
    expect(chatJson).toHaveBeenCalledTimes(1);
  });

  it("maxTokens/outputConfig 透传给 chatJson", async () => {
    chatJson.mockResolvedValueOnce("ok");
    await chatJsonTask(model, parse, "sys", "user", undefined, {
      maxTokens: 8192,
      outputConfig: { effort: "low" },
    });
    expect(chatJson.mock.calls[0][0]).toMatchObject({
      maxTokens: 8192,
      outputConfig: { effort: "low" },
    });
  });
});
