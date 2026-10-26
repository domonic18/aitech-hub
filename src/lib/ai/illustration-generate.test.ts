/**
 * 贴图直出生成 job 单测(M42 批③,全 mock):referencePath 透传执行核心 /
 * 采纳参照落 content_pin.reference_media_path(外链转存路径优先、装载失败不落)/
 * 无 pinId 不写库。入队侧站点校验见 enqueueIllustrationGenerate。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../db", () => ({
  prisma: {
    contentPin: { findUnique: vi.fn(), update: vi.fn() },
    contentPinImage: { count: vi.fn(), createMany: vi.fn() },
    illustrationVersion: { findMany: vi.fn() },
  },
}));
vi.mock("../logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock("../queue", () => ({
  QUEUE_ILLUSTRATION_STUDIO: "illustration-studio",
  ILLUSTRATION_JOB_GENERATE: "generate",
  getQueue: vi.fn(),
}));
const generateIllustrations = vi.hoisted(() => vi.fn());
vi.mock("./illustrate-generate", () => ({
  generateIllustrations,
  ILLUSTRATE_ASPECT_SIZES: { "16:9": "1344x768", "3:4": "864x1152", "1:1": "1024x1024" },
  ILLUSTRATE_MAX_COUNT: 3,
}));
const ensureStudioRoot = vi.hoisted(() => vi.fn());
// 部分mock:ensureStudioRoot 打桩,纯函数 deriveIllustrationName 保真实实现(job 内调用)
vi.mock("./illustration-studio", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./illustration-studio")>()),
  ensureStudioRoot,
}));

import { prisma } from "../db";
import { illustrationGenerateJob } from "./illustration-generate";

const pinUpdate = vi.mocked(prisma.contentPin.update);
const pinFind = vi.mocked(prisma.contentPin.findUnique);
const imgCount = vi.mocked(prisma.contentPinImage.count);
const imgCreateMany = vi.mocked(prisma.contentPinImage.createMany);
const verFindMany = vi.mocked(prisma.illustrationVersion.findMany);

const IMG = { path: "/wp-content/uploads/2026/10/gen-1.png", mime: "image/png" };

beforeEach(() => {
  vi.clearAllMocks();
  generateIllustrations.mockResolvedValue({
    images: [IMG],
    referenceError: null,
    savedReferencePath: null,
  });
  ensureStudioRoot.mockResolvedValue({ versionId: BigInt(9) });
  pinFind.mockResolvedValue({ status: "draft", _count: { images: 0 } } as never);
  imgCount.mockResolvedValue(0 as never);
  imgCreateMany.mockResolvedValue({ count: 1 } as never);
  verFindMany.mockResolvedValue([{ id: BigInt(9), mediaPath: IMG.path }] as never);
});

describe("illustrationGenerateJob(参照贯通)", () => {
  it("referencePath 透传执行核心;站内参照原样落贴图", async () => {
    const ref = "/wp-content/uploads/2026/10/sample.png";
    const r = await illustrationGenerateJob({
      prompt: "手绘笔记风",
      count: 1,
      pinId: "7",
      referencePath: ref,
    });
    expect(generateIllustrations).toHaveBeenCalledWith(
      expect.objectContaining({ referencePath: ref }),
    );
    expect(r).toMatchObject({ attached: 1, referenceError: null });
    expect(pinUpdate).toHaveBeenCalledWith({
      where: { id: BigInt(7) },
      data: { referenceMediaPath: ref },
    });
  });

  it("外链参照被转存时,优先记转存后的站内路径", async () => {
    generateIllustrations.mockResolvedValueOnce({
      images: [IMG],
      referenceError: null,
      savedReferencePath: "/wp-content/uploads/2026/10/ref-saved.png",
    });
    await illustrationGenerateJob({
      prompt: "x",
      pinId: "7",
      referencePath: "https://ext/a.png",
    });
    expect(pinUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { referenceMediaPath: "/wp-content/uploads/2026/10/ref-saved.png" },
      }),
    );
  });

  it("参照装载失败(referenceError)→ 降级出图但不落参照", async () => {
    generateIllustrations.mockResolvedValueOnce({
      images: [IMG],
      referenceError: "参照图过大",
      savedReferencePath: null,
    });
    const r = await illustrationGenerateJob({
      prompt: "x",
      pinId: "7",
      referencePath: "/wp-content/uploads/2026/10/sample.png",
    });
    expect(r.referenceError).toBe("参照图过大");
    expect(pinUpdate).not.toHaveBeenCalled();
  });

  it("无 pinId(工坊直出)不写贴图;无参照不传 referencePath", async () => {
    await illustrationGenerateJob({ prompt: "x" });
    expect(generateIllustrations).toHaveBeenCalledWith(
      expect.not.objectContaining({ referencePath: expect.anything() }),
    );
    expect(pinUpdate).not.toHaveBeenCalled();
  });
});
