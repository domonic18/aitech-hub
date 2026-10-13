/**
 * 专题落稿核单测(M26 批④建;M27 批⑤随 agent 自主生产重构更新):重合成保护
 * 判定 / 文首推荐卡 / aiPoints 归一 / media refs 防幻觉校验联调。LLM 与落稿
 * DB 链不入单测(集成路径由真机验收覆盖);四步管线与单调用合成已退役。
 */
import { describe, expect, it } from "vitest";

import { findNonSiteImageRefs } from "../media/refs";
import { buildVideoCard, needsRecomposeConfirm, normalizePoints } from "./compose";

function tgBlock() {
  return {
    kind: "telegram" as const,
    title: "端侧实测",
    blogger: "UP主A",
    note: null,
    aiNote: null,
    aiSummary: null,
    aiPoints: [],
    videoUrl: "https://www.bilibili.com/video/BV1xx",
    coverUrl: "https://i0.hdslb.com/bfs/archive/cover.jpg",
    excerpt: null,
    contentSample: null,
  };
}

describe("buildVideoCard(文首推荐卡)", () => {
  it("取首条视频素材拼卡;博主缺失兜底「未知」", () => {
    const second = { ...tgBlock(), title: "第二条不该被取到" };
    const card = buildVideoCard([tgBlock(), second]);
    expect(card).toContain("《端侧实测》");
    expect(card).toContain("UP主:UP主A");
    expect(card).toContain("阅读原文");
    expect(card).not.toContain("第二条");
  });

  it("博主为 null 兜底;纯文章素材返回 null 不注入", () => {
    expect(buildVideoCard([{ ...tgBlock(), blogger: null }])).toContain("UP主:未知");
    expect(
      buildVideoCard([
        {
          kind: "post",
          title: "旧文",
          blogger: null,
          note: null,
          aiNote: null,
          aiSummary: null,
          aiPoints: [],
          videoUrl: null,
          coverUrl: null,
          excerpt: null,
          contentSample: null,
        },
      ]),
    ).toBeNull();
    expect(buildVideoCard([])).toBeNull();
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
  it("站内路径不报;外链与非站内绝对路径报原值", () => {
    const md = [
      "![封面](/wp-content/uploads/2026/10/a.png)",
      "![外链](https://i0.hdslb.com/bfs/x.jpg)",
      "![其它](/media/videos/b.mp4)",
      "![伪站内](/wp-content/../evil.png)",
    ].join("\n");
    expect(findNonSiteImageRefs(md)).toEqual([
      "https://i0.hdslb.com/bfs/x.jpg",
      "/wp-content/../evil.png",
    ]);
  });

  it("无图片语法 → 空数组", () => {
    expect(findNonSiteImageRefs("纯文本正文,没有图")).toEqual([]);
  });
});
