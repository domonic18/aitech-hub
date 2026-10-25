/** topic 仓储单测(prisma mock;M47 批C 补盲):create 缺省回填/deleteMany
 * 计数 404/update patch 三态映射(undefined 不动/null 置空/数值转 BigInt)/
 * 状态机幂等同态与非法流转拦截/列表分页钳制与 where 组装/关联文档详情
 * channels[0] 兜底/贴图计数软引用映射。 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const topicCreate = vi.fn();
const topicDeleteMany = vi.fn();
const topicFindUnique = vi.fn();
const topicUpdate = vi.fn();
const topicFindMany = vi.fn();
const topicCount = vi.fn();
const topicGroupBy = vi.fn();
const postFindUnique = vi.fn();
const pinGroupBy = vi.fn();
const tx = vi.fn();

vi.mock("@/lib/db", () => ({
  prisma: {
    topic: {
      create: (...a: unknown[]) => topicCreate(...a),
      deleteMany: (...a: unknown[]) => topicDeleteMany(...a),
      findUnique: (...a: unknown[]) => topicFindUnique(...a),
      update: (...a: unknown[]) => topicUpdate(...a),
      findMany: (...a: unknown[]) => topicFindMany(...a),
      count: (...a: unknown[]) => topicCount(...a),
      groupBy: (...a: unknown[]) => topicGroupBy(...a),
    },
    post: { findUnique: (...a: unknown[]) => postFindUnique(...a) },
    contentPin: { groupBy: (...a: unknown[]) => pinGroupBy(...a) },
    $transaction: (ops: unknown[]) => tx(ops),
  },
}));

import {
  createTopic,
  countByStatus,
  deleteTopic,
  getLinkedDocDetail,
  getTopic,
  getTopicStateSnapshot,
  listTopics,
  pinCountByTopic,
  updateTopic,
  updateTopicStatus,
} from "./repo";
import { TopicError } from "./errors";

const ROW = {
  id: BigInt(7),
  title: "MCP 专题",
  positioning: null,
  outputType: "article",
  skillKey: null,
  status: "collecting",
  updatedAt: new Date("2026-10-24T00:00:00Z"),
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("createTopic", () => {
  it("缺省回填:positioning null/outputType article/skillKey null", async () => {
    topicCreate.mockResolvedValue(ROW);
    await createTopic({ title: "MCP 专题" } as never);
    expect(topicCreate.mock.calls[0]![0]).toEqual({
      data: { title: "MCP 专题", positioning: null, outputType: "article", skillKey: null },
    });
  });

  it("显式意图与 skillKey 透传", async () => {
    topicCreate.mockResolvedValue(ROW);
    await createTopic({
      title: "贴图",
      positioning: "定位",
      outputType: "pin",
      skillKey: "blogger-video",
    } as never);
    expect(topicCreate.mock.calls[0]![0]).toEqual({
      data: {
        title: "贴图",
        positioning: "定位",
        outputType: "pin",
        skillKey: "blogger-video",
      },
    });
  });
});

describe("deleteTopic", () => {
  it("计数 0 → not_found", async () => {
    topicDeleteMany.mockResolvedValue({ count: 0 });
    await expect(deleteTopic(BigInt(1))).rejects.toMatchObject({
      code: "not_found",
      message: "专题不存在",
    });
  });

  it("计数 ≥1 → 静默成功", async () => {
    topicDeleteMany.mockResolvedValue({ count: 1 });
    await expect(deleteTopic(BigInt(1))).resolves.toBeUndefined();
  });
});

describe("updateTopic", () => {
  it("行缺 → not_found,不触 update", async () => {
    topicFindUnique.mockResolvedValue(null);
    await expect(updateTopic(BigInt(1), { title: "x" } as never)).rejects.toBeInstanceOf(
      TopicError,
    );
    expect(topicUpdate).not.toHaveBeenCalled();
  });

  it("patch 三态:undefined 不动 / null 置空 / 数值转 BigInt", async () => {
    topicFindUnique.mockResolvedValue(ROW);
    topicUpdate.mockResolvedValue(ROW);
    await updateTopic(BigInt(7), {
      title: "新题",
      positioning: null,
      pinPositioning: "贴图定位",
      outputType: "pin",
      skillKey: "weekly-news",
      linkedPostId: 318,
      sampleImageId: null,
    } as never);
    expect(topicUpdate.mock.calls[0]![0]).toEqual({
      where: { id: BigInt(7) },
      data: {
        title: "新题",
        positioning: null,
        pinPositioning: "贴图定位",
        outputType: "pin",
        skillKey: "weekly-news",
        linkedPostId: BigInt(318),
        sampleImageId: null,
      },
    });
  });

  it("linkedPostId 缺省 → undefined(Prisma 跳列,不误清)", async () => {
    topicFindUnique.mockResolvedValue(ROW);
    topicUpdate.mockResolvedValue(ROW);
    await updateTopic(BigInt(7), { title: "只改题" } as never);
    const data = (topicUpdate.mock.calls[0]![0] as { data: Record<string, unknown> }).data;
    expect(data.linkedPostId).toBeUndefined();
    expect(data.sampleImageId).toBeUndefined();
  });
});

describe("updateTopicStatus", () => {
  it("幂等同态:同状态直返,不触 update", async () => {
    topicFindUnique.mockResolvedValue({ ...ROW, status: "drafted" });
    const r = await updateTopicStatus(BigInt(7), "drafted");
    expect(r.status).toBe("drafted");
    expect(topicUpdate).not.toHaveBeenCalled();
  });

  it("非法流转(published→collecting)→ invalid_transition", async () => {
    topicFindUnique.mockResolvedValue({ ...ROW, status: "published" });
    await expect(updateTopicStatus(BigInt(7), "collecting")).rejects.toMatchObject({
      code: "invalid_transition",
      message: "状态不可流转:published → collecting",
    });
    expect(topicUpdate).not.toHaveBeenCalled();
  });

  it("合法流转(collecting→published 旁路)→ update 落新态", async () => {
    topicFindUnique.mockResolvedValue({ ...ROW, status: "collecting" });
    topicUpdate.mockResolvedValue({ ...ROW, status: "published" });
    const r = await updateTopicStatus(BigInt(7), "published");
    expect(topicUpdate).toHaveBeenCalledWith({
      where: { id: BigInt(7) },
      data: { status: "published" },
    });
    expect(r.status).toBe("published");
  });
});

describe("listTopics", () => {
  it("分页钳制:page<1→1,pageSize 上界收 50、下界收 1(0 非 nullish 不走缺省 20)", async () => {
    tx.mockResolvedValue([[], 0]);
    await listTopics({ page: 0, pageSize: 999 });
    expect(topicFindMany.mock.calls[0]![0]).toMatchObject({ skip: 0, take: 50 });
    await listTopics({ page: 3, pageSize: 0 });
    expect(topicFindMany.mock.calls[1]![0]).toMatchObject({ skip: 2, take: 1 }); // (3-1)*1
    await listTopics({ page: 2 });
    expect(topicFindMany.mock.calls[2]![0]).toMatchObject({ skip: 20, take: 20 }); // 缺省 20
  });

  it("where 组装:status/output/q(大小写不敏感 contains)齐全;缺省空 where", async () => {
    tx.mockResolvedValue([[], 0]);
    await listTopics({ status: "drafted", output: "pin", q: "mcp" });
    const findManyArgs = topicFindMany.mock.calls[0]![0] as {
      where: Record<string, unknown>;
    };
    expect(findManyArgs.where).toEqual({
      status: "drafted",
      outputType: "pin",
      title: { contains: "mcp", mode: "insensitive" },
    });
    // count 与 findMany 同 where 引用
    expect((topicCount.mock.calls[0]![0] as { where: unknown }).where).toBe(findManyArgs.where);
    await listTopics();
    expect(topicFindMany.mock.calls[1]![0]).toMatchObject({ where: {} });
  });

  it("返回 items 与 total 透传", async () => {
    tx.mockResolvedValue([[{ ...ROW, _count: { items: 3 } }], 9]);
    const r = await listTopics({});
    expect(r.items).toHaveLength(1);
    expect(r.total).toBe(9);
  });
});

describe("getTopic / getTopicStateSnapshot", () => {
  it("getTopic 行缺 → not_found", async () => {
    topicFindUnique.mockResolvedValue(null);
    await expect(getTopic(BigInt(1))).rejects.toMatchObject({ code: "not_found" });
  });

  it("快照裸 select:行缺返回 null(轮询侧清态),不抛", async () => {
    topicFindUnique.mockResolvedValue(null);
    expect(await getTopicStateSnapshot(BigInt(1))).toBeNull();
    topicFindUnique.mockResolvedValue({
      status: "drafted",
      updatedAt: new Date("2026-10-24T00:00:00Z"),
      linkedPostId: null,
    });
    const snap = await getTopicStateSnapshot(BigInt(7));
    expect(snap).toMatchObject({ status: "drafted", linkedPostId: null });
  });
});

describe("getLinkedDocDetail", () => {
  it("文档缺 → null 视为无锚", async () => {
    postFindUnique.mockResolvedValue(null);
    expect(await getLinkedDocDetail(BigInt(1))).toBeNull();
  });

  it("wechat 渠道行取首条;无渠道 → null", async () => {
    postFindUnique.mockResolvedValue({
      title: "稿子",
      status: "published",
      channels: [
        { status: "synced", syncedAt: new Date("2026-10-23T00:00:00Z"), lastError: null },
        { status: "failed", syncedAt: null, lastError: "boom" },
      ],
    });
    const d = await getLinkedDocDetail(BigInt(318));
    expect(d).toMatchObject({ title: "稿子", status: "published" });
    expect(d!.wechat).toMatchObject({ status: "synced" });
    postFindUnique.mockResolvedValue({ title: "稿子", status: "draft", channels: [] });
    expect((await getLinkedDocDetail(BigInt(318)))!.wechat).toBeNull();
  });
});

describe("countByStatus / pinCountByTopic", () => {
  it("分段计数映射 status 原值;带 output 叠加 where", async () => {
    topicGroupBy.mockResolvedValue([
      { status: "collecting", _count: { _all: 3 } },
      { status: "published", _count: { _all: 1 } },
    ]);
    expect(await countByStatus()).toEqual({ collecting: 3, published: 1 });
    await countByStatus("pin");
    expect(topicGroupBy).toHaveBeenLastCalledWith({
      by: ["status"],
      where: { outputType: "pin" },
      _count: { _all: true },
    });
    await countByStatus();
    expect(topicGroupBy).toHaveBeenLastCalledWith({ by: ["status"], _count: { _all: true } });
  });

  it("贴图计数:空集合零查询;null topicId 软引用行滤除", async () => {
    expect(await pinCountByTopic([])).toEqual(new Map());
    expect(pinGroupBy).not.toHaveBeenCalled();
    pinGroupBy.mockResolvedValue([
      { topicId: BigInt(7), _count: { _all: 4 } },
      { topicId: null, _count: { _all: 2 } },
    ]);
    const m = await pinCountByTopic([BigInt(7), BigInt(8)]);
    expect(m.get(BigInt(7))).toBe(4);
    expect(m.has(BigInt(8))).toBe(false);
  });
});
