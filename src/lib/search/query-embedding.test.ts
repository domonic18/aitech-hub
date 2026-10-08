/**
 * 查询侧向量化单测(M20 批③):编码/解码纯函数 + embedQueryForSearch 降级纪律
 * (未绑定/非 openai 协议/调用失败 → null,检索继续)、Redis 缓存命中不重调、
 * 成功路径落用量台账(ok)与缓存、失败路径落 degraded。
 */
import { createHash } from "node:crypto";

import { beforeEach, describe, expect, it, vi } from "vitest";

const hoisted = vi.hoisted(() => ({
  resolve: vi.fn(),
  embed: vi.fn(),
  record: vi.fn(),
  redisGet: vi.fn(),
  redisSet: vi.fn(),
}));

vi.mock("../ai/resolver", () => ({ resolveAiModel: hoisted.resolve }));
vi.mock("../ai/embedding-client", () => ({ embedTexts: hoisted.embed }));
vi.mock("../ai/usage-log", () => ({ recordAiUsage: hoisted.record }));
vi.mock("../redis", () => ({
  redis: { get: hoisted.redisGet, set: hoisted.redisSet },
}));
vi.mock("../logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import {
  decodeVectorB64,
  embedQueryForSearch,
  encodeVectorB64,
  QUERY_EMBED_TTL_SEC,
} from "./query-embedding";
import { EMBEDDING_DIMS } from "./embedding";

const MODEL = {
  id: 7,
  name: "智谱",
  protocol: "openai",
  baseUrl: "https://open.bigmodel.cn/api/paas/v4",
  modelId: "embedding-3",
  apiKey: "sk-x",
  timeoutSec: 15,
  concurrency: 2,
  supportsVision: false,
  extraParams: {},
  source: "primary" as const,
};

function vec(base: number): number[] {
  // Float32 可精确表示的值(0.5/-0.25/0),往返逐元素相等
  return Array.from({ length: EMBEDDING_DIMS }, (_, i) =>
    i % 3 === 0 ? base : i % 3 === 1 ? -0.25 : 0,
  );
}

describe("encodeVectorB64 / decodeVectorB64", () => {
  it("往返无损(Float32 精度内逐元素相等)", () => {
    const v = vec(0.5);
    expect(decodeVectorB64(encodeVectorB64(v))).toEqual(v);
  });

  it("污染防护:非 4 倍字节长 / 维度不符 / 非有限值 → null", () => {
    expect(decodeVectorB64(Buffer.from([1, 2, 3]).toString("base64"))).toBeNull();
    expect(decodeVectorB64(encodeVectorB64(vec(1)).slice(0, 8))).toBeNull(); // 截断 → 维度不符
    const nan = new Float32Array(EMBEDDING_DIMS);
    nan[0] = Number.NaN;
    expect(decodeVectorB64(Buffer.from(nan.buffer).toString("base64"))).toBeNull();
  });
});

describe("embedQueryForSearch", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    hoisted.record.mockResolvedValue(undefined);
    hoisted.redisSet.mockResolvedValue("OK");
    hoisted.redisGet.mockResolvedValue(null);
  });

  it("未绑定 embedding 模型 → null,不触缓存与调用", async () => {
    hoisted.resolve.mockResolvedValue(null);
    expect(await embedQueryForSearch("什么是 MCP")).toBeNull();
    expect(hoisted.redisGet).not.toHaveBeenCalled();
    expect(hoisted.embed).not.toHaveBeenCalled();
  });

  it("非 openai 协议(embedding-client 仅该协议)视为未绑定 → null", async () => {
    hoisted.resolve.mockResolvedValue({ ...MODEL, protocol: "anthropic" });
    expect(await embedQueryForSearch("q")).toBeNull();
    expect(hoisted.embed).not.toHaveBeenCalled();
  });

  it("缓存命中:返回向量,不重调 API,不重复写缓存", async () => {
    const v = vec(0.5);
    hoisted.resolve.mockResolvedValue(MODEL);
    hoisted.redisGet.mockResolvedValue(encodeVectorB64(v));
    expect(await embedQueryForSearch("什么是 MCP")).toEqual(v);
    expect(hoisted.embed).not.toHaveBeenCalled();
    expect(hoisted.redisSet).not.toHaveBeenCalled();
  });

  it("缓存未命中:调 API → 台账 ok → 写缓存(EX 24h,key 绑 modelId+sha1(q))", async () => {
    const v = vec(-0.25);
    hoisted.resolve.mockResolvedValue(MODEL);
    hoisted.embed.mockResolvedValue({
      vectors: [v],
      usage: { tokensIn: 6, tokensOut: 0 },
    });
    expect(await embedQueryForSearch("什么是 MCP")).toEqual(v);
    expect(hoisted.embed).toHaveBeenCalledWith(
      expect.objectContaining({
        modelId: "embedding-3",
        texts: ["什么是 MCP"],
        dims: EMBEDDING_DIMS,
      }),
    );
    expect(hoisted.record).toHaveBeenCalledWith(
      expect.objectContaining({ role: "embedding", status: "ok", tokensIn: 6 }),
    );
    const key = `search:emb:embedding-3:${createHash("sha1").update("什么是 MCP").digest("hex")}`;
    expect(hoisted.redisSet).toHaveBeenCalledWith(
      key,
      encodeVectorB64(v),
      "EX",
      QUERY_EMBED_TTL_SEC,
    );
  });

  it("缓存污染(维度不符)回落重调", async () => {
    const v = vec(0.5);
    hoisted.resolve.mockResolvedValue(MODEL);
    hoisted.redisGet.mockResolvedValue(Buffer.from(new Float32Array(8).buffer).toString("base64"));
    hoisted.embed.mockResolvedValue({ vectors: [v], usage: { tokensIn: 6, tokensOut: 0 } });
    expect(await embedQueryForSearch("q")).toEqual(v);
    expect(hoisted.embed).toHaveBeenCalled();
  });

  it("API 失败 → null + 台账 degraded(检索降级,不抛)", async () => {
    hoisted.resolve.mockResolvedValue(MODEL);
    hoisted.embed.mockRejectedValue(new Error("boom"));
    expect(await embedQueryForSearch("q")).toBeNull();
    expect(hoisted.record).toHaveBeenCalledWith(
      expect.objectContaining({ role: "embedding", status: "degraded" }),
    );
  });
});
