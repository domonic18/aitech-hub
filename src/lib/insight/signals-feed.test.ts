/**
 * 信号增量流单测(M72):keyset 游标语义——游标往返、增量起点、翻页不重不漏、
 * limit 钳制、非法游标拒。
 * prisma mock,无真库。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const signalFindMany = vi.fn();

vi.mock("@/lib/db", () => ({
  // 懒包装:工厂随被 mock 模块首查执行,急切引用会 TDZ
  prisma: {
    insightSignal: {
      findMany: (...a: unknown[]) => signalFindMany(...a),
    },
  },
}));

import { SIGNAL_TAKE_MAX } from "./constants";
import { listInsightSignalsSince } from "./signals-feed";

/** 造一行信号(字段与 SIGNAL_SELECT 对齐) */
function signalRow(id: string, signalAt: string) {
  return {
    id: BigInt(id),
    source: "telegram-ai",
    medium: "money",
    lang: "zh",
    region: "cn",
    rawText: "原文",
    translatedText: null,
    translationStatus: "none",
    signalAt: new Date(signalAt),
    meta: null,
  };
}

/** 解回游标里的 (signal_at, id) */
function decodeCursor(cursor: string): { at: string; id: string } {
  const raw = Buffer.from(cursor, "base64url").toString("utf8");
  const sep = raw.lastIndexOf("|");
  return { at: raw.slice(0, sep), id: raw.slice(sep + 1) };
}

beforeEach(() => {
  vi.clearAllMocks();
  signalFindMany.mockResolvedValue([]);
});

describe("信号增量流(keyset 游标)", () => {
  it("since 映射为 signal_at 下界", async () => {
    await listInsightSignalsSince({ since: new Date("2026-11-01T00:00:00.000Z") });
    const args = signalFindMany.mock.calls[0][0] as {
      where: { AND: Array<Record<string, unknown>> };
    };
    const flat = JSON.stringify(args.where);
    expect(flat).toContain("2026-11-01T00:00:00.000Z");
  });

  it("排序按 signal_at DESC + id DESC(同刻信号全序,翻页不重不漏)", async () => {
    await listInsightSignalsSince({});
    const args = signalFindMany.mock.calls[0][0] as { orderBy: unknown };
    expect(args.orderBy).toEqual([{ signalAt: "desc" }, { id: "desc" }]);
  });

  it("多取一条判是否还有下一页", async () => {
    signalFindMany.mockResolvedValue([signalRow("1", "2026-11-13T10:00:00.000Z")]);
    await listInsightSignalsSince({ limit: 10 });
    const args = signalFindMany.mock.calls[0][0] as { take: number };
    expect(args.take).toBe(11);
  });

  it("有更多行时给续页游标,且游标指向本页末行", async () => {
    signalFindMany.mockResolvedValue([
      signalRow("2", "2026-11-13T11:00:00.000Z"),
      signalRow("1", "2026-11-13T10:00:00.000Z"),
      signalRow("0", "2026-11-13T09:00:00.000Z"),
    ]);
    const page = await listInsightSignalsSince({ limit: 2 });
    expect(page.items).toHaveLength(2);
    expect(page.nextCursor).not.toBeNull();
    expect(decodeCursor(page.nextCursor as string)).toEqual({
      at: "2026-11-13T10:00:00.000Z",
      id: "1",
    });
  });

  it("没有更多行时游标为 null", async () => {
    signalFindMany.mockResolvedValue([signalRow("1", "2026-11-13T10:00:00.000Z")]);
    const page = await listInsightSignalsSince({ limit: 10 });
    expect(page.nextCursor).toBeNull();
  });

  it("传游标时 where 含 keyset 谓词(严格早于游标)", async () => {
    const cursor = Buffer.from("2026-11-13T11:00:00.000Z|2", "utf8").toString("base64url");
    await listInsightSignalsSince({ cursor });
    const args = signalFindMany.mock.calls[0][0] as {
      where: { AND: Array<Record<string, unknown>> };
    };
    const keyset = args.where.AND.find((c) => "OR" in c) as {
      OR: Array<{ signalAt?: { lt?: Date }; id?: { lt?: bigint } }>;
    };
    expect(keyset).toBeDefined();
    expect(keyset.OR).toHaveLength(2);
    // 严格早于游标时刻;同刻则按 id 兜底
    expect(keyset.OR[0].signalAt?.lt?.toISOString()).toBe("2026-11-13T11:00:00.000Z");
    expect(keyset.OR[1].id?.lt).toBe(BigInt(2));
  });

  it("limit 钳制在上限内", async () => {
    await listInsightSignalsSince({ limit: 9999 });
    const args = signalFindMany.mock.calls[0][0] as { take: number };
    expect(args.take).toBe(SIGNAL_TAKE_MAX + 1);
  });

  it("非法游标直接拒(不静默当首页)", async () => {
    await expect(listInsightSignalsSince({ cursor: "not-a-cursor" })).rejects.toThrow("游标不合法");
  });
});
