/** 打标批量/单簇入口单测(M60 批C):runLabelBatch 的三条前置分支(未绑定/
 * 配额尽/正常)与配额钳制、逐簇成败混计;labelReadiness/labelClusterNow 的
 * 阻断原因映射。LLM 契约解析的纯函数用例在 label.test.ts。 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const resolveInsightModel = vi.fn();
const countTodayRoleUsage = vi.fn();
const getRoleDailyMax = vi.fn();
const chatJsonTask = vi.fn();
const queryRaw = vi.fn();
const signalFindMany = vi.fn();
const clusterFindUnique = vi.fn();
const memberCount = vi.fn();
const clusterUpdate = vi.fn();

vi.mock("../ai/resolver", () => ({
  getRoleDailyMax: (...a: unknown[]) => getRoleDailyMax(...a),
}));
vi.mock("../ai/usage-queries", () => ({
  countTodayRoleUsage: (...a: unknown[]) => countTodayRoleUsage(...a),
}));
vi.mock("../ai/chat-json-task", () => ({
  chatJsonTask: (...a: unknown[]) => chatJsonTask(...a),
}));
vi.mock("./model", () => ({
  resolveInsightModel: (...a: unknown[]) => resolveInsightModel(...a),
}));
vi.mock("@/lib/db", () => ({
  prisma: {
    $queryRaw: (strings: TemplateStringsArray, ...v: unknown[]) => queryRaw(strings, ...v),
    insightSignal: {
      findMany: (...a: unknown[]) => signalFindMany(...a),
    },
    insightCluster: {
      findUnique: (...a: unknown[]) => clusterFindUnique(...a),
      update: (...a: unknown[]) => clusterUpdate(...a),
    },
    insightClusterMember: {
      count: (...a: unknown[]) => memberCount(...a),
    },
  },
}));

import { labelClusterNow, labelReadiness, runLabelBatch } from "./label";

const MODEL = { id: 1, modelId: "k2.5", extraParams: {} } as never;
const CONTRACT = {
  label: "AI 编程工具选型",
  summary: "多工具难抉择",
  keywords: ["Cursor", "Copilot"],
  kind: "hot" as const,
  sentiment: "neutral" as const,
};
const SAMPLE = [{ rawText: "样本原话", source: "weibo" }];

/** 逐簇样本队列(空数组 = 该簇无样本 → labelCluster 回 false) */
let samples: unknown[][];

beforeEach(() => {
  vi.resetAllMocks();
  samples = [];
  // 判定半场(insight_judge)未绑定 → Jev 直通,不打外部 decisions 接口
  resolveInsightModel.mockImplementation((purpose: unknown) =>
    Promise.resolve(purpose === "insight" ? MODEL : null),
  );
  countTodayRoleUsage.mockResolvedValue(0);
  getRoleDailyMax.mockResolvedValue(300);
  queryRaw.mockResolvedValue([]);
  chatJsonTask.mockResolvedValue(CONTRACT);
  // 两次 findMany:①样本(select 含 rawText)②介质/地域(select 含 medium)
  signalFindMany.mockImplementation((args: { select?: Record<string, unknown> }) => {
    if (args.select && "rawText" in args.select) {
      return Promise.resolve(samples.shift() ?? SAMPLE);
    }
    return Promise.resolve([{ medium: "time", region: "cn" }]);
  });
  clusterFindUnique.mockResolvedValue({ label: null, summary: null });
  memberCount.mockResolvedValue(5);
  clusterUpdate.mockResolvedValue({ id: BigInt(1) });
});

describe("runLabelBatch", () => {
  it("未绑定 insight 模型 → 整批跳过,不查配额与候选", async () => {
    resolveInsightModel.mockResolvedValue(null);
    const r = await runLabelBatch(40);
    expect(r).toEqual({ labeled: 0, failed: 0, skipped: true, reason: "insight_unbound" });
    expect(countTodayRoleUsage).not.toHaveBeenCalled();
    expect(queryRaw).not.toHaveBeenCalled();
  });

  it("当日配额耗尽 → 整批跳过", async () => {
    countTodayRoleUsage.mockResolvedValue(300);
    const r = await runLabelBatch(40);
    expect(r).toEqual({ labeled: 0, failed: 0, skipped: true, reason: "quota_exhausted" });
    expect(queryRaw).not.toHaveBeenCalled();
  });

  it("候选数 = min(剩余配额, limit):配额只剩 7 时按 7 取簇", async () => {
    countTodayRoleUsage.mockResolvedValue(293);
    await runLabelBatch(40);
    expect(queryRaw).toHaveBeenCalledTimes(1);
    // SQL 绑定值:LIMIT 位是 min(quota, limit)=7(≠ LABEL_MIN_MEMBERS=3)
    expect((queryRaw.mock.calls[0] as unknown[]).slice(1)).toContain(7);
  });

  it("批内成败混计:成功 +1、无样本回 false 记失败、抛错自吞记失败", async () => {
    queryRaw.mockResolvedValue([
      { id: BigInt(1), members: BigInt(3) },
      { id: BigInt(2), members: BigInt(4) },
      { id: BigInt(3), members: BigInt(5) },
    ]);
    // 簇 1 有样本 → 成功;簇 2 无样本 → false;簇 3 有样本但 LLM 抛错
    samples = [SAMPLE, [], SAMPLE];
    chatJsonTask.mockResolvedValueOnce(CONTRACT).mockRejectedValueOnce(new Error("llm 5xx"));
    const r = await runLabelBatch(40);
    expect(r).toEqual({ labeled: 1, failed: 2, skipped: false, reason: null });
  });
});

describe("labelReadiness / labelClusterNow", () => {
  it("未绑定 → unbound", async () => {
    resolveInsightModel.mockResolvedValue(null);
    expect(await labelReadiness(BigInt(1))).toEqual({ ok: false, outcome: "unbound" });
  });

  it("配额用尽 → quota_exhausted", async () => {
    countTodayRoleUsage.mockResolvedValue(300);
    expect(await labelReadiness(BigInt(1))).toEqual({ ok: false, outcome: "quota_exhausted" });
  });

  it("簇无成员 → not_found;成员不足门槛 → too_small", async () => {
    memberCount.mockResolvedValue(0);
    expect(await labelReadiness(BigInt(1))).toEqual({ ok: false, outcome: "not_found" });
    memberCount.mockResolvedValue(2);
    expect(await labelReadiness(BigInt(1))).toEqual({ ok: false, outcome: "too_small" });
  });

  it("就绪 → 带模型与成员数;labelClusterNow 打标成功回 labeled", async () => {
    const ready = await labelReadiness(BigInt(9));
    expect(ready.ok).toBe(true);
    if (ready.ok) {
      expect(ready.memberCount).toBe(5);
      expect(ready.model).toBe(MODEL);
    }
    expect(await labelClusterNow(BigInt(9))).toBe("labeled");
    expect(clusterUpdate).toHaveBeenCalledTimes(1);
  });

  it("单簇路径不吞 LLM 失败:抛给 job 层记 failed(批内路径才自吞)", async () => {
    chatJsonTask.mockRejectedValue(new Error("契约不合法"));
    await expect(labelClusterNow(BigInt(9))).rejects.toThrow("契约不合法");
  });
});
