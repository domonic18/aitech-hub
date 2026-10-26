/**
 * uploadMedia 单测(批⑦ 验收反馈「封面传参错误/重复」根治面):prisma/queue/
 * storage 全打桩——魔数嗅探裁决(传参 mime 不再参与)、sha1 去重复用、error 行
 * 重投自愈、回收站软删复活、并发竞态 create 判负复用赢家 + 落盘即焚。
 * 集成面(真库唯一约束/盘文件)见 media.integration.test.ts。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const prismaMock = vi.hoisted(() => ({
  media: {
    findFirst: vi.fn<(args?: unknown) => Promise<unknown>>(),
    create: vi.fn<(args?: unknown) => Promise<unknown>>(),
    update: vi.fn<(args?: unknown) => Promise<unknown>>(async () => ({})),
  },
}));
vi.mock("@/lib/db", () => ({ prisma: prismaMock }));

const queueMock = vi.hoisted(() => ({
  getJob: vi.fn<() => Promise<unknown>>(async () => null),
  add: vi.fn<(...args: unknown[]) => Promise<unknown>>(async () => undefined),
}));
vi.mock("@/lib/queue", () => ({ QUEUE_MEDIA_PROCESS: "media", getQueue: () => queueMock }));

const storageMock = vi.hoisted(() => ({
  put: vi.fn<(...args: unknown[]) => Promise<void>>(async () => undefined),
  delete: vi.fn<(...args: unknown[]) => Promise<void>>(async () => undefined),
}));
vi.mock("@/lib/media/storage", () => ({
  mediaStorage: storageMock,
  mediaStorageKind: "local",
  relToUploadsUrl: (rel: string) => `/wp-content/uploads/${rel}`,
  uploadsUrlToRel: (url: string) => url.replace(/^\/wp-content\/uploads\//, ""),
}));

vi.mock("@/lib/media/queries", () => ({
  loadReferencedPathSet: vi.fn(async () => new Set<string>()),
}));

import { MediaError, uploadMedia } from "@/lib/media/service";

const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4]);
const CREATED = { id: BigInt(777), path: "/wp-content/uploads/2026/10/abc.jpg" };

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.media.findFirst.mockResolvedValue(null);
  prismaMock.media.create.mockResolvedValue(CREATED);
  prismaMock.media.update.mockResolvedValue({});
});

describe("uploadMedia(批⑦ 嗅探裁决 + 竞态去重)", () => {
  it("垃圾字节拒收(声明 mime 白名单也不放行),不触盘不触库", async () => {
    await expect(
      uploadMedia({ data: new Uint8Array([1, 2, 3]), mime: "image/jpeg", filename: "a.jpg" }),
    ).rejects.toMatchObject({ code: "unsupported" } satisfies Partial<MediaError>);
    expect(storageMock.put).not.toHaveBeenCalled();
    expect(prismaMock.media.create).not.toHaveBeenCalled();
  });

  it("传参 mime 错误(image/jpg)由字节嗅探纠正:ext 按内容归一 jpg,正常入库", async () => {
    const saved = await uploadMedia({
      data: JPEG,
      mime: "image/jpg", // 白名单外传参,旧逻辑 415
      filename: "cover.jpg",
    });
    expect(saved).toMatchObject({ id: "777", reused: false, status: "processing" });
    expect(prismaMock.media.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ kind: "image", sha1: expect.any(String) }),
    });
    const path = (prismaMock.media.create.mock.calls[0][0] as { data: { path: string } }).data.path;
    expect(path).toMatch(/\.jpg$/);
  });

  it("同 sha1 未软删 → 复用(reused),不落盘不建行不投递", async () => {
    prismaMock.media.findFirst.mockResolvedValue({
      id: BigInt(5),
      path: "/wp-content/uploads/2026/09/x.jpg",
      status: "active",
      deletedAt: null,
    });
    const saved = await uploadMedia({ data: JPEG, mime: "image/jpeg", filename: "a.jpg" });
    expect(saved).toEqual({
      id: "5",
      path: "/wp-content/uploads/2026/09/x.jpg",
      reused: true,
      status: "active",
    });
    expect(storageMock.put).not.toHaveBeenCalled();
    expect(queueMock.add).not.toHaveBeenCalled();
  });

  it("同 sha1 行 sharp 终败(status=error)→ 重投管线自愈,返回 processing", async () => {
    prismaMock.media.findFirst.mockResolvedValue({
      id: BigInt(9),
      path: "/wp-content/uploads/2026/09/e.jpg",
      status: "error",
      deletedAt: null,
    });
    const saved = await uploadMedia({ data: JPEG, mime: "image/jpeg", filename: "a.jpg" });
    expect(saved).toMatchObject({ id: "9", reused: true, status: "processing" });
    expect(queueMock.add).toHaveBeenCalledWith(
      "process",
      { mediaId: "9" },
      expect.objectContaining({ jobId: expect.any(String) }),
    );
  });

  it("在途 job(waiting)不重复投递;终态残留先 remove 再 add(确定性 jobId 陷阱)", async () => {
    const staleDone = {
      getState: vi.fn(async () => "completed"),
      remove: vi.fn(async () => undefined),
    };
    queueMock.getJob.mockResolvedValueOnce(staleDone);
    await uploadMedia({ data: JPEG, mime: "image/jpeg", filename: "a.jpg" });
    expect(staleDone.remove).toHaveBeenCalledTimes(1);
    expect(queueMock.add).toHaveBeenCalledTimes(1);

    const staleRunning = {
      getState: vi.fn(async () => "waiting"),
      remove: vi.fn(async () => undefined),
    };
    queueMock.getJob.mockResolvedValueOnce(staleRunning);
    queueMock.add.mockClear();
    prismaMock.media.findFirst.mockResolvedValue({
      id: BigInt(9),
      path: "/wp-content/uploads/2026/09/e.jpg",
      status: "error",
      deletedAt: null,
    });
    await uploadMedia({ data: JPEG, mime: "image/jpeg", filename: "a.jpg" });
    expect(staleRunning.remove).not.toHaveBeenCalled();
    expect(queueMock.add).not.toHaveBeenCalled();
  });

  it("命中回收站软删行 → 复活原行重走管线", async () => {
    prismaMock.media.findFirst.mockResolvedValue({
      id: BigInt(11),
      path: "/wp-content/uploads/2026/08/t.jpg",
      status: "deleted",
      deletedAt: new Date(),
    });
    const saved = await uploadMedia({ data: JPEG, mime: "image/jpeg", filename: "a.jpg" });
    expect(saved).toMatchObject({ id: "11", reused: true, status: "processing" });
    expect(prismaMock.media.update).toHaveBeenCalledWith({
      where: { id: BigInt(11) },
      data: { deletedAt: null, status: "processing" },
    });
    expect(queueMock.add).toHaveBeenCalled();
  });

  it("并发竞态 create 撞唯一约束(P2002)→ 复用赢家行,本批落盘即焚", async () => {
    prismaMock.media.findFirst
      .mockResolvedValueOnce(null) // 首查落空
      .mockResolvedValueOnce({
        // 判负后复查命中赢家
        id: BigInt(3),
        path: "/wp-content/uploads/2026/10/win.jpg",
        status: "processing",
        deletedAt: null,
      });
    prismaMock.media.create.mockRejectedValue(
      Object.assign(new Error("Unique constraint failed"), { code: "P2002" }),
    );
    const saved = await uploadMedia({ data: JPEG, mime: "image/jpeg", filename: "a.jpg" });
    expect(saved).toEqual({
      id: "3",
      path: "/wp-content/uploads/2026/10/win.jpg",
      reused: true,
      status: "processing",
    });
    expect(storageMock.delete).toHaveBeenCalledTimes(1); // 无行孤儿即焚
    expect(storageMock.put).toHaveBeenCalledTimes(1);
  });

  it("create 非竞态错误 → 落盘即焚后原样上抛", async () => {
    prismaMock.media.create.mockRejectedValue(new Error("db down"));
    await expect(
      uploadMedia({ data: JPEG, mime: "image/jpeg", filename: "a.jpg" }),
    ).rejects.toThrow("db down");
    expect(storageMock.delete).toHaveBeenCalledTimes(1);
  });
});
