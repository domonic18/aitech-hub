/**
 * get_post_sources 单测(2026-10-18 post-319 配套):admin 会话防线 /
 * post 不存在 / 无关联专题 / 专题空素材 / 素材底料映射(note_md 截断与
 * summary 降级形态)。DB/拼装全 mock;LLM 不入单测。
 */
import { describe, expect, it, vi, beforeEach } from "vitest";

const sessionFindUnique = vi.hoisted(() => vi.fn());
const postFindUnique = vi.hoisted(() => vi.fn());
const topicFindFirst = vi.hoisted(() => vi.fn());
vi.mock("../db", () => ({
  prisma: {
    searchAgentSession: { findUnique: sessionFindUnique },
    post: { findUnique: postFindUnique },
    topic: { findFirst: topicFindFirst },
  },
}));
vi.mock("../logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

const buildComposeBlocks = vi.hoisted(() => vi.fn());
vi.mock("../topics/compose", () => ({ buildComposeBlocks }));

import { postSourcesTool } from "./post-sources-tool";

/** 工具调用统一入口(同 topic-tools.test 口径) */
async function invoke(
  args: Record<string, unknown>,
  threadId = "t-admin",
): Promise<Record<string, unknown>> {
  const raw = (await postSourcesTool.invoke(
    args as never,
    { configurable: { thread_id: threadId } } as never,
  )) as string;
  return JSON.parse(raw) as Record<string, unknown>;
}

const ADMIN_OK = { visitorId: "admin:sub-1" };
const POST = { id: BigInt(319), title: "WorkBuddy做PPT", status: "published" };
const TOPIC = {
  id: BigInt(2),
  title: "Workbuddy做PPT",
  positioning: "教程向定位",
  skillKey: null,
  status: "drafted",
  items: [],
};
const TG_BLOCK = {
  kind: "telegram",
  mediaType: "video",
  title: "WorkBuddy做汇报ppt",
  blogger: "晓墨AIGC",
  note: "重点讲需求清单",
  aiNote: "## 背景与问题\n…实操流程…",
  aiSummary: "短结论",
  aiPoints: ["要点1"],
  summary: "原文摘要",
  aiTopic: "PPT 自动化",
  keywords: ["PPT"],
  videoUrl: "https://www.douyin.com/video/x",
  coverUrl: null,
  excerpt: null,
  contentSample: null,
};

beforeEach(() => {
  vi.resetAllMocks();
});

describe("admin 会话防线(fail-closed)", () => {
  it("非 admin 会话行 / 无行 / 无 threadId → 全拒且不触达业务", async () => {
    for (const row of [{ visitorId: "user:u1" }, null]) {
      sessionFindUnique.mockResolvedValueOnce(row);
      await expect(invoke({ post_id: "319" })).resolves.toMatchObject({ ok: false });
    }
    await expect(invoke({ post_id: "319" }, "")).resolves.toMatchObject({ ok: false });
    expect(postFindUnique).not.toHaveBeenCalled();
  });
});

describe("get_post_sources", () => {
  it("post 不存在 → 人话报错", async () => {
    sessionFindUnique.mockResolvedValueOnce(ADMIN_OK);
    postFindUnique.mockResolvedValueOnce(null);
    await expect(invoke({ post_id: "999" })).resolves.toMatchObject({
      ok: false,
      error: expect.stringContaining("不存在"),
    });
  });

  it("无关联专题 → 提示非合成产物与替代路径", async () => {
    sessionFindUnique.mockResolvedValueOnce(ADMIN_OK);
    postFindUnique.mockResolvedValueOnce(POST);
    topicFindFirst.mockResolvedValueOnce(null);
    const r = await invoke({ post_id: "319" });
    expect(r.ok).toBe(false);
    expect(String(r.error)).toContain("没有关联专题");
    expect(String(r.error)).toContain("get_topic_brief");
  });

  it("关联专题零素材 → 提示先挂载", async () => {
    sessionFindUnique.mockResolvedValueOnce(ADMIN_OK);
    postFindUnique.mockResolvedValueOnce(POST);
    topicFindFirst.mockResolvedValueOnce(TOPIC);
    buildComposeBlocks.mockResolvedValueOnce([]);
    const r = await invoke({ post_id: "319" });
    expect(r.ok).toBe(false);
    expect(String(r.error)).toContain("还没有挂载素材");
  });

  it("素材底料映射:解读笔记进 note_md,专题/关联文档随附", async () => {
    sessionFindUnique.mockResolvedValueOnce(ADMIN_OK);
    postFindUnique.mockResolvedValueOnce(POST);
    topicFindFirst.mockResolvedValueOnce(TOPIC);
    buildComposeBlocks.mockResolvedValueOnce([TG_BLOCK]);
    const r = await invoke({ post_id: "319" });
    expect(r).toMatchObject({
      ok: true,
      topic: {
        id: "2",
        title: "Workbuddy做PPT",
        positioning: "教程向定位",
        skill_key: null,
        admin_url: "/admin/studio/2",
      },
      linked_post: { id: "319", status: "published" },
    });
    const materials = r.materials as Array<Record<string, unknown>>;
    expect(materials[0]).toMatchObject({
      kind: "telegram",
      title: "WorkBuddy做汇报ppt",
      blogger: "晓墨AIGC",
      note: "重点讲需求清单",
      note_md: "## 背景与问题\n…实操流程…",
      video_url: "https://www.douyin.com/video/x",
    });
    expect(materials[0]).not.toHaveProperty("summary");
  });

  it("无解读笔记降级 summary/points 形态(aiNote null)", async () => {
    sessionFindUnique.mockResolvedValueOnce(ADMIN_OK);
    postFindUnique.mockResolvedValueOnce(POST);
    topicFindFirst.mockResolvedValueOnce(TOPIC);
    buildComposeBlocks.mockResolvedValueOnce([{ ...TG_BLOCK, aiNote: null }]);
    const r = await invoke({ post_id: "319" });
    const materials = r.materials as Array<Record<string, unknown>>;
    expect(materials[0]).toMatchObject({ summary: "短结论", points: ["要点1"] });
    expect(materials[0]).not.toHaveProperty("note_md");
  });
});
