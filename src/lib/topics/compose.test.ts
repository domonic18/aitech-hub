/**
 * 专题落稿核单测(M26 批④建;M27 批⑤随 agent 自主生产重构更新;批⑥补配图
 * 供给链):重合成保护判定 / 文首推荐卡(带图+降级)/ 封面全量转存 / aiPoints
 * 归一 / media refs 防幻觉校验联调。LLM 与落稿 DB 链不入单测(集成路径由真机
 * 验收覆盖);四步管线与单调用合成已退役。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import { findNonSiteImageRefs } from "../media/refs";
import {
  buildVideoCard,
  needsRecomposeConfirm,
  normalizePoints,
  transferVideoCovers,
} from "./compose";

const fetchExtMock = vi.hoisted(() =>
  vi.fn<(url: string) => Promise<{ data: Buffer; mime: string }>>(),
);
vi.mock("../media/fetch-external", () => ({ fetchExternalImage: fetchExtMock }));

const uploadMediaMock = vi.hoisted(() =>
  vi.fn<(args: { data: Buffer; mime: string; filename: string }) => Promise<{ path: string }>>(),
);
vi.mock("../media/service", () => ({ uploadMedia: uploadMediaMock }));

vi.mock("../logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

function tgBlock() {
  return {
    kind: "telegram" as const,
    mediaType: "video" as const,
    title: "端侧实测",
    blogger: "UP主A",
    note: null,
    aiNote: null,
    aiSummary: null,
    aiPoints: [],
    summary: "原文一句",
    aiTopic: "端侧",
    keywords: [],
    videoUrl: "https://www.bilibili.com/video/BV1xx",
    coverUrl: "https://i0.hdslb.com/bfs/archive/cover.jpg",
    excerpt: null,
    contentSample: null,
  };
}

function postBlock() {
  return {
    kind: "post" as const,
    mediaType: null,
    title: "旧文",
    blogger: null,
    note: null,
    aiNote: null,
    aiSummary: null,
    aiPoints: [],
    summary: null,
    aiTopic: null,
    keywords: [],
    videoUrl: null,
    coverUrl: null,
    excerpt: null,
    contentSample: null,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  fetchExtMock.mockResolvedValue({ data: Buffer.from("img"), mime: "image/jpeg" });
  let n = 0;
  uploadMediaMock.mockImplementation(async () => ({
    path: `/wp-content/uploads/2026/10/${++n}.jpg`,
  }));
});

describe("buildVideoCard(文首推荐卡,M27 批⑥带图)", () => {
  it("取首条视频素材拼卡;博主缺失兜底「未知」", () => {
    const second = { ...tgBlock(), title: "第二条不该被取到" };
    const card = buildVideoCard([tgBlock(), second], null);
    expect(card).toContain("《端侧实测》");
    expect(card).toContain("UP主:UP主A");
    // 渠道中性化(2026-10-20 问题四):导流话术不入正文,由分发侧 channel-tails 追加
    expect(card).not.toContain("阅读原文");
    expect(card).not.toContain("第二条");
  });

  it("带封面路径:图行(md 图片语法)在前、文字行在后", () => {
    const card = buildVideoCard([tgBlock()], "/wp-content/uploads/2026/10/1.jpg");
    expect(card).toContain("![端侧实测](/wp-content/uploads/2026/10/1.jpg)");
    expect(card).not.toBeNull();
    const imgIdx = card!.indexOf("![");
    const textIdx = card!.indexOf("📺");
    expect(imgIdx).toBeGreaterThanOrEqual(0);
    expect(imgIdx).toBeLessThan(textIdx);
  });

  it("封面 null 降级纯文字卡(无图片语法);纯文章素材/空素材仍 null", () => {
    expect(buildVideoCard([tgBlock()], null)).not.toContain("![");
    expect(buildVideoCard([postBlock()], "/wp-content/uploads/2026/10/1.jpg")).toBeNull();
    expect(buildVideoCard([], null)).toBeNull();
  });
});

describe("transferVideoCovers(全量封面转存,M27 批⑥)", () => {
  it("并行转存全部视频素材封面,与 telegram 带封面子序列同序对齐;post 块不参与", async () => {
    const second = { ...tgBlock(), title: "第二条", coverUrl: "https://i0.hdslb.com/bfs/b.jpg" };
    const assets = await transferVideoCovers([tgBlock(), postBlock(), second]);
    expect(uploadMediaMock).toHaveBeenCalledTimes(2);
    expect(assets).toEqual([
      { title: "端侧实测", blogger: "UP主A", coverPath: "/wp-content/uploads/2026/10/1.jpg" },
      { title: "第二条", blogger: "UP主A", coverPath: "/wp-content/uploads/2026/10/2.jpg" },
    ]);
  });

  it("单条失败置 null 不抛(按素材独立降级);无视频素材返回空数组", async () => {
    fetchExtMock.mockRejectedValueOnce(new Error("404"));
    const assets = await transferVideoCovers([tgBlock()]);
    expect(assets).toEqual([{ title: "端侧实测", blogger: "UP主A", coverPath: null }]);
    expect(uploadMediaMock).not.toHaveBeenCalled();
    expect(await transferVideoCovers([postBlock()])).toEqual([]);
  });
});

describe("normalizePoints(aiPoints Json 列读侧归一)", () => {
  it("白名单字符串;非数组/空串/非串剔除", () => {
    expect(normalizePoints(["成本减半", "", 3, null])).toEqual(["成本减半"]);
    expect(normalizePoints("not-array")).toEqual([]);
    expect(normalizePoints(undefined)).toEqual([]);
  });
});

describe("needsRecomposeConfirm(重合成保护判定)", () => {
  const composedAt = new Date("2026-10-13T10:00:00Z");
  const topic = { linkedPostId: BigInt(1), composedAt };

  it("无关联/关联行缺失 → false(走新建)", () => {
    expect(needsRecomposeConfirm({ linkedPostId: null, composedAt }, null)).toBe(false);
    expect(needsRecomposeConfirm(topic, null)).toBe(false);
  });

  it("关联文档软删 → false(弃锚新建)", () => {
    expect(needsRecomposeConfirm(topic, { status: "deleted", updatedAt: new Date() })).toBe(false);
  });

  it("合成后未被编辑(updatedAt ≤ composedAt)→ false", () => {
    expect(needsRecomposeConfirm(topic, { status: "draft", updatedAt: composedAt })).toBe(false);
  });

  it("合成后被人工编辑(updatedAt > composedAt)→ true", () => {
    expect(
      needsRecomposeConfirm(topic, {
        status: "draft",
        updatedAt: new Date("2026-10-13T11:00:00Z"),
      }),
    ).toBe(true);
  });

  it("人工关联但从未合成过(composedAt=null)→ true(覆盖即破坏)", () => {
    expect(
      needsRecomposeConfirm(
        { linkedPostId: BigInt(1), composedAt: null },
        { status: "published", updatedAt: new Date("2026-01-01T00:00:00Z") },
      ),
    ).toBe(true);
  });
});

describe("findNonSiteImageRefs(正文图片防幻觉校验,save_topic_draft 消费)", () => {
  it("uploads 路径不报;外链、/media/(无服务路由,批⑥收口)与非站内绝对路径报原值", () => {
    const md = [
      "![封面](/wp-content/uploads/2026/10/a.png)",
      "![外链](https://i0.hdslb.com/bfs/x.jpg)",
      "![其它](/media/videos/b.mp4)",
      "![伪站内](/wp-content/../evil.png)",
    ].join("\n");
    expect(findNonSiteImageRefs(md)).toEqual([
      "https://i0.hdslb.com/bfs/x.jpg",
      "/media/videos/b.mp4",
      "/wp-content/../evil.png",
    ]);
  });

  it("无图片语法 → 空数组", () => {
    expect(findNonSiteImageRefs("纯文本正文,没有图")).toEqual([]);
  });
});
