/**
 * 答案缓存单测(K2):归一化键稳定、读写与 TTL、坏值/Redis 异常吞掉(miss 放行)。
 */
import { describe, expect, it, vi } from "vitest";

const hoisted = vi.hoisted(() => ({ get: vi.fn(), set: vi.fn() }));
vi.mock("@/lib/redis", () => ({ redis: { get: hoisted.get, set: hoisted.set } }));

import {
  ANSWER_CACHE_TTL_SECONDS,
  answerCacheKey,
  normalizeQueryKey,
  readAnswerCache,
  writeAnswerCache,
  type CachedAnswer,
} from "./answer-cache";

const VALUE: CachedAnswer = {
  answer: "答案",
  followUps: ["a"],
  cites: [],
  total: 2,
  noHits: false,
  durationMs: 900,
};

describe("键归一", () => {
  it("trim + 小写 + 空白折叠 → 键稳定", () => {
    expect(normalizeQueryKey("  MCP  实战 ")).toBe("mcp 实战");
    expect(answerCacheKey("MCP  实战")).toBe(answerCacheKey("mcp 实战"));
    expect(answerCacheKey("x").startsWith("search:answer:v1:")).toBe(true);
  });
});

describe("readAnswerCache", () => {
  it("命中出对象;坏 JSON → null;Redis 异常 → null", async () => {
    hoisted.get.mockResolvedValue(JSON.stringify(VALUE));
    expect(await readAnswerCache("q")).toEqual(VALUE);

    hoisted.get.mockResolvedValue("{oops");
    expect(await readAnswerCache("q")).toBeNull();

    hoisted.get.mockRejectedValue(new Error("down"));
    expect(await readAnswerCache("q")).toBeNull();
  });
});

describe("writeAnswerCache", () => {
  it("EX 86400 写入;Redis 异常吞掉", async () => {
    hoisted.set.mockResolvedValue("OK");
    await writeAnswerCache("q", VALUE);
    expect(hoisted.set).toHaveBeenCalledWith(
      answerCacheKey("q"),
      JSON.stringify(VALUE),
      "EX",
      ANSWER_CACHE_TTL_SECONDS,
    );

    hoisted.set.mockRejectedValue(new Error("down"));
    await expect(writeAnswerCache("q", VALUE)).resolves.toBeUndefined();
  });
});
