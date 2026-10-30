/** 洞察日批编排单测(prisma + AI 依赖全 mock,评分纯函数真跑;M47 批C 补盲):
 * 打标段委托 runLabelBatch(M60 批C 起批内编排收口 label.ts,三个分支的断言
 * 迁至 label-batch.test.ts)与机械段解耦、快照 rank 同 kind 独立名次、峰值锚点
 * 新高才动、fading 兜底、覆盖度计数。 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/datetime", () => ({ DAY_MS: 86_400_000, statsDay: () => "2026-10-24" }));

const runLabelBatch = vi.fn();
const topVectorMatches = vi.fn();
const getClusterCentroid = vi.fn();
const queryRaw = vi.fn();
const executeRaw = vi.fn();
const clusterUpdate = vi.fn();
const clusterFindMany = vi.fn();

vi.mock("./label", () => ({
  runLabelBatch: (...a: unknown[]) => runLabelBatch(...a),
}));
vi.mock("../search/embedding-repo", () => ({
  topVectorMatches: (...a: unknown[]) => topVectorMatches(...a),
}));
vi.mock("./embedding-repo", () => ({
  getClusterCentroid: (...a: unknown[]) => getClusterCentroid(...a),
}));
vi.mock("@/lib/db", () => ({
  prisma: {
    $queryRaw: (strings: TemplateStringsArray, ...v: unknown[]) => queryRaw(strings, ...v),
    $executeRaw: (strings: TemplateStringsArray, ...v: unknown[]) => executeRaw(strings, ...v),
    insightCluster: {
      update: (...a: unknown[]) => clusterUpdate(...a),
      findMany: (...a: unknown[]) => clusterFindMany(...a),
      // 覆盖度段的 labeled 查询;恒 null → 无标签早退(质心桩同 null)
      findUnique: () => Promise.resolve(null),
    },
  },
}));

import { runInsightDaily } from "./daily";

beforeEach(() => {
  vi.clearAllMocks();
  runLabelBatch.mockResolvedValue({ labeled: 0, failed: 0, skipped: false, reason: null });
  getClusterCentroid.mockResolvedValue(null);
  topVectorMatches.mockResolvedValue([]);
  clusterUpdate.mockResolvedValue({ id: BigInt(1) });
  // 机械段两次 findMany:①active 行(带 score/peakAt)②痛点覆盖目标;按 select 区分
  clusterFindMany.mockImplementation((args: { select?: Record<string, unknown> }) =>
    args.select && "peakAt" in args.select
      ? Promise.resolve([
          {
            id: BigInt(11),
            score: 4,
            peakAt: new Date("2026-10-20T00:00:00Z"),
            coverageScore: 0.2,
          },
        ])
      : Promise.resolve([{ id: BigInt(33) }]),
  );
  queryRaw.mockResolvedValue([
    {
      id: BigInt(11),
      kind: "hot",
      members: BigInt(3),
      heat: BigInt(9),
      media: ["bilibili", "baidu"],
    },
    { id: BigInt(22), kind: "hot", members: BigInt(0), heat: BigInt(0), media: [] },
  ]);
  // 快照 INSERT 返 1;fading UPDATE 返 2(按 SQL 前缀区分)
  executeRaw.mockImplementation((strings: TemplateStringsArray) => {
    const sql = strings.join("");
    return Promise.resolve(sql.includes("INSERT INTO insight_snapshot") ? 1 : 2);
  });
});

describe("runInsightDaily 打标段", () => {
  it("委托 runLabelBatch(批大小=LABEL_BATCH_SIZE=24),结果直落 summary", async () => {
    runLabelBatch.mockResolvedValue({ labeled: 3, failed: 1, skipped: false, reason: null });
    const s = await runInsightDaily();
    expect(runLabelBatch).toHaveBeenCalledWith(24);
    expect(s.labeled).toBe(3);
    expect(s.labelFailed).toBe(1);
    expect(s.labelSkipped).toBe(false);
  });

  it("打标跳过(未绑定/配额尽)→ summary 标记 skipped,机械段照常演进", async () => {
    runLabelBatch.mockResolvedValue({
      labeled: 0,
      failed: 0,
      skipped: true,
      reason: "quota_exhausted",
    });
    const s = await runInsightDaily();
    expect(s.labelSkipped).toBe(true);
    expect(s.scored).toBe(1);
    expect(s.snapshots).toBe(1);
  });
});

describe("runInsightDaily 机械段", () => {
  it("零成员簇不评分;峰值锚点创新高才写 peakAt;快照 rank 同 kind 名次", async () => {
    const s = await runInsightDaily();
    // 22 号簇零成员被滤;11 号 prevScore=4 < 新分 → 新高写 peakAt
    expect(s.scored).toBe(1);
    expect(clusterUpdate).toHaveBeenCalledTimes(1);
    const upArgs = clusterUpdate.mock.calls[0]![0] as {
      where: { id: bigint };
      data: { peakAt: unknown };
    };
    expect(upArgs.where.id).toBe(BigInt(11));
    expect(upArgs.data.peakAt).toBeInstanceOf(Date);
    // 两条 INSERT(仅 11 号一条快照)…实为 1 条;fading UPDATE 一条
    const inserts = executeRaw.mock.calls.filter((c) =>
      (c[0] as TemplateStringsArray).join("").includes("INSERT INTO insight_snapshot"),
    );
    expect(inserts).toHaveLength(1);
    expect(s.faded).toBe(2);
    expect(s.covered).toBe(1); // 覆盖目标 33 号(centroid null 跳过仍计数,现行为)
  });

  it("评分未创新高 → peakAt 不动(undefined 即 Prisma 跳过该列)", async () => {
    clusterFindMany.mockImplementation((args: { select?: Record<string, unknown> }) =>
      args.select && "peakAt" in args.select
        ? Promise.resolve([
            {
              id: BigInt(11),
              score: 100,
              peakAt: new Date("2026-10-20T00:00:00Z"),
              coverageScore: null,
            },
          ])
        : Promise.resolve([]),
    );
    await runInsightDaily();
    expect(clusterUpdate).toHaveBeenCalledTimes(1);
    const upArgs = clusterUpdate.mock.calls[0]![0] as { data: { peakAt: unknown; score: number } };
    expect(upArgs.data.peakAt).toBeUndefined();
  });

  it("首次计分(无 active 行)→ 视作新高写 peakAt", async () => {
    clusterFindMany.mockImplementation((args: { select?: Record<string, unknown> }) =>
      args.select && "peakAt" in args.select
        ? Promise.resolve([])
        : Promise.resolve([{ id: BigInt(33) }]),
    );
    const s = await runInsightDaily();
    expect(s.scored).toBe(1);
    const upArgs = clusterUpdate.mock.calls[0]![0] as { data: { peakAt: unknown } };
    expect(upArgs.data.peakAt).toBeInstanceOf(Date);
  });
});
