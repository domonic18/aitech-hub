/** embedding 回填批单测(依赖全 mock;M47 批C 补盲):未绑定跳过/分块回填
 * 用量落账/chunk 失败计 failed 且聚类仍跑/零信号直通聚类。 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const resolveAiModel = vi.fn();
const embedTexts = vi.fn();
const recordAiUsage = vi.fn();
const findUnembeddedSignals = vi.fn();
const saveSignalEmbeddings = vi.fn();
const runInsightClustering = vi.fn();
const runInsightClassify = vi.fn();

vi.mock("../ai/resolver", () => ({ resolveAiModel: (...a: unknown[]) => resolveAiModel(...a) }));
vi.mock("../ai/embedding-client", () => ({
  embedTexts: (...a: unknown[]) => embedTexts(...a),
  EMBED_BATCH_SIZE: 16,
}));
vi.mock("../ai/usage-log", () => ({ recordAiUsage: (...a: unknown[]) => recordAiUsage(...a) }));
vi.mock("./cluster", () => ({
  runInsightClustering: (...a: unknown[]) => runInsightClustering(...a),
}));
// classify(M54 批B 新增依赖)顶层引入 ../db,不 mock 会在 CI 无 DB 环境实例化真 PrismaClient
vi.mock("./classify", () => ({
  runInsightClassify: (...a: unknown[]) => runInsightClassify(...a),
}));
vi.mock("./embedding-repo", () => ({
  findUnembeddedSignals: (...a: unknown[]) => findUnembeddedSignals(...a),
  saveSignalEmbeddings: (...a: unknown[]) => saveSignalEmbeddings(...a),
}));
// 翻译降级(M58 批①新增依赖)顶层引入 ../db,不 mock 会在 CI 无 DB 环境查库
const degradeStalePendingTranslations = vi.fn();
vi.mock("./translate", () => ({
  degradeStalePendingTranslations: (...a: unknown[]) => degradeStalePendingTranslations(...a),
}));

import { runInsightEmbedBatch } from "./embed";

const MODEL = {
  id: 7,
  modelId: "embedding-3",
  protocol: "openai",
  baseUrl: "https://api.example.com",
  apiKey: "sk-x",
  timeoutSec: 30,
} as never;

function signal(id: number): { id: bigint; normalizedText: string } {
  return { id: BigInt(id), normalizedText: `信号 ${id}` };
}

beforeEach(() => {
  vi.clearAllMocks();
  resolveAiModel.mockResolvedValue(MODEL);
  runInsightClustering.mockResolvedValue({ joined: 2, created: 1, short: 0, failed: 0 });
  runInsightClassify.mockResolvedValue({ scanned: 0, classified: 0, kept: 0, failed: 0 });
  recordAiUsage.mockResolvedValue(undefined);
  saveSignalEmbeddings.mockResolvedValue(undefined);
  degradeStalePendingTranslations.mockResolvedValue(0);
});

describe("runInsightEmbedBatch", () => {
  it("未绑定 embedding 模型 → 整轮 skipped,不触信号层", async () => {
    resolveAiModel.mockResolvedValue(null);
    const s = await runInsightEmbedBatch();
    expect(s.skipped).toBe(true);
    expect(findUnembeddedSignals).not.toHaveBeenCalled();
    expect(runInsightClustering).not.toHaveBeenCalled();
  });

  it("回填:向量化→落库→用量 ok 落账;聚类摘要透传", async () => {
    findUnembeddedSignals.mockResolvedValue([signal(1), signal(2), signal(3)]);
    embedTexts.mockResolvedValue({ vectors: [[0.1], [0.2], [0.3]], usage: { tokensIn: 42 } });
    const s = await runInsightEmbedBatch(50);
    expect(degradeStalePendingTranslations).toHaveBeenCalledTimes(1);
    expect(findUnembeddedSignals).toHaveBeenCalledWith(50);
    expect(embedTexts).toHaveBeenCalledTimes(1);
    const embedArgs = embedTexts.mock.calls[0]![0] as { texts: string[]; modelId: string };
    expect(embedArgs.texts).toEqual(["信号 1", "信号 2", "信号 3"]);
    expect(embedArgs.modelId).toBe("embedding-3");
    expect(saveSignalEmbeddings).toHaveBeenCalledWith([
      { id: BigInt(1), vector: [0.1] },
      { id: BigInt(2), vector: [0.2] },
      { id: BigInt(3), vector: [0.3] },
    ]);
    const usage = recordAiUsage.mock.calls[0]![0] as { status: string; tokensIn: number };
    expect(usage.status).toBe("ok");
    expect(usage.tokensIn).toBe(42);
    expect(s).toMatchObject({ embedded: 3, failed: 0, joined: 2, created: 1, skipped: false });
  });

  it("chunk 失败:整块计 failed、用量 failed 落账,聚类照常执行", async () => {
    findUnembeddedSignals.mockResolvedValue([signal(1), signal(2)]);
    embedTexts.mockRejectedValue(new Error("5xx"));
    const s = await runInsightEmbedBatch();
    expect(s.embedded).toBe(0);
    expect(s.failed).toBe(2);
    const usage = recordAiUsage.mock.calls[0]![0] as { status: string; tokensIn?: number };
    expect(usage.status).toBe("failed");
    expect(usage.tokensIn).toBeUndefined();
    expect(runInsightClustering).toHaveBeenCalledTimes(1);
  });

  it("零信号:不调 embedTexts,聚类仍执行", async () => {
    findUnembeddedSignals.mockResolvedValue([]);
    const s = await runInsightEmbedBatch();
    expect(embedTexts).not.toHaveBeenCalled();
    expect(s.embedded).toBe(0);
    expect(s.joined).toBe(2);
  });
});
