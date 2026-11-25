/**
 * 牌价字典注册表单测(M74 批A):厂商/模型 get-or-create 的幂等、
 * 唯一冲突回读(并发)、以及「只补缺不改值」的厂商种子。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const providerFindUnique = vi.fn();
const providerCreate = vi.fn();
const modelFindFirst = vi.fn();
const modelCreate = vi.fn();
const modelUpdate = vi.fn();

vi.mock("@/lib/db", () => ({
  prisma: {
    modelPricingProvider: {
      findUnique: (...a: unknown[]) => providerFindUnique(...a),
      create: (...a: unknown[]) => providerCreate(...a),
    },
    modelPricingModel: {
      findFirst: (...a: unknown[]) => modelFindFirst(...a),
      create: (...a: unknown[]) => modelCreate(...a),
      update: (...a: unknown[]) => modelUpdate(...a),
    },
  },
  isP2002: (e: unknown): boolean =>
    typeof e === "object" && e !== null && (e as { code?: string }).code === "P2002",
}));

import { getOrCreateModel, getOrCreateProvider, syncPricingProviders } from "./model-registry";
import { PROVIDER_SEEDS } from "./provider-registry";

beforeEach(() => {
  vi.clearAllMocks();
  providerFindUnique.mockResolvedValue(null);
  providerCreate.mockImplementation(async (args: { data: { key: string } }) => ({
    id: BigInt(1),
    key: args.data.key,
    name: "x",
    sourceKind: "official",
    region: "cn",
  }));
  modelFindFirst.mockResolvedValue(null);
  modelCreate.mockImplementation(
    async (args: { data: { modelKey: string; matchKey: string } }) => ({
      id: BigInt(9),
      modelKey: args.data.modelKey,
      matchKey: args.data.matchKey,
      displayName: "x",
      family: null,
      modality: "text",
    }),
  );
});

describe("getOrCreateProvider", () => {
  const seed = PROVIDER_SEEDS[0]!;

  it("已存在则直接返回,不重复建", async () => {
    providerFindUnique.mockResolvedValue({ id: BigInt(3), key: seed.key, name: "n" });
    const r = await getOrCreateProvider(seed);
    expect(r.id).toBe(BigInt(3));
    expect(providerCreate).not.toHaveBeenCalled();
  });

  it("不存在则建;唯一冲突(P2002)后回读既有行", async () => {
    providerCreate.mockRejectedValueOnce(Object.assign(new Error("dup"), { code: "P2002" }));
    providerFindUnique.mockResolvedValueOnce(null).mockResolvedValueOnce({
      id: BigInt(7),
      key: seed.key,
      name: "n",
    });
    const r = await getOrCreateProvider(seed);
    expect(r.id).toBe(BigInt(7));
    expect(providerFindUnique).toHaveBeenCalledTimes(2);
  });

  it("非唯一冲突错误照常上抛", async () => {
    providerCreate.mockRejectedValueOnce(new Error("boom"));
    await expect(getOrCreateProvider(seed)).rejects.toThrow("boom");
  });
});

describe("getOrCreateModel", () => {
  it("归一后落库:model_key/match_key 由本模块算,不靠调用方", async () => {
    const r = await getOrCreateModel({ rawKey: "Qwen/Qwen3-235B-A22B" });
    expect(modelCreate).toHaveBeenCalledTimes(1);
    const data = (modelCreate.mock.calls[0]![0] as { data: Record<string, unknown> }).data;
    expect(data.modelKey).toBe("qwen3-235b-a22b");
    expect(data.matchKey).toBe("qwen3-235b-a22b");
    expect(data.displayName).toBe("Qwen3-235B-A22B");
    expect(r.id).toBe(BigInt(9));
  });

  it("match_key 命中既有行则复用(同模型快照版本归一条)", async () => {
    modelFindFirst.mockResolvedValue({
      id: BigInt(5),
      modelKey: "gpt-4o",
      matchKey: "gpt-4o",
      groupKey: "gpt-4o::text",
      displayName: "gpt-4o",
      family: null,
      modality: "text",
    });
    const r = await getOrCreateModel({ rawKey: "gpt-4o-2024-08-06" });
    expect(r.id).toBe(BigInt(5));
    expect(modelCreate).not.toHaveBeenCalled();
  });

  it("归一后为空则拒绝落库", async () => {
    await expect(getOrCreateModel({ rawKey: "  " })).rejects.toThrow("模型键归一后为空");
    expect(modelCreate).not.toHaveBeenCalled();
  });

  it("唯一冲突后回读既有行", async () => {
    modelCreate.mockRejectedValueOnce(Object.assign(new Error("dup"), { code: "P2002" }));
    modelFindFirst.mockResolvedValueOnce(null).mockResolvedValueOnce({
      id: BigInt(11),
      modelKey: "qwen3-max",
      matchKey: "qwen3-max",
      displayName: "qwen3-max",
      family: null,
      modality: "text",
    });
    const r = await getOrCreateModel({ rawKey: "qwen3-max" });
    expect(r.id).toBe(BigInt(11));
  });

  it("批G:新建行按关键词推断模态(seedream→image);认不出落 text", async () => {
    await getOrCreateModel({ rawKey: "doubao-seedream-4-0" });
    const created1 = (modelCreate.mock.calls[0]![0] as { data: { modality: string } }).data;
    expect(created1.modality).toBe("image");

    await getOrCreateModel({ rawKey: "deepseek-v3.2" });
    const created2 = (modelCreate.mock.calls[1]![0] as { data: { modality: string } }).data;
    expect(created2.modality).toBe("text");
  });

  it("P1:group_key 命中既有行则复用(跨源异写归一条,不新建)", async () => {
    modelFindFirst.mockResolvedValue({
      id: BigInt(31),
      modelKey: "kling-v3",
      matchKey: "kling-v3",
      groupKey: "kling-v3::t2v",
      displayName: "kling-v3",
      family: null,
      modality: "video",
    });
    const r = await getOrCreateModel({
      rawKey: "kling/kling-v3-video-generation",
      modality: "video",
    });
    expect(r.id).toBe(BigInt(31));
    expect(modelCreate).not.toHaveBeenCalled();
    expect(modelUpdate).not.toHaveBeenCalled();
  });

  it("P1:既有行 group_key 为空 → 按 canon 自愈补上(只补缺不覆盖)", async () => {
    modelFindFirst.mockResolvedValue({
      id: BigInt(32),
      modelKey: "kling-v3",
      matchKey: "kling-v3",
      groupKey: null,
      displayName: "kling-v3",
      family: null,
      modality: "video",
    });
    modelUpdate.mockResolvedValue({
      id: BigInt(32),
      modelKey: "kling-v3",
      matchKey: "kling-v3",
      groupKey: "kling-v3::t2v",
      displayName: "kling-v3",
      family: null,
      modality: "video",
    });
    const r = await getOrCreateModel({ rawKey: "kling-v3", modality: "video" });
    expect(modelUpdate).toHaveBeenCalledTimes(1);
    const data = (modelUpdate.mock.calls[0]![0] as { data: Record<string, unknown> }).data;
    expect(data.groupKey).toBe("kling-v3::t2v");
    expect(r.groupKey).toBe("kling-v3::t2v");
  });

  it("批G:既有行 text→非text 单向升级;非 text 不降级不改判", async () => {
    modelFindFirst.mockResolvedValue({
      id: BigInt(21),
      groupKey: null,
      modelKey: "doubao-seedream-4-0",
      matchKey: "doubao-seedream-4-0",
      displayName: "doubao-seedream-4-0",
      family: null,
      modality: "text",
    });
    modelUpdate.mockImplementation(async (args: { data: { modality: string } }) => ({
      id: BigInt(21),
      modelKey: "doubao-seedream-4-0",
      matchKey: "doubao-seedream-4-0",
      displayName: "doubao-seedream-4-0",
      family: null,
      modality: args.data.modality,
    }));
    await getOrCreateModel({ rawKey: "doubao-seedream-4-0" });
    expect(modelUpdate).toHaveBeenCalledTimes(1);
    expect((modelUpdate.mock.calls[0]![0] as { data: { modality: string } }).data.modality).toBe(
      "image",
    );

    // 现值非 text:显式标注与关键词都不改判
    modelFindFirst.mockResolvedValue({
      id: BigInt(22),
      groupKey: "doubao-seedream-4-0::t2i",
      modelKey: "doubao-seedream-4-0",
      matchKey: "doubao-seedream-4-0",
      displayName: "doubao-seedream-4-0",
      family: null,
      modality: "image",
    });
    const r = await getOrCreateModel({ rawKey: "doubao-seedream-4-0", modality: "video" });
    expect(r.modality).toBe("image");
    expect(modelUpdate).toHaveBeenCalledTimes(1);
  });
});

describe("syncPricingProviders", () => {
  it("只补缺不改值:已存在的厂商不重复建", async () => {
    providerFindUnique.mockResolvedValue({ id: BigInt(1) });
    const created = await syncPricingProviders();
    expect(created).toBe(0);
    expect(providerCreate).not.toHaveBeenCalled();
  });

  it("缺失的厂商补建,返回新建条数", async () => {
    providerFindUnique.mockResolvedValue(null);
    const created = await syncPricingProviders();
    expect(created).toBe(PROVIDER_SEEDS.length);
    expect(providerCreate).toHaveBeenCalledTimes(PROVIDER_SEEDS.length);
  });
});
