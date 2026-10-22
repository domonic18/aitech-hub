/**
 * 参照图解析单测(M42 批②,prisma 全 mock):优先级(样例图 → 图库 → 视频封面
 * → 文章配图 → 本创作贴图)、仅收 uploads 站内路径、同图去重、上限收敛、
 * 软引用悬空静默跳过。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../db", () => ({
  prisma: {
    writingSampleImage: { findUnique: vi.fn(), findMany: vi.fn() },
    topicItem: { findMany: vi.fn() },
    post: { findMany: vi.fn() },
    contentPin: { findMany: vi.fn() },
  },
}));

import { prisma } from "../db";
import type { ComposeMaterialBlock } from "./compose";
import { REFERENCE_LIMIT_MAX, resolveTopicReferences } from "./references";

const m = {
  sampleFind: vi.mocked(prisma.writingSampleImage.findUnique),
  libFind: vi.mocked(prisma.writingSampleImage.findMany),
  itemsFind: vi.mocked(prisma.topicItem.findMany),
  postFind: vi.mocked(prisma.post.findMany),
  pinFind: vi.mocked(prisma.contentPin.findMany),
};

const U = "/wp-content/uploads";

function block(over: Partial<ComposeMaterialBlock>): ComposeMaterialBlock {
  return {
    kind: "telegram",
    mediaType: "video",
    title: "视频一",
    blogger: "UP",
    note: null,
    aiNote: null,
    aiSummary: null,
    aiPoints: [],
    summary: null,
    aiTopic: null,
    keywords: [],
    videoUrl: "https://b23.tv/x",
    coverUrl: "https://img/cover.jpg",
    excerpt: null,
    contentSample: null,
    ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  m.sampleFind.mockResolvedValue(null);
  m.libFind.mockResolvedValue([] as never);
  m.itemsFind.mockResolvedValue([] as never);
  m.postFind.mockResolvedValue([] as never);
  m.pinFind.mockResolvedValue([] as never);
});

describe("resolveTopicReferences", () => {
  it("优先级:样例图 → 图库 → 视频封面 → 文章配图 → 本创作贴图;同图去重", async () => {
    m.sampleFind.mockResolvedValue({ name: "白纸红字", mediaPath: `${U}/sample.png` } as never);
    m.libFind.mockResolvedValue([
      { name: "白纸红字", mediaPath: `${U}/sample.png` }, // 绑定那张:去重不重复出
      { name: " cartoon", mediaPath: `${U}/lib1.png` },
      { name: "坏路径", mediaPath: "https://ext/lib2.png" }, // 非 uploads 剔除
    ] as never);
    m.itemsFind.mockResolvedValue([{ itemId: BigInt(7) }] as never);
    m.postFind.mockResolvedValue([
      {
        id: BigInt(7),
        title: "旧文",
        contentMd: `![a](${U}/post.png)\n![dup](${U}/sample.png)`,
        contentHtml: null,
        coverPath: null,
      },
    ] as never);
    m.pinFind.mockResolvedValue([
      { title: "贴图一", images: [{ mediaPath: `${U}/pin.png` }] },
    ] as never);

    const blocks = [block({}), block({ mediaType: "text", title: "电报文本" })];
    const r = await resolveTopicReferences(
      { id: BigInt(1), sampleImageId: BigInt(5) },
      { blocks, coverAssets: [{ title: "视频一", blogger: "UP", coverPath: `${U}/cover.jpg` }] },
    );
    expect(r.map((x) => [x.source, x.mediaPath])).toEqual([
      ["sample_image", `${U}/sample.png`],
      ["sample_library", `${U}/lib1.png`],
      ["video_cover", `${U}/cover.jpg`],
      ["post_image", `${U}/post.png`],
      ["pin_image", `${U}/pin.png`],
    ]);
    expect(r[0]?.label).toContain("白纸红字");
  });

  it("样例图库层:无绑定时图库仍是预置候选;findMany 带 take 帽", async () => {
    const rows = Array.from({ length: 8 }, (_, i) => ({
      name: `库图${i}`,
      mediaPath: `${U}/lib${i}.png`,
    }));
    // mock 尊重 take(与 DB 行为一致:帽在查询层收敛,代码不再二次截断)
    m.libFind.mockImplementation((async (args?: { take?: number }) =>
      rows.slice(0, args?.take ?? rows.length)) as never);
    const r = await resolveTopicReferences({ id: BigInt(1), sampleImageId: null });
    expect(r).toHaveLength(5); // SAMPLE_LIBRARY_MAX 帽(≤ limit 10)
    expect(r.every((x) => x.source === "sample_library")).toBe(true);
    expect(m.libFind.mock.calls[0]?.[0]?.take).toBe(5);
  });

  it("非 uploads 路径一律剔除(/media/、外链、相对路径)", async () => {
    m.sampleFind.mockResolvedValue({ name: "x", mediaPath: "/media/sample.png" } as never);
    m.itemsFind.mockResolvedValue([{ itemId: BigInt(7) }] as never);
    m.postFind.mockResolvedValue([
      {
        id: BigInt(7),
        title: "旧文",
        contentMd: "![](/media/a.png)\n![](https://ext/b.png)\n![](c.png)",
        contentHtml: '<img src="https://ext/d.png">',
        coverPath: "/media/cover.png",
      },
    ] as never);
    const r = await resolveTopicReferences({ id: BigInt(1), sampleImageId: BigInt(5) });
    expect(r).toEqual([]);
  });

  it("未传 coverAssets 时跳过视频封面层(不发起外链下载)", async () => {
    const r = await resolveTopicReferences(
      { id: BigInt(1), sampleImageId: null },
      { blocks: [block({})] },
    );
    expect(r).toEqual([]);
  });

  it("limit 收敛:1 → 只留最高优先的一张;上限 ≤ REFERENCE_LIMIT_MAX", async () => {
    m.sampleFind.mockResolvedValue({ name: "s", mediaPath: `${U}/s.png` } as never);
    m.pinFind.mockResolvedValue(
      Array.from({ length: 12 }, (_, i) => ({
        title: `贴图${i}`,
        images: [{ mediaPath: `${U}/p${i}.png` }],
      })) as never,
    );
    const one = await resolveTopicReferences(
      { id: BigInt(1), sampleImageId: BigInt(5) },
      { limit: 1 },
    );
    expect(one).toHaveLength(1);
    const all = await resolveTopicReferences({ id: BigInt(1), sampleImageId: BigInt(5) });
    expect(all.length).toBeLessThanOrEqual(REFERENCE_LIMIT_MAX);
  });

  it("软引用悬空(样例图行不存在/文章已删)静默跳过", async () => {
    m.sampleFind.mockResolvedValue(null);
    m.itemsFind.mockResolvedValue([{ itemId: BigInt(7) }, { itemId: BigInt(8) }] as never);
    m.postFind.mockResolvedValue([
      {
        id: BigInt(7),
        title: "在的",
        contentMd: `![a](${U}/a.png)`,
        contentHtml: null,
        coverPath: null,
      },
    ] as never);
    const r = await resolveTopicReferences({ id: BigInt(1), sampleImageId: BigInt(5) });
    expect(r.map((x) => x.mediaPath)).toEqual([`${U}/a.png`]);
  });
});
