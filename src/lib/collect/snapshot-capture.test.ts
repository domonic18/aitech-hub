/**
 * 采集快照捕获单测(2026-10-29 P0 回溯档案):落档顺序(先对象后行)、
 * 截图同生命周期、保留窗口裁剪(对象与行一并清)、结论回写、存储故障不拖垮取数。
 * 存储层注入内存假件(不触 COS / 不写 workspace),prisma 走 mock。
 */
import { gunzipSync } from "node:zlib";

import { beforeEach, describe, expect, it, vi } from "vitest";

const snapCreate = vi.fn();
const snapFindMany = vi.fn();
const snapUpdateMany = vi.fn();
const snapDelete = vi.fn();

vi.mock("@/lib/db", () => ({
  prisma: {
    crawlSnapshot: {
      create: (...a: unknown[]) => snapCreate(...a),
      findMany: (...a: unknown[]) => snapFindMany(...a),
      updateMany: (...a: unknown[]) => snapUpdateMany(...a),
      delete: (...a: unknown[]) => snapDelete(...a),
    },
  },
}));

import { SNAPSHOT_KEEP_PER_SOURCE } from "./constants";
import { SourceCapture, snapshotPngKey } from "./snapshot-capture";
import type { SnapshotStore } from "./snapshot-store";

function memStore(over: Partial<SnapshotStore> = {}): SnapshotStore & {
  puts: Array<{ key: string; data: Uint8Array; contentType: string }>;
  deletes: string[];
} {
  const puts: Array<{ key: string; data: Uint8Array; contentType: string }> = [];
  const deletes: string[] = [];
  return {
    puts,
    deletes,
    put: async (key, data, contentType) => {
      puts.push({ key, data, contentType });
    },
    get: async () => null,
    delete: async (key) => {
      deletes.push(key);
    },
    ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  snapCreate.mockResolvedValue({ id: BigInt(1) });
  snapFindMany.mockResolvedValue([]);
  snapUpdateMany.mockResolvedValue({ count: 1 });
  snapDelete.mockResolvedValue({});
});

describe("capture", () => {
  it("gzip 原文写桶 + 建行(sha1/大小/pending),截图同前缀 .png", async () => {
    const store = memStore();
    const cap = new SourceCapture(7, "https://x.test/p", store);
    snapCreate.mockResolvedValueOnce({ id: BigInt(11) });
    await cap.capture({
      tab: "yearly",
      html: "<html>hi</html>",
      httpStatus: 200,
      png: Buffer.from("p"),
    });

    const htmlPut = store.puts[0]!;
    expect(htmlPut.key).toMatch(/^crawl-snapshots\/7\/\d{8}T\d{6}Z-yearly\.html\.gz$/);
    expect(htmlPut.contentType).toBe("application/gzip");
    expect(gunzipSync(htmlPut.data).toString("utf8")).toBe("<html>hi</html>");
    expect(store.puts[1]!.key).toBe(snapshotPngKey(htmlPut.key));
    expect(store.puts[1]!.contentType).toBe("image/png");

    const { data } = snapCreate.mock.calls[0]![0] as {
      data: Record<string, unknown>;
    };
    expect(data).toMatchObject({
      sourceId: 7,
      url: "https://x.test/p",
      tab: "yearly",
      httpStatus: 200,
      sizeBytes: Buffer.byteLength("<html>hi</html>"),
      hasPng: true,
    });
    expect(data.sha1).toMatch(/^[0-9a-f]{40}$/);
  });

  it("无截图:不写 png 对象,hasPng=false", async () => {
    const store = memStore();
    await new SourceCapture(7, "u", store).capture({ tab: "page", html: "x" });
    expect(store.puts).toHaveLength(1);
    expect((snapCreate.mock.calls[0]![0] as { data: { hasPng: boolean } }).data.hasPng).toBe(false);
  });

  it("超保留窗口:旧对象(含 png)与行一并清理", async () => {
    const store = memStore();
    snapFindMany.mockResolvedValueOnce([
      { id: BigInt(99), storageKey: "k/old.html.gz", hasPng: true },
      { id: BigInt(98), storageKey: "k/older.html.gz", hasPng: false },
    ]);
    await new SourceCapture(7, "u", store).capture({ tab: "page", html: "x" });

    const findArgs = snapFindMany.mock.calls[0]![0] as { skip: number };
    expect(findArgs.skip).toBe(SNAPSHOT_KEEP_PER_SOURCE); // 保留最近 N 份
    expect(store.deletes).toEqual(["k/old.html.gz", "k/old.png", "k/older.html.gz"]);
    expect(snapDelete).toHaveBeenCalledTimes(2);
  });

  it("存储故障:不抛错不建行(档案可缺,牌价不可断),留结构化事件", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const store = memStore({
      put: async () => {
        throw new Error("cos down");
      },
    });
    await expect(
      new SourceCapture(7, "u", store).capture({ tab: "page", html: "x" }),
    ).resolves.toBeUndefined();
    expect(snapCreate).not.toHaveBeenCalled();
    expect(String(err.mock.calls[0]![0])).toContain("crawl.snapshot.capture_failed");
    err.mockRestore();
  });
});

describe("finish", () => {
  it("回写本次全部快照的结论(错误截断 4000)", async () => {
    const cap = new SourceCapture(7, "u", memStore());
    snapCreate.mockResolvedValueOnce({ id: BigInt(1) }).mockResolvedValueOnce({ id: BigInt(2) });
    await cap.capture({ tab: "monthly", html: "a" });
    await cap.capture({ tab: "yearly", html: "b" });
    await cap.finish("failed", null, "x".repeat(5000));

    const { where, data } = snapUpdateMany.mock.calls[0]![0] as {
      where: { id: { in: bigint[] } };
      data: { parseStatus: string; rowCount: number | null; error: string };
    };
    expect(where.id.in).toEqual([BigInt(1), BigInt(2)]);
    expect(data.parseStatus).toBe("failed");
    expect(data.error).toHaveLength(4000);
  });

  it("本次未落档(存储故障)时 no-op", async () => {
    await new SourceCapture(7, "u", memStore()).finish("success", 3);
    expect(snapUpdateMany).not.toHaveBeenCalled();
  });
});
