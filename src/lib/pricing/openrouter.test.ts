/**
 * OpenRouter 预填单测(M55 批B,prisma mock 无真库无真网):USD/token→百万
 * 换算边界 / 免费变体与白名单外过滤 / 初稿三规则(不存在建 pending、pending
 * 刷新、enabled/disabled 不动)/ fetch 失败上抛。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const findMany = vi.fn();
const create = vi.fn();
const update = vi.fn();

vi.mock("@/lib/db", () => ({
  prisma: {
    modelPricing: {
      findMany: (...a: unknown[]) => findMany(...a),
      create: (...a: unknown[]) => create(...a),
      update: (...a: unknown[]) => update(...a),
    },
  },
}));

import {
  mapOpenRouterModels,
  syncOpenrouterPrefill,
  usdPerTokenToPerMillion,
  type OpenRouterModel,
} from "./openrouter";

function model(id: string, prompt: string, completion: string, ctx?: number): OpenRouterModel {
  return {
    id,
    name: "X: Y",
    context_length: ctx ?? null,
    pricing: { prompt, completion },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("usdPerTokenToPerMillion", () => {
  it("USD/token ×1e6 = USD/百万;非法与负值=null", () => {
    expect(usdPerTokenToPerMillion("0.000002")).toBe(2);
    expect(usdPerTokenToPerMillion("0.00000025")).toBeCloseTo(0.25, 6);
    expect(usdPerTokenToPerMillion("0")).toBe(0);
    expect(usdPerTokenToPerMillion("-1")).toBeNull();
    expect(usdPerTokenToPerMillion("abc")).toBeNull();
  });
});

describe("mapOpenRouterModels", () => {
  it("白名单映射(z-ai→智谱 cn、openai→intl);:free 与白名单外跳过;双价皆缺跳过", () => {
    const rows = mapOpenRouterModels(
      [
        model("z-ai/glm-4.6", "0.0000028", "0.0000028", 1_048_576),
        model("openai/gpt-5", "0.00000125", "0.00001", 400_000),
        model("deepseek/deepseek-chat:free", "0", "0"),
        model("weird-vendor/mystery", "0.001", "0.002"),
        model("deepseek/r1-distill", "-1", "-1"),
      ],
      new Date("2026-10-28T00:00:00Z"),
    );
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      vendor: "智谱 AI · BigModel",
      modelKey: "glm-4.6",
      region: "cn",
      inputPrice: 2.8,
      contextWindow: "1024K",
    });
    expect(rows[0]!.sourceUrl).toBe("https://openrouter.ai/z-ai/glm-4.6");
    expect(rows[0]!.note).toContain("[openrouter 预填 2026-10-28]");
    expect(rows[1]).toMatchObject({
      vendor: "OpenAI",
      modelKey: "gpt-5",
      region: "intl",
      outputPrice: 10,
    });
  });
});

describe("syncOpenrouterPrefill 初稿三规则", () => {
  const rows = [
    model("deepseek/deepseek-v3.2", "0.000002", "0.000008", 131_072),
    model("deepseek/deepseek-r1", "0.000001", "0.000004"),
  ];

  it("不存在→建 pending;pending→刷新;enabled→不动", async () => {
    findMany.mockResolvedValue([
      { id: BigInt(9), vendor: "DeepSeek 深度求索", modelKey: "deepseek-r1", status: "enabled" },
      { id: BigInt(7), vendor: "DeepSeek 深度求索", modelKey: "deepseek-v3.2", status: "pending" },
    ]);
    create.mockResolvedValue({ id: BigInt(100) });
    update.mockResolvedValue({ id: BigInt(7) });

    const s = await syncOpenrouterPrefill(
      async () => ({ data: rows }),
      new Date("2026-10-28T00:00:00Z"),
    );
    expect(s).toMatchObject({ fetched: 2, mapped: 2, created: 0, refreshed: 1, untouched: 1 });
    expect(create).not.toHaveBeenCalled(); // 两行都有既有行
    expect(update).toHaveBeenCalledTimes(1);
    const upd = update.mock.calls[0]![0] as { where: { id: bigint }; data: { status?: string } };
    expect(upd.where.id).toBe(BigInt(7));
    expect(upd.data.status).toBeUndefined(); // 刷新不触状态机
  });

  it("陌生模型→create 落 pending", async () => {
    findMany.mockResolvedValue([]);
    create.mockResolvedValue({ id: BigInt(1) });
    const s = await syncOpenrouterPrefill(
      async () => ({ data: rows }),
      new Date("2026-10-28T00:00:00Z"),
    );
    expect(s.created).toBe(2);
    const arg = create.mock.calls[0]![0] as { data: { status: string; currency: string } };
    expect(arg.data.status).toBe("pending");
    expect(arg.data.currency).toBe("USD");
  });

  it("fetch 失败上抛(路由 502 / worker 重试)", async () => {
    await expect(
      syncOpenrouterPrefill(async () => {
        throw new Error("http 503");
      }),
    ).rejects.toThrow("http 503");
  });

  it("单行落库失败自吞计数,不殃及批内其余", async () => {
    findMany.mockResolvedValue([]);
    create.mockRejectedValueOnce(new Error("db boom")).mockResolvedValue({ id: BigInt(2) });
    const s = await syncOpenrouterPrefill(
      async () => ({ data: rows }),
      new Date("2026-10-28T00:00:00Z"),
    );
    expect(s).toMatchObject({ created: 1, failed: 1 });
  });
});
