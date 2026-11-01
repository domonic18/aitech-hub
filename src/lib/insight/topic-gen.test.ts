/**
 * 洞察簇 → 创作选题一键转化单测(M46 验收批,全 mock):簇缺行 not_found、
 * 建题字段(label/概括/关联词;未打标退首关键词)、telegram-ai 候选过滤
 * (非电报源/非法 refId 不挂)与封顶 5 条、单条不合格自吞跳过、重复挂载
 * (created:false)不计新挂数。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../db", () => ({
  prisma: {
    insightCluster: { findUnique: vi.fn() },
    // 幂等守卫(M52 验收):同题去重查询,默认无既有题
    topic: { findFirst: vi.fn().mockResolvedValue(null) },
  },
}));
vi.mock("../logger", () => ({ logger: { info: vi.fn(), warn: vi.fn() } }));

const createTopic = vi.hoisted(() => vi.fn());
vi.mock("../topics/repo", () => ({ createTopic }));

const mountMaterial = vi.hoisted(() => vi.fn());
vi.mock("../topics/materials", () => ({ mountMaterial }));

import { prisma } from "../db";
import { TopicError } from "../topics/errors";
import { createTopicFromCluster } from "./topic-gen";

const findCluster = vi.mocked(prisma.insightCluster.findUnique);

function cluster(over: Record<string, unknown> = {}) {
  return {
    id: BigInt(5),
    label: "端侧推理落地",
    summary: "开发者关心小模型在手机上的推理成本",
    keywords: ["端侧推理", "小模型"],
    members: [],
    ...over,
  } as never;
}

function member(refId: string, source = "telegram-ai") {
  return { signal: { source, refId } };
}

beforeEach(() => {
  vi.clearAllMocks();
  createTopic.mockResolvedValue({ id: BigInt(12), title: "x" });
  mountMaterial.mockResolvedValue({ created: true, item: {} });
});

describe("createTopicFromCluster(洞察簇一键转选题)", () => {
  it("簇不存在 → not_found,不建题", async () => {
    findCluster.mockResolvedValue(null);
    await expect(createTopicFromCluster(BigInt(5))).rejects.toMatchObject({
      code: "not_found",
    });
    expect(createTopic).not.toHaveBeenCalled();
  });

  it("建题取 label/概括/关联词;只挂 telegram-ai 且 refId 合法的候选", async () => {
    findCluster.mockResolvedValue(
      cluster({
        members: [
          member("11"),
          member("12"),
          member("9", "rss-tech"),
          member("abc"), // refId 非数字,过滤
        ],
      }),
    );
    const r = await createTopicFromCluster(BigInt(5));
    expect(createTopic).toHaveBeenCalledWith({
      title: "端侧推理落地",
      positioning: "开发者关心小模型在手机上的推理成本\n关联词:端侧推理、小模型",
    });
    expect(mountMaterial).toHaveBeenCalledTimes(2);
    expect(mountMaterial).toHaveBeenNthCalledWith(1, BigInt(12), "telegram", BigInt(11));
    expect(r).toMatchObject({ topicId: BigInt(12), mounted: 2, scanned: 2 });
  });

  it("候选封顶 5 条(权重降序由查询侧保证);scanned 含被截断的", async () => {
    const members = Array.from({ length: 7 }, (_, i) => member(String(i + 1)));
    findCluster.mockResolvedValue(cluster({ members }));
    const r = await createTopicFromCluster(BigInt(5));
    expect(mountMaterial).toHaveBeenCalledTimes(5);
    expect(r.scanned).toBe(7);
    expect(r.mounted).toBe(5);
  });

  it("单条不合格自吞跳过,建题成果不回滚", async () => {
    findCluster.mockResolvedValue(cluster({ members: [member("11"), member("12")] }));
    mountMaterial.mockRejectedValueOnce(
      new TopicError("invalid_material", "该视频尚未解读完成,暂不可挂"),
    );
    const r = await createTopicFromCluster(BigInt(5));
    expect(mountMaterial).toHaveBeenCalledTimes(2);
    expect(r.mounted).toBe(1);
  });

  it("未打标簇退首关键词建题;全空落默认题", async () => {
    findCluster.mockResolvedValue(cluster({ label: null }));
    await createTopicFromCluster(BigInt(5));
    expect(createTopic).toHaveBeenCalledWith(expect.objectContaining({ title: "端侧推理" }));
    findCluster.mockResolvedValue(cluster({ label: null, keywords: ["蒸馏"], summary: null }));
    await createTopicFromCluster(BigInt(5));
    expect(createTopic).toHaveBeenLastCalledWith(
      expect.objectContaining({ title: "蒸馏", positioning: "关联词:蒸馏" }),
    );
    findCluster.mockResolvedValue(cluster({ label: null, keywords: [], summary: null }));
    await createTopicFromCluster(BigInt(5));
    expect(createTopic).toHaveBeenLastCalledWith({ title: "洞察选题", positioning: undefined });
  });

  it("已挂过(created:false)不计新挂数", async () => {
    findCluster.mockResolvedValue(cluster({ members: [member("11")] }));
    mountMaterial.mockResolvedValueOnce({ created: false, item: {} });
    const r = await createTopicFromCluster(BigInt(5));
    expect(r.mounted).toBe(0);
    expect(r.scanned).toBe(1);
  });
});
