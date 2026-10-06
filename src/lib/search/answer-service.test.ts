/**
 * 答案流编排单测(K2):全协作方打桩,以 SSE 事件序列为主锚——
 * 无绑定/超配额(单帧 unavailable,不落台账)、缓存命中(计配额 tokens 0)、
 * 正常生成(meta→delta→done + ok 行 + 写缓存)、0 命中无资料变体、
 * 中途断流(有增量 done+degraded 不写缓存 / 零增量 error+failed)、备用降级。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import { parseSseBlocks, type AnswerEvent } from "./answer-protocol";

const hoisted = vi.hoisted(() => ({
  resolveAiModel: vi.fn(),
  getRoleDailyMax: vi.fn(),
  countTodayRoleUsage: vi.fn(),
  recordAiUsage: vi.fn(),
  chatStream: vi.fn(),
  searchAll: vi.fn(),
  loadCitationBodies: vi.fn(),
  readAnswerCache: vi.fn(),
  writeAnswerCache: vi.fn(),
}));

vi.mock("@/lib/ai/resolver", () => ({
  resolveAiModel: hoisted.resolveAiModel,
  getRoleDailyMax: hoisted.getRoleDailyMax,
}));
vi.mock("@/lib/ai/usage-queries", () => ({ countTodayRoleUsage: hoisted.countTodayRoleUsage }));
vi.mock("@/lib/ai/usage-log", () => ({ recordAiUsage: hoisted.recordAiUsage }));
vi.mock("@/lib/ai/llm-client", () => ({ chatStream: hoisted.chatStream }));
vi.mock("./unified-search", () => ({
  searchAll: hoisted.searchAll,
  loadCitationBodies: hoisted.loadCitationBodies,
  CITATION_SNIPPET_MAX: 300,
}));
vi.mock("./answer-cache", () => ({
  readAnswerCache: hoisted.readAnswerCache,
  writeAnswerCache: hoisted.writeAnswerCache,
}));

import { createAnswerStream } from "./answer-service";
import type { CachedAnswer } from "./answer-cache";

const MODEL = {
  id: 9,
  name: "e2e 模型",
  protocol: "openai",
  baseUrl: "https://llm.test/v1",
  modelId: "deepseek-chat",
  apiKey: "sk-x",
  timeoutSec: 30,
  concurrency: 1,
  supportsVision: false,
  source: "primary" as const,
};

const EMPTY_GROUPS = {
  telegram: { items: [] },
  post: { items: [] },
  repo: { items: [] },
} as never;

async function collect(stream: ReadableStream<Uint8Array>): Promise<AnswerEvent[]> {
  return parseSseBlocks(await new Response(stream).text()).events;
}

beforeEach(() => {
  vi.clearAllMocks();
  hoisted.resolveAiModel.mockResolvedValue(MODEL);
  hoisted.getRoleDailyMax.mockResolvedValue(100);
  hoisted.countTodayRoleUsage.mockResolvedValue(0);
  hoisted.recordAiUsage.mockResolvedValue(undefined);
  hoisted.loadCitationBodies.mockResolvedValue(new Map());
  hoisted.readAnswerCache.mockResolvedValue(null);
  hoisted.writeAnswerCache.mockResolvedValue(undefined);
  hoisted.searchAll.mockResolvedValue({ total: 0, groups: EMPTY_GROUPS });
  hoisted.chatStream.mockResolvedValue({ text: "", usage: { tokensIn: 0, tokensOut: 0 } });
});

const CACHED: CachedAnswer = {
  answer: "缓存答案",
  followUps: ["追问"],
  cites: [{ n: 1, kind: "post", title: "t", href: "h", snippet: "s" }],
  total: 2,
  noHits: false,
  durationMs: 800,
  generatedAt: "2026-10-06 12:00",
};

describe("createAnswerStream 降级与守门", () => {
  it("无绑定:单帧 unavailable(no_binding),不落台账、不检索", async () => {
    hoisted.resolveAiModel.mockResolvedValue(null);
    const events = await collect(await createAnswerStream("MCP"));
    expect(events).toEqual([{ type: "unavailable", reason: "no_binding" }]);
    expect(hoisted.recordAiUsage).not.toHaveBeenCalled();
    expect(hoisted.searchAll).not.toHaveBeenCalled();
  });

  it("超日配额:单帧 unavailable(quota),不落台账(终败才落行)", async () => {
    hoisted.countTodayRoleUsage.mockResolvedValue(100);
    const events = await collect(await createAnswerStream("MCP"));
    expect(events).toEqual([{ type: "unavailable", reason: "quota" }]);
    expect(hoisted.recordAiUsage).not.toHaveBeenCalled();
  });

  it("缓存命中:meta(缓存 cites)+ 全量 delta + done,计配额 tokens 0,不再生成/写缓存", async () => {
    hoisted.readAnswerCache.mockResolvedValue(CACHED);
    const events = await collect(await createAnswerStream("MCP"));
    expect(events.map((e) => e.type)).toEqual(["meta", "delta", "done"]);
    expect(events[0]).toMatchObject({ total: 2, noHits: false, cites: CACHED.cites });
    expect(events[1]).toEqual({ type: "delta", text: "缓存答案" });
    expect(events[2]).toMatchObject({ durationMs: 800, followUps: ["追问"] });
    expect(hoisted.recordAiUsage).toHaveBeenCalledWith(
      expect.objectContaining({
        role: "search",
        status: "ok",
        tokensIn: 0,
        tokensOut: 0,
        durationMs: 0,
      }),
    );
    expect(hoisted.chatStream).not.toHaveBeenCalled();
    expect(hoisted.writeAnswerCache).not.toHaveBeenCalled();
  });
});

describe("createAnswerStream 生成管线", () => {
  it("正常生成:meta→delta(哨兵扣住)→done(3 追问),ok 行透传 tokens,写缓存", async () => {
    hoisted.searchAll.mockResolvedValue({
      total: 2,
      groups: {
        telegram: { items: [] },
        post: {
          items: [
            {
              domain: "post",
              id: "5",
              title: "T",
              snippet: "s",
              href: "/post/5-x/",
              dateIso: null,
              hitPct: 80,
              viewsCount: 0,
              tags: [],
            },
          ],
        },
        repo: {
          items: [
            {
              domain: "repo",
              id: "7",
              title: "R",
              snippet: "",
              href: "https://g",
              dateIso: null,
              hitPct: 60,
              fullName: "R",
              stars: 0,
              language: null,
              topics: [],
              postCount: 0,
            },
          ],
        },
      },
    } as never);
    hoisted.chatStream.mockImplementation(async (_i: unknown, onDelta: (t: string) => void) => {
      onDelta("答案[1]");
      onDelta("\n###FOL");
      onDelta(`LOW###\n- 追问一\n- 追问二\n- 追问三`);
      return { text: "ok", usage: { tokensIn: 11, tokensOut: 22 } };
    });
    const events = await collect(await createAnswerStream("MCP"));
    expect(events.map((e) => e.type)).toEqual(["meta", "delta", "delta", "done"]);
    expect(events[0]).toMatchObject({ total: 2, noHits: false });
    expect((events[0] as { cites: unknown[] }).cites).toHaveLength(2);
    expect(events[1]).toEqual({ type: "delta", text: "答案[1]" });
    expect(events[2]).toEqual({ type: "delta", text: "\n" }); // 半截哨兵 "###FOL" 扣住,仅放行换行
    expect(events[3]).toEqual({
      type: "done",
      durationMs: expect.any(Number),
      followUps: ["追问一", "追问二", "追问三"],
    });
    expect(hoisted.chatStream.mock.calls[0]![0]).toMatchObject({
      protocol: "openai",
      maxTokens: 800,
    });
    expect(hoisted.recordAiUsage).toHaveBeenCalledWith(
      expect.objectContaining({ role: "search", status: "ok", tokensIn: 11, tokensOut: 22 }),
    );
    expect(hoisted.writeAnswerCache).toHaveBeenCalledTimes(1);
  });

  it("0 命中仍生成(需求红线):meta noHits,系统 prompt 用无资料变体", async () => {
    const events = await collect(await createAnswerStream("不存在的词"));
    expect(events[0]).toMatchObject({ total: 0, noHits: true, cites: [] });
    expect(hoisted.chatStream.mock.calls[0]![0].system).toContain("站内没有检索到");
    expect(hoisted.loadCitationBodies).not.toHaveBeenCalled();
  });

  it("中途断流已发增量:done 收尾(无追问),degraded 行,不写缓存", async () => {
    hoisted.chatStream.mockImplementation(async (_i: unknown, onDelta: (t: string) => void) => {
      onDelta("半截答案");
      throw new Error("stream broken");
    });
    const events = await collect(await createAnswerStream("MCP"));
    expect(events.map((e) => e.type)).toEqual(["meta", "delta", "done"]);
    expect(events[2]).toMatchObject({ followUps: [] });
    expect(hoisted.recordAiUsage).toHaveBeenCalledWith(
      expect.objectContaining({ status: "degraded" }),
    );
    expect(hoisted.writeAnswerCache).not.toHaveBeenCalled();
  });

  it("零增量断流:unavailable(error)+ failed 行", async () => {
    hoisted.chatStream.mockRejectedValue(new Error("boom"));
    const events = await collect(await createAnswerStream("MCP"));
    expect(events).toEqual([
      { type: "meta", total: 0, noHits: true, cites: [], generatedAt: expect.any(String) },
      { type: "unavailable", reason: "error" },
    ]);
    expect(hoisted.recordAiUsage).toHaveBeenCalledWith(
      expect.objectContaining({ status: "failed" }),
    );
  });

  it("备用模型命中 → degraded 行(答案照常)", async () => {
    hoisted.resolveAiModel.mockResolvedValue({ ...MODEL, source: "backup" });
    hoisted.chatStream.mockImplementation(async (_i: unknown, onDelta: (t: string) => void) => {
      onDelta(`答案${"###FOLLOW###"}\n- a\n- b\n- c`);
      return { text: "x", usage: { tokensIn: 1, tokensOut: 2 } };
    });
    const events = await collect(await createAnswerStream("MCP"));
    expect(events.map((e) => e.type)).toEqual(["meta", "delta", "done"]);
    expect(events[1]).toEqual({ type: "delta", text: "答案" });
    expect(hoisted.recordAiUsage).toHaveBeenCalledWith(
      expect.objectContaining({ status: "degraded" }),
    );
    expect(hoisted.writeAnswerCache).toHaveBeenCalledTimes(1);
  });
});
