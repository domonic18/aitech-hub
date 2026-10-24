/**
 * 贴图组装落库单测(M42 批③,prisma 全 mock):码点硬闸(标题 32 / 轻文字 2 万)、
 * 图片 1..20 与 uploads-only、重复图拒、软引用创建校验、事务内顺序落图与
 * collecting→drafted 推进、阅读原文缺省回填本贴自链(显式传入不覆盖)、
 * 中途失败整体上抛不继续写。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../db", () => ({
  prisma: {
    $transaction: vi.fn(),
    topic: { findUnique: vi.fn(), updateMany: vi.fn() },
    contentPin: { create: vi.fn(), update: vi.fn() },
    contentPinImage: { createMany: vi.fn() },
  },
}));

import { prisma } from "../db";
import { PIN_IMAGES_MAX, PIN_TITLE_MAX } from "./constants";
import { assertPinAssembleInput, createPinWithImages } from "./assemble";
import { PinError } from "./repo";

const tx = {
  topicFind: vi.mocked(prisma.topic.findUnique),
  topicUpdateMany: vi.mocked(prisma.topic.updateMany),
  pinCreate: vi.mocked(prisma.contentPin.create),
  pinUpdate: vi.mocked(prisma.contentPin.update),
  imgCreateMany: vi.mocked(prisma.contentPinImage.createMany),
  transaction: vi.mocked(prisma.$transaction),
};

const U = "/wp-content/uploads/2026/10";
const img = (n: number): string => `${U}/p${n}.png`;

beforeEach(() => {
  vi.clearAllMocks();
  tx.transaction.mockImplementation((async (fn: (t: unknown) => unknown) => fn(prisma)) as never);
  tx.topicFind.mockResolvedValue({ id: BigInt(1) } as never);
  tx.topicUpdateMany.mockResolvedValue({ count: 1 } as never);
  tx.pinCreate.mockResolvedValue({ id: BigInt(77) } as never);
  tx.pinUpdate.mockResolvedValue({
    id: BigInt(77),
    readMoreUrl: "http://localhost:3000/pins/77/",
  } as never);
  tx.imgCreateMany.mockResolvedValue({ count: 1 } as never);
});

describe("assertPinAssembleInput(码点与路径硬闸)", () => {
  const base = { title: "标题", images: [img(1)] };

  it(`标题 1..${PIN_TITLE_MAX} 码点,轻文字 ≤2 万`, () => {
    expect(() =>
      assertPinAssembleInput({ ...base, title: "贴".repeat(PIN_TITLE_MAX) }),
    ).not.toThrow();
    expect(() =>
      assertPinAssembleInput({ ...base, title: "贴".repeat(PIN_TITLE_MAX + 1) }),
    ).toThrow("公众号上限");
    expect(() => assertPinAssembleInput({ ...base, title: "   " })).toThrow("标题必填");
    // emoji 按码点(UTF-16 计数会多算)
    const emoji = "😀".repeat(PIN_TITLE_MAX);
    expect(() => assertPinAssembleInput({ ...base, title: emoji })).not.toThrow();
    expect(() => assertPinAssembleInput({ ...base, content: "字".repeat(20001) })).toThrow(
      "轻文字",
    );
  });

  it(`图片 1..${PIN_IMAGES_MAX} 张;0 / 超帽 / 重复 / 非 uploads 一律拒`, () => {
    expect(() => assertPinAssembleInput({ ...base, images: [] })).toThrow("至少需要 1 张");
    expect(() =>
      assertPinAssembleInput({
        ...base,
        images: Array.from({ length: PIN_IMAGES_MAX + 1 }, (_, i) => img(i)),
      }),
    ).toThrow("最多");
    expect(() => assertPinAssembleInput({ ...base, images: [img(1), img(1)] })).toThrow("重复");
    expect(() => assertPinAssembleInput({ ...base, images: ["/media/a.png"] })).toThrow(
      "站内上传路径",
    );
    expect(() =>
      assertPinAssembleInput({ ...base, referenceMediaPath: "https://ext/a.png" }),
    ).toThrow("参照图");
  });
});

describe("createPinWithImages(单事务)", () => {
  it("按入参顺序落 sortOrder,写参照,推进 collecting→drafted", async () => {
    const pin = await createPinWithImages({
      title: "  标题  ",
      content: "轻文字",
      topicId: BigInt(1),
      images: [img(1), img(2), img(3)],
      referenceMediaPath: `${U}/sample.png`,
    });
    // 纯中文标题无 ASCII slug → 自链退化为 /pins/<id>/(id 锚定)
    expect(pin).toEqual({ id: BigInt(77), readMoreUrl: "http://localhost:3000/pins/77/" });
    expect(tx.pinCreate).toHaveBeenCalledWith({
      data: {
        title: "标题",
        content: "轻文字",
        topicId: BigInt(1),
        readMoreUrl: null,
        cropSpec: "1_1",
        referenceMediaPath: `${U}/sample.png`,
      },
    });
    expect(tx.pinUpdate).toHaveBeenCalledWith({
      where: { id: BigInt(77) },
      data: { readMoreUrl: "http://localhost:3000/pins/77/" },
    });
    expect(tx.imgCreateMany).toHaveBeenCalledWith({
      data: [img(1), img(2), img(3)].map((mediaPath, i) => ({
        pinId: BigInt(77),
        versionId: null,
        mediaPath,
        sortOrder: i,
      })),
    });
    expect(tx.topicUpdateMany).toHaveBeenCalledWith({
      where: { id: BigInt(1), status: "collecting" },
      data: { status: "drafted" },
    });
  });

  it("显式阅读原文 → 尊重传入值,不回填自链", async () => {
    tx.pinCreate.mockResolvedValue({
      id: BigInt(77),
      readMoreUrl: "https://example.com/a",
    } as never);
    const pin = await createPinWithImages({
      title: "标题",
      images: [img(1)],
      readMoreUrl: "https://example.com/a",
    });
    expect(tx.pinUpdate).not.toHaveBeenCalled();
    expect(pin).toEqual({ id: BigInt(77), readMoreUrl: "https://example.com/a" });
  });

  it("无 topicId(独立贴图):不查创作不推进状态", async () => {
    await createPinWithImages({ title: "独立", images: [img(1)] });
    expect(tx.topicFind).not.toHaveBeenCalled();
    expect(tx.topicUpdateMany).not.toHaveBeenCalled();
    expect(tx.pinCreate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ topicId: null }) }),
    );
  });

  it("创作不存在 → not_found,不建悬空 soft ref", async () => {
    tx.topicFind.mockResolvedValue(null);
    await expect(
      createPinWithImages({ title: "t", topicId: BigInt(9), images: [img(1)] }),
    ).rejects.toMatchObject({ code: "not_found" });
    expect(tx.pinCreate).not.toHaveBeenCalled();
  });

  it("中途失败整体上抛,事务后段不执行(回滚由 DB 事务保证)", async () => {
    tx.imgCreateMany.mockRejectedValue(new Error("pg 连接断"));
    await expect(
      createPinWithImages({ title: "t", topicId: BigInt(1), images: [img(1)] }),
    ).rejects.toThrow("pg 连接断");
    expect(tx.topicUpdateMany).not.toHaveBeenCalled();
  });

  it("校验失败不开启事务", async () => {
    await expect(createPinWithImages({ title: "t", images: [] })).rejects.toBeInstanceOf(PinError);
    expect(tx.transaction).not.toHaveBeenCalled();
  });
});
