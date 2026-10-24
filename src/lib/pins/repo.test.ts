/**
 * 贴图仓储单测(prisma 全 mock):状态机流转合法性/同态幂等/publishedAt 首
 * 布锚定、edit_locked 三口(元数据/加图/删图)、序列上限 20 与工坊版本快照
 * 挂载、重排清单归属校验、移除非归属图拒。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../db", () => ({
  prisma: {
    contentPin: {
      create: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
      findMany: vi.fn(),
      count: vi.fn(),
      groupBy: vi.fn(),
      deleteMany: vi.fn(),
    },
    contentPinImage: {
      count: vi.fn(),
      create: vi.fn(),
      createMany: vi.fn(),
      findMany: vi.fn(),
      update: vi.fn(),
      deleteMany: vi.fn(),
    },
    illustrationVersion: { findMany: vi.fn() },
    topic: { findMany: vi.fn() },
    $transaction: vi.fn(async (ops: unknown[]) => ops),
  },
}));

import { prisma } from "../db";
import { PIN_IMAGES_MAX, PIN_MANUAL_TARGETS, type PinStatus } from "./constants";
import {
  addPinImages,
  createPin,
  removePinImage,
  reorderPinImages,
  setPinStatus,
  updatePin,
} from "./repo";

const mocked = {
  findPin: vi.mocked(prisma.contentPin.findUnique),
  updatePinMock: vi.mocked(prisma.contentPin.update),
  createPinMock: vi.mocked(prisma.contentPin.create),
  imgCount: vi.mocked(prisma.contentPinImage.count),
  imgCreate: vi.mocked(prisma.contentPinImage.create),
  imgCreateMany: vi.mocked(prisma.contentPinImage.createMany),
  imgFindMany: vi.mocked(prisma.contentPinImage.findMany),
  imgDeleteMany: vi.mocked(prisma.contentPinImage.deleteMany),
  verFindMany: vi.mocked(prisma.illustrationVersion.findMany),
  tx: vi.mocked(prisma.$transaction),
};

function pin(over: Record<string, unknown> = {}) {
  return {
    id: BigInt(1),
    title: "标题",
    content: "",
    topicId: null,
    status: "draft",
    readMoreUrl: null,
    cropSpec: "1_1",
    syncedAt: null,
    publishedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...over,
  } as never;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocked.updatePinMock.mockResolvedValue(pin());
  mocked.createPinMock.mockResolvedValue(pin());
});

describe("setPinStatus 状态机", () => {
  it("非法流转 draft→published 拒(invalid_transition)", async () => {
    mocked.findPin.mockResolvedValue(pin({ status: "draft" }));
    await expect(setPinStatus(BigInt(1), "published")).rejects.toMatchObject({
      code: "invalid_transition",
    });
    expect(mocked.updatePinMock).not.toHaveBeenCalled();
  });

  it("同态幂等:直接返回不落更新", async () => {
    mocked.findPin.mockResolvedValue(pin({ status: "pending" }));
    await setPinStatus(BigInt(1), "pending");
    expect(mocked.updatePinMock).not.toHaveBeenCalled();
  });

  it("首进 published 落 publishedAt;已有首布时间不覆盖", async () => {
    const first = new Date("2026-10-01T08:00:00Z");
    mocked.findPin.mockResolvedValue(pin({ status: "pending", publishedAt: null }));
    await setPinStatus(BigInt(1), "published");
    expect(mocked.updatePinMock).toHaveBeenLastCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ publishedAt: expect.any(Date) }) }),
    );
    mocked.findPin.mockResolvedValue(pin({ status: "synced", publishedAt: first }));
    await setPinStatus(BigInt(1), "published");
    expect(mocked.updatePinMock).toHaveBeenLastCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ publishedAt: first }) }),
    );
  });

  it("人工迁移表全覆盖四态且无自环、目标合法", () => {
    const all: PinStatus[] = ["draft", "pending", "synced", "published"];
    for (const s of all) {
      expect(PIN_MANUAL_TARGETS[s]).not.toContain(s);
      for (const t of PIN_MANUAL_TARGETS[s]) expect(all).toContain(t);
    }
  });
});

describe("edit_locked(已同步/已发布禁改)", () => {
  it.each(["synced", "published"] as const)("updatePin %s 态拒", async (status) => {
    mocked.findPin.mockResolvedValue(pin({ status }));
    await expect(updatePin(BigInt(1), { title: "新标题" })).rejects.toMatchObject({
      code: "edit_locked",
    });
  });

  it.each(["synced", "published"] as const)("addPinImages %s 态拒", async (status) => {
    mocked.findPin.mockResolvedValue(pin({ status }));
    await expect(addPinImages(BigInt(1), { mediaPath: "/wp/a.webp" })).rejects.toMatchObject({
      code: "edit_locked",
    });
  });

  it.each(["synced", "published"] as const)("removePinImage %s 态拒", async (status) => {
    mocked.findPin.mockResolvedValue(pin({ status }));
    await expect(removePinImage(BigInt(1), BigInt(11))).rejects.toMatchObject({
      code: "edit_locked",
    });
  });
});

describe("addPinImages 序列", () => {
  it("工坊版本挂载:快照 media_path + sortOrder 续尾", async () => {
    mocked.findPin.mockResolvedValue(pin({ status: "draft" }));
    mocked.imgCount.mockResolvedValue(2);
    mocked.verFindMany.mockResolvedValue([{ id: BigInt(7), mediaPath: "/wp/v.webp" }] as never);
    const n = await addPinImages(BigInt(1), { versionIds: ["7"] });
    expect(n).toBe(1);
    expect(mocked.imgCreateMany).toHaveBeenCalledWith({
      data: [{ pinId: BigInt(1), versionId: BigInt(7), mediaPath: "/wp/v.webp", sortOrder: 2 }],
    });
  });

  it("工坊版本不存在拒(version_not_found)", async () => {
    mocked.findPin.mockResolvedValue(pin({ status: "draft" }));
    mocked.imgCount.mockResolvedValue(0);
    mocked.verFindMany.mockResolvedValue([] as never);
    await expect(addPinImages(BigInt(1), { versionIds: ["404"] })).rejects.toMatchObject({
      code: "version_not_found",
    });
  });

  it("超上限 20 拒(image_overflow;版本与本地上传两口都拦)", async () => {
    mocked.findPin.mockResolvedValue(pin({ status: "draft" }));
    mocked.imgCount.mockResolvedValue(PIN_IMAGES_MAX);
    mocked.verFindMany.mockResolvedValue([{ id: BigInt(7), mediaPath: "/wp/v.webp" }] as never);
    await expect(addPinImages(BigInt(1), { versionIds: ["7"] })).rejects.toMatchObject({
      code: "image_overflow",
    });
    await expect(addPinImages(BigInt(1), { mediaPath: "/wp/a.webp" })).rejects.toMatchObject({
      code: "image_overflow",
    });
  });

  it("本地上传:versionId null 快照 + 宽高可空", async () => {
    mocked.findPin.mockResolvedValue(pin({ status: "draft" }));
    mocked.imgCount.mockResolvedValue(0);
    mocked.imgCreate.mockResolvedValue({} as never);
    await addPinImages(BigInt(1), { mediaPath: "/wp/local.webp", width: 800, height: 600 });
    expect(mocked.imgCreate).toHaveBeenCalledWith({
      data: {
        pinId: BigInt(1),
        versionId: null,
        mediaPath: "/wp/local.webp",
        width: 800,
        height: 600,
        sortOrder: 0,
      },
    });
  });
});

describe("reorderPinImages / removePinImage", () => {
  it("重排清单与现有不一致拒(防并发漂移静默错排)", async () => {
    mocked.imgFindMany.mockResolvedValue([{ id: BigInt(11) }, { id: BigInt(12) }] as never);
    await expect(reorderPinImages(BigInt(1), ["11"])).rejects.toMatchObject({ code: "not_found" });
    await expect(reorderPinImages(BigInt(1), ["11", "99"])).rejects.toMatchObject({
      code: "not_found",
    });
  });

  it("重排合法:按新序写 sortOrder 事务", async () => {
    mocked.imgFindMany.mockResolvedValue([{ id: BigInt(11) }, { id: BigInt(12) }] as never);
    await reorderPinImages(BigInt(1), ["12", "11"]);
    expect(mocked.tx).toHaveBeenCalledTimes(1);
    expect(mocked.tx.mock.calls[0][0]).toHaveLength(2);
  });

  it("移除非归属/不存在图拒", async () => {
    mocked.findPin.mockResolvedValue(pin({ status: "draft" }));
    mocked.imgDeleteMany.mockResolvedValue({ count: 0 });
    await expect(removePinImage(BigInt(1), BigInt(99))).rejects.toMatchObject({
      code: "not_found",
    });
  });
});

describe("createPin 缺省", () => {
  it("缺省 cropSpec=1_1、content 空串、topicId 可空;阅读原文回填本贴自链", async () => {
    mocked.updatePinMock.mockResolvedValue(pin({ readMoreUrl: "http://localhost:3000/pins/1/" }));
    const out = await createPin({ title: "未命名贴图" });
    expect(mocked.createPinMock).toHaveBeenCalledWith({
      data: {
        title: "未命名贴图",
        content: "",
        topicId: null,
        readMoreUrl: null,
        cropSpec: "1_1",
      },
    });
    expect(mocked.updatePinMock).toHaveBeenCalledWith({
      where: { id: BigInt(1) },
      data: { readMoreUrl: "http://localhost:3000/pins/1/" },
    });
    expect(out).toEqual(pin({ readMoreUrl: "http://localhost:3000/pins/1/" }));
  });

  it("显式阅读原文 → 尊重传入值不回填", async () => {
    mocked.createPinMock.mockResolvedValue(pin({ readMoreUrl: "https://example.com/a" }));
    await createPin({ title: "t", readMoreUrl: "https://example.com/a" });
    expect(mocked.updatePinMock).not.toHaveBeenCalled();
  });
});
