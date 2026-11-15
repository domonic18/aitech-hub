/**
 * 素材包拼装单测(D5/B3):导出给线下的那份 JSON 的形状——
 * 定位与写作配置、素材全集(电报带原文链接/解读笔记,文章带正文取样)、
 * 绑定指南全文(仓库 md 真相源)、近期已发标题。
 */
import { describe, expect, it, vi, beforeEach } from "vitest";

const postFindMany = vi.hoisted(() => vi.fn());
const postFindUnique = vi.hoisted(() => vi.fn());
vi.mock("@/lib/db", () => ({
  prisma: { post: { findMany: postFindMany, findUnique: postFindUnique } },
}));

const getTopic = vi.hoisted(() => vi.fn());
vi.mock("@/lib/topics/repo", () => ({ getTopic }));

const hydrateItems = vi.hoisted(() => vi.fn());
vi.mock("@/lib/topics/materials", () => ({ hydrateItems }));

const listRecentPublishedTitles = vi.hoisted(() => vi.fn());
vi.mock("@/lib/topics/compose", () => ({ listRecentPublishedTitles }));

const readWritingSkill = vi.hoisted(() => vi.fn());
const listWritingSkills = vi.hoisted(() => vi.fn());
vi.mock("@/lib/skills/writing-skills", () => ({ readWritingSkill, listWritingSkills }));

import { buildTopicExportBundle } from "./export-bundle";

const TOPIC = {
  id: BigInt(9),
  title: "AI 编程",
  positioning: "长文四维条款",
  pinPositioning: "贴图条款",
  outputType: "article",
  status: "collecting",
  skillKey: "blogger-video",
  linkedPostId: BigInt(77),
  items: [
    { id: BigInt(1), itemType: "telegram", itemId: BigInt(100), note: "优先讲这条", sortOrder: 0 },
    { id: BigInt(2), itemType: "post", itemId: BigInt(200), note: null, sortOrder: 1 },
  ],
};

beforeEach(() => {
  vi.clearAllMocks();
  getTopic.mockResolvedValue(TOPIC);
  hydrateItems.mockResolvedValue(
    new Map([
      [
        BigInt(1),
        {
          itemType: "telegram",
          itemId: BigInt(100),
          telegram: {
            id: BigInt(100),
            title: "电报标题",
            mediaType: "video",
            summary: "原文摘要",
            videoBlogger: "博主",
            url: "https://t.me/x/1",
            videoCoverUrl: "https://img/cover.jpg",
            aiSummary: "AI 摘要",
            aiPoints: ["要点一"],
            aiNote: "解读笔记全文",
            aiTopic: "主题",
            aiKeywords: ["关键词"],
          },
          post: null,
        },
      ],
      [
        BigInt(2),
        {
          itemType: "post",
          itemId: BigInt(200),
          telegram: null,
          post: { id: BigInt(200), title: "站内文章", status: "published" },
        },
      ],
    ]),
  );
  postFindMany.mockResolvedValue([
    {
      id: BigInt(200),
      title: "站内文章",
      slug: "my-slug",
      status: "published",
      excerpt: "文章摘要",
      contentMd: "正文".repeat(2000),
    },
  ]);
  postFindUnique.mockResolvedValue({ id: BigInt(77), title: "已关联稿", status: "draft" });
  listRecentPublishedTitles.mockResolvedValue(["近期一文"]);
  listWritingSkills.mockReturnValue([
    { key: "blogger-video", name: "视频安利稿", scenario: "视频", version: "1.0", length: 900 },
  ]);
  readWritingSkill.mockReturnValue({
    key: "blogger-video",
    name: "视频安利稿",
    scenario: "视频",
    version: "1.0",
    length: 900,
    guideMd: "指南正文",
  });
});

describe("buildTopicExportBundle", () => {
  it("带出定位/配置与素材全集(电报带原文链接与解读笔记)", async () => {
    const b = await buildTopicExportBundle(BigInt(9));
    expect(b.topic).toMatchObject({
      id: "9",
      title: "AI 编程",
      positioning: "长文四维条款",
      pinPositioning: "贴图条款",
      skillKey: "blogger-video",
    });
    expect(b.materials).toHaveLength(2);
    expect(b.materials[0]).toMatchObject({
      kind: "telegram",
      mediaType: "video",
      source: "https://t.me/x/1",
      note: "优先讲这条",
      noteMd: "解读笔记全文",
      points: ["要点一"],
      keywords: ["关键词"],
    });
  });

  it("文章素材带站内链接与正文取样(不整篇灌入)", async () => {
    const b = await buildTopicExportBundle(BigInt(9));
    const post = b.materials.find((m) => m.kind === "post");
    expect(post).toMatchObject({
      source: "/post/200-my-slug",
      excerpt: "文章摘要",
    });
    expect((post?.contentSample ?? "").length).toBe(2000);
  });

  it("绑定指南全文随包带出(仓库 md 真相源),并附指南清单", async () => {
    const b = await buildTopicExportBundle(BigInt(9));
    expect(b.skill).toMatchObject({ key: "blogger-video", guideMd: "指南正文" });
    expect(b.skills[0]).toMatchObject({ key: "blogger-video" });
  });

  it("关联稿与近期已发标题都带上(选题防重复)", async () => {
    const b = await buildTopicExportBundle(BigInt(9));
    expect(b.linkedPost).toMatchObject({ id: "77", status: "draft" });
    expect(b.recentPublishedTitles).toEqual(["近期一文"]);
  });
});
