/**
 * 分发记录服务单测(prisma mock):resetRecordBinding(M17 批⑤)
 * 三分支——记录不存在 404 / 无绑定拒清 / 有绑定置 null;
 * getDistributeOverview 渠道维度下推(M48 批D)。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../db", () => ({
  prisma: {
    publishChannel: {
      findUnique: vi.fn(),
      update: vi.fn(),
      count: vi.fn(),
      groupBy: vi.fn(),
      findFirst: vi.fn(),
      findMany: vi.fn(),
    },
    contentPinChannel: {
      count: vi.fn(),
      groupBy: vi.fn(),
      findFirst: vi.fn(),
      findMany: vi.fn(),
    },
  },
}));

import { prisma } from "../db";
import { DistributeError } from "./errors";
import {
  getDistributeOverview,
  listDistributeRecords,
  resetRecordBinding,
} from "./records";

const mockedFind = vi.mocked(prisma.publishChannel.findUnique);
const mockedUpdate = vi.mocked(prisma.publishChannel.update);
const mockedCount = vi.mocked(prisma.publishChannel.count);
const mockedGroupBy = vi.mocked(prisma.publishChannel.groupBy);
const mockedOverviewFind = vi.mocked(prisma.publishChannel.findFirst);
const mockedPinCount = vi.mocked(prisma.contentPinChannel.count);
const mockedPinGroupBy = vi.mocked(prisma.contentPinChannel.groupBy);
const mockedPinFind = vi.mocked(prisma.contentPinChannel.findFirst);
const mockedArtList = vi.mocked(prisma.publishChannel.findMany);
const mockedPinList = vi.mocked(prisma.contentPinChannel.findMany);

function row(mediaId: string | null): Record<string, unknown> {
  return { id: 7, postId: 101, channel: "wechat", status: "synced", mediaId };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("resetRecordBinding", () => {
  it("记录不存在 → not_found", async () => {
    mockedFind.mockResolvedValue(null as never);
    await expect(resetRecordBinding(BigInt(7))).rejects.toThrow(DistributeError);
    await expect(resetRecordBinding(BigInt(7))).rejects.toThrow("同步记录不存在");
    expect(mockedUpdate).not.toHaveBeenCalled();
  });

  it("无 media_id 绑定 → 拒清(invalid)", async () => {
    mockedFind.mockResolvedValue(row(null) as never);
    await expect(resetRecordBinding(BigInt(7))).rejects.toThrow("没有 media_id 绑定");
    expect(mockedUpdate).not.toHaveBeenCalled();
  });

  it("有绑定 → update 置 mediaId=null", async () => {
    mockedFind.mockResolvedValue(row("DRAFT_MEDIA_1") as never);
    mockedUpdate.mockResolvedValue(row(null) as never);
    await expect(resetRecordBinding(BigInt(7))).resolves.toBeUndefined();
    expect(mockedUpdate).toHaveBeenCalledWith({
      where: { id: BigInt(7) },
      data: { mediaId: null },
    });
  });
});

describe("getDistributeOverview 双载体 union(M50 批B)", () => {
  // Prisma count 参数取原生类型(mockImplementation 参数逆变,结构化窄类型不可作形参)
  type ArtCountArgs = Parameters<typeof prisma.publishChannel.count>[0];
  type PinCountArgs = Parameters<typeof prisma.contentPinChannel.count>[0];
  const statusOf = (a: { where?: { status?: unknown } } | undefined): unknown =>
    a?.where?.status;
  const hasSyncedAt = (a: { where?: { syncedAt?: unknown } } | undefined): boolean =>
    Boolean(a?.where?.syncedAt);
  function mockEmpty(): void {
    mockedCount.mockResolvedValue(0 as never);
    mockedGroupBy.mockResolvedValue([] as never);
    mockedOverviewFind.mockResolvedValue(null as never);
    mockedPinCount.mockResolvedValue(0 as never);
    mockedPinGroupBy.mockResolvedValue([] as never);
    mockedPinFind.mockResolvedValue(null as never);
  }

  it("传 channel → 两表各查询 where 下推渠道", async () => {
    mockEmpty();
    await getDistributeOverview("wechat");
    expect(mockedCount).toHaveBeenCalledTimes(3);
    for (const call of mockedCount.mock.calls) {
      expect(call[0]?.where).toMatchObject({ channel: "wechat" });
    }
    for (const call of mockedPinCount.mock.calls) {
      expect(call[0]?.where).toMatchObject({ channel: "wechat" });
    }
    expect(mockedGroupBy.mock.calls[0][0]?.where).toMatchObject({ channel: "wechat" });
    expect(mockedPinGroupBy.mock.calls[0][0]?.where).toMatchObject({ channel: "wechat" });
    expect(mockedOverviewFind.mock.calls[0][0]?.where).toMatchObject({ channel: "wechat" });
  });

  it("缺省不过滤(双表全渠道)", async () => {
    mockEmpty();
    await getDistributeOverview();
    for (const call of mockedCount.mock.calls) {
      expect(call[0]?.where).not.toHaveProperty("channel");
    }
    for (const call of mockedPinCount.mock.calls) {
      expect(call[0]?.where).not.toHaveProperty("channel");
    }
    expect(mockedOverviewFind.mock.calls[0][0]?.where).not.toHaveProperty("channel");
  });

  it("计数两表相加;rate7d 合并分母;lastRecord 取较新", async () => {
    // 文章侧:total=3/failed=1,today=2,7d synced=4/failed=1,last=10:00
    mockedCount.mockImplementation((args: ArtCountArgs) => {
      const st = statusOf(args);
      if (st === "synced" && hasSyncedAt(args)) return Promise.resolve(2) as never;
      if (st === "synced") return Promise.resolve(3) as never;
      if (st === "failed") return Promise.resolve(1) as never;
      return Promise.resolve(0) as never;
    });
    mockedGroupBy.mockResolvedValue([
      { status: "synced", _count: { _all: 4 } },
      { status: "failed", _count: { _all: 1 } },
    ] as never);
    mockedOverviewFind.mockResolvedValue({
      status: "synced",
      syncedAt: null,
      updatedAt: new Date("2026-10-27T10:00:00+08:00"),
    } as never);
    // 贴图侧:total=5/failed=0,today=1,7d synced=6/failed=0,last=11:00(较新)
    mockedPinCount.mockImplementation((args: PinCountArgs) => {
      const st = statusOf(args);
      if (st === "synced" && hasSyncedAt(args)) return Promise.resolve(1) as never;
      if (st === "synced") return Promise.resolve(5) as never;
      if (st === "failed") return Promise.resolve(0) as never;
      return Promise.resolve(0) as never;
    });
    mockedPinGroupBy.mockResolvedValue([
      { status: "synced", _count: { _all: 6 } },
    ] as never);
    mockedPinFind.mockResolvedValue({
      status: "synced",
      syncedAt: new Date("2026-10-27T11:00:00+08:00"),
      updatedAt: new Date("2026-10-27T11:00:00+08:00"),
    } as never);

    const ov = await getDistributeOverview();
    expect(ov.todaySynced).toBe(3);
    expect(ov.totalSynced).toBe(8);
    expect(ov.failedCount).toBe(1);
    expect(ov.rate7d).toBeCloseTo(10 / 11);
    expect(ov.lastRecord?.updatedAt).toEqual(new Date("2026-10-27T11:00:00+08:00"));
  });
});

describe("listDistributeRecords 跨载体 union(M50 批B)", () => {
  const t = (h: number): Date => new Date(`2026-10-27T0${h}:00:00+08:00`);

  function artRow(id: number, updatedAt: Date): Record<string, unknown> {
    return {
      id: BigInt(id), postId: BigInt(100 + id), channel: "wechat", status: "synced",
      mediaId: "M1", title: "T", digest: null, thumbPath: null, attempts: 1,
      lastError: null, syncedAt: null, updatedAt,
      post: { title: `文章${id}` },
    };
  }

  function pinRow(id: number, updatedAt: Date): Record<string, unknown> {
    return {
      id: BigInt(id), pinId: BigInt(200 + id), channel: "xiaohongshu", status: "failed",
      mediaId: null, publishId: null, attempts: 3, lastError: "发布失败",
      syncedAt: null, updatedAt,
      pin: { title: `贴图${id}` },
    };
  }

  it("两表归并按 updatedAt 倒序截断 pageSize;行带载体归因", async () => {
    mockedArtList.mockResolvedValue([artRow(1, t(1)), artRow(2, t(3))] as never);
    mockedPinList.mockResolvedValue([pinRow(9, t(2))] as never);
    mockedCount.mockResolvedValue(2 as never);
    mockedPinCount.mockResolvedValue(1 as never);

    const res = await listDistributeRecords({ pageSize: 2 });
    // t(3)文章 > t(2)贴图 > t(1)文章,截断到 2 条
    expect(res.rows.map((r) => [r.carrier, r.targetTitle])).toEqual([
      ["article", "文章2"],
      ["pin", "贴图9"],
    ]);
    expect(res.rows[1]).toMatchObject({
      carrier: "pin", targetId: "209", channel: "xiaohongshu",
      status: "failed", lastError: "发布失败", mediaId: null,
    });
    expect(res.total).toBe(3);
  });

  it("channel 筛选双表下推(wechat 也查贴图行——贴图亦有公众号同步)", async () => {
    mockedArtList.mockResolvedValue([] as never);
    mockedPinList.mockResolvedValue([] as never);
    mockedCount.mockResolvedValue(0 as never);
    mockedPinCount.mockResolvedValue(0 as never);
    await listDistributeRecords({ channel: "wechat" });
    expect(mockedArtList.mock.calls[0][0]?.where).toMatchObject({ channel: "wechat" });
    expect(mockedPinList.mock.calls[0][0]?.where).toMatchObject({ channel: "wechat" });
  });
});
