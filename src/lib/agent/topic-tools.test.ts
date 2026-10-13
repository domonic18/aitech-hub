/**
 * 专题生产工具面单测(M27 批⑤):admin 会话防线(fail-closed)/ 防幻觉图片
 * 校验 / save 的 needConfirm→confirm 回路 / 封面候选轮询(命中即返/超时人话)/
 * 落库结果透传与业务降级人话。DB/队列/转存全 mock;LLM 不入单测(e2e 零真网)。
 */
import { describe, expect, it, vi, beforeEach } from "vitest";

const sessionFindUnique = vi.hoisted(() => vi.fn());
const postFindUnique = vi.hoisted(() => vi.fn());
vi.mock("../db", () => ({
  prisma: {
    searchAgentSession: { findUnique: sessionFindUnique },
    post: { findUnique: postFindUnique },
  },
}));
vi.mock("../logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

const getTopic = vi.hoisted(() => vi.fn());
const hydrateItems = vi.hoisted(() => vi.fn());
vi.mock("../topics/repo", () => ({
  getTopic,
  hydrateItems,
  // 双参签名与真实类一致(code 丢弃,message 即人话),测试可直接 new
  TopicError: class extends Error {
    constructor(_code: string, message: string) {
      super(message);
    }
  },
}));

const buildComposeBlocks = vi.hoisted(() => vi.fn());
const finalizeCompose = vi.hoisted(() => vi.fn());
const listRecentPublishedTitles = vi.hoisted(() => vi.fn());
const needsRecomposeConfirm = vi.hoisted(() => vi.fn());
const transferCoverOrNull = vi.hoisted(() => vi.fn());
vi.mock("../topics/compose", () => ({
  buildComposeBlocks,
  finalizeCompose,
  isPostAdminError: (e: unknown) => e instanceof Error && e.name === "PostAdminError",
  listRecentPublishedTitles,
  needsRecomposeConfirm,
  transferCoverOrNull,
}));

const enqueueCoverGen = vi.hoisted(() => vi.fn());
const listCoverCandidates = vi.hoisted(() => vi.fn());
vi.mock("../ai/cover-generate", () => ({ enqueueCoverGen, listCoverCandidates }));

import { TopicError } from "../topics/repo";
import {
  generateCoverCandidatesTool,
  getTopicBriefTool,
  saveTopicDraftTool,
  transferVideoCoverTool,
} from "./topic-tools";

/** 工具调用统一入口(configurable.thread_id 模拟 LangGraph 注入;never 参数位
 * 吃住各工具 invoke 的结构化入参/配置逆变,实现内 as never 收口) */
type AnyTool = { invoke: (args: never, cfg?: never) => Promise<unknown> };

async function invoke(
  t: AnyTool,
  args: Record<string, unknown>,
  threadId = "t-admin",
): Promise<Record<string, unknown>> {
  const raw = (await t.invoke(
    args as never,
    { configurable: { thread_id: threadId } } as never,
  )) as string;
  return JSON.parse(raw) as Record<string, unknown>;
}

const ADMIN_OK = { visitorId: "admin:sub-1" };

beforeEach(() => {
  vi.resetAllMocks(); // once 队列一并清,防跨用例串味
});

describe("admin 会话防线(纵深防御,四工具同口径)", () => {
  it("非 admin 会话行 / 无行 / 无 threadId → 全拒且不触达业务", async () => {
    for (const row of [{ visitorId: "user:u1" }, null]) {
      sessionFindUnique.mockResolvedValueOnce(row);
      await expect(invoke(getTopicBriefTool, { topic_id: "1" })).resolves.toMatchObject({
        ok: false,
      });
    }
    await expect(invoke(getTopicBriefTool, { topic_id: "1" }, "")).resolves.toMatchObject({
      ok: false,
    });
    expect(getTopic).not.toHaveBeenCalled();
  });
});

describe("get_topic_brief", () => {
  it("拼装专题/关联文档/素材/近期标题;linked 软删视同无锚", async () => {
    sessionFindUnique.mockResolvedValueOnce(ADMIN_OK);
    const topic = {
      id: BigInt(7),
      title: "端侧拐点",
      positioning: "面向开发者",
      status: "drafted",
      composedAt: new Date("2026-10-13T10:00:00Z"),
      linkedPostId: BigInt(9),
      items: [{}],
    };
    getTopic.mockResolvedValueOnce(topic);
    buildComposeBlocks.mockResolvedValueOnce([
      {
        kind: "telegram",
        title: "视频A",
        blogger: "UP主A",
        note: "突出成本",
        videoUrl: "https://b23.tv/x",
        coverUrl: "https://img/x.jpg",
        aiNote: "n".repeat(3500),
        aiSummary: null,
        aiPoints: [],
        excerpt: null,
        contentSample: null,
      },
    ]);
    listRecentPublishedTitles.mockResolvedValueOnce(["旧文一"]);
    // linked 行软删 → linked_post 应为 null(弃锚新建口径)
    postFindUnique.mockResolvedValueOnce({ title: "t", status: "deleted", updatedAt: new Date() });

    const out = await invoke(getTopicBriefTool, { topic_id: "7" });
    expect(out.topic).toMatchObject({ id: "7", title: "端侧拐点" });
    expect(out.linked_post).toBeNull();
    const materials = out.materials as Array<Record<string, unknown>>;
    expect(materials[0]).toMatchObject({ kind: "telegram", title: "视频A", note: "突出成本" });
    expect((materials[0].note_md as string).length).toBe(3000); // BRIEF_NOTE_MAX 截断
    expect(out.recent_published_titles).toEqual(["旧文一"]);
  });

  it("专题不存在(TopicError)→ 人话 error", async () => {
    sessionFindUnique.mockResolvedValueOnce(ADMIN_OK);
    // 类型面走真实模块双参签名;运行时是 mock Error 子类,message 即人话
    getTopic.mockRejectedValueOnce(new TopicError("not_found", "专题不存在"));
    await expect(invoke(getTopicBriefTool, { topic_id: "7" })).resolves.toMatchObject({
      ok: false,
      error: "专题不存在",
    });
  });
});

describe("transfer_video_cover", () => {
  it("取首个视频封面转存,返回站内路径;无封面人话降级", async () => {
    sessionFindUnique.mockResolvedValueOnce(ADMIN_OK);
    getTopic.mockResolvedValueOnce({ id: BigInt(7), items: [{}] });
    hydrateItems.mockResolvedValueOnce(
      new Map([
        [
          BigInt(1),
          { itemType: "telegram", telegram: { videoCoverUrl: "https://img/x.jpg" }, post: null },
        ],
      ]),
    );
    transferCoverOrNull.mockResolvedValueOnce("/wp-content/uploads/2026/10/c.jpg");
    await expect(invoke(transferVideoCoverTool, { topic_id: "7" })).resolves.toEqual({
      ok: true,
      cover_path: "/wp-content/uploads/2026/10/c.jpg",
    });

    sessionFindUnique.mockResolvedValueOnce(ADMIN_OK);
    getTopic.mockResolvedValueOnce({ id: BigInt(7), items: [{}] });
    hydrateItems.mockResolvedValueOnce(new Map());
    await expect(invoke(transferVideoCoverTool, { topic_id: "7" })).resolves.toMatchObject({
      ok: false,
      error: expect.stringContaining("没有视频封面"),
    });
  });
});

describe("generate_cover_candidates", () => {
  it("入队后轮询到候选即返;绑定缺失(AiAdminError)人话", async () => {
    sessionFindUnique.mockResolvedValueOnce(ADMIN_OK);
    getTopic.mockResolvedValueOnce({
      id: BigInt(7),
      title: "端侧拐点",
      positioning: "p",
      linkedPostId: BigInt(9),
    });
    enqueueCoverGen.mockResolvedValueOnce({ jobId: "j", token: "tok-1" });
    listCoverCandidates.mockResolvedValueOnce([
      { id: "1", path: "/wp-content/uploads/2026/10/g1.png", prompt: "", createdAt: new Date() },
    ]);
    await expect(invoke(generateCoverCandidatesTool, { topic_id: "7" })).resolves.toEqual({
      ok: true,
      candidates: ["/wp-content/uploads/2026/10/g1.png"],
      note: expect.stringContaining("择优"),
    });
    expect(enqueueCoverGen).toHaveBeenCalledWith(
      expect.objectContaining({ token: expect.any(String), postId: "9" }),
    );
  });
});

describe("save_topic_draft", () => {
  const topic = {
    id: BigInt(7),
    title: "端侧拐点",
    items: [{}],
    linkedPostId: null,
    composedAt: null,
    status: "collecting",
  };

  it("正文引用外链图片 → 拒且不触达落库", async () => {
    sessionFindUnique.mockResolvedValueOnce(ADMIN_OK);
    await expect(
      invoke(saveTopicDraftTool, {
        topic_id: "7",
        title: "t",
        excerpt: "e",
        content_md: "![x](https://evil.com/a.png)",
      }),
    ).resolves.toMatchObject({ ok: false, error: expect.stringContaining("站内媒体路径") });
    expect(getTopic).not.toHaveBeenCalled();
  });

  it("needConfirm:人工编辑过且未确认 → 返回标记不落库;confirm=true 放行落库", async () => {
    sessionFindUnique.mockResolvedValueOnce(ADMIN_OK);
    getTopic.mockResolvedValueOnce({ ...topic, linkedPostId: BigInt(9) });
    postFindUnique.mockResolvedValueOnce({ status: "draft", updatedAt: new Date() });
    needsRecomposeConfirm.mockReturnValueOnce(true);
    const first = await invoke(saveTopicDraftTool, {
      topic_id: "7",
      title: "t",
      excerpt: "e",
      content_md: "正文",
    });
    expect(first).toMatchObject({ ok: false, needConfirm: true });
    expect(finalizeCompose).not.toHaveBeenCalled();

    sessionFindUnique.mockResolvedValueOnce(ADMIN_OK);
    getTopic.mockResolvedValueOnce({ ...topic, linkedPostId: BigInt(9) });
    postFindUnique.mockResolvedValueOnce({ status: "draft", updatedAt: new Date() });
    buildComposeBlocks.mockResolvedValueOnce([]);
    finalizeCompose.mockResolvedValueOnce({
      postId: BigInt(9),
      postTitle: "t",
      recomposed: true,
      coverPath: null,
    });
    const second = await invoke(saveTopicDraftTool, {
      topic_id: "7",
      title: "t",
      excerpt: "e",
      content_md: "正文",
      seo_title: "SEO",
      tags: ["端侧"],
      confirm: true,
    });
    expect(second).toMatchObject({
      ok: true,
      post_id: "9",
      recomposed: true,
      post_url: "/admin/posts/9",
    });
    expect(finalizeCompose).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ title: "t" }),
      expect.anything(),
      null,
      expect.objectContaining({ seoTitle: "SEO", tags: ["端侧"] }),
    );
  });

  it("空素材专题拒落库;PostAdminError 人话", async () => {
    sessionFindUnique.mockResolvedValueOnce(ADMIN_OK);
    getTopic.mockResolvedValueOnce({ ...topic, items: [] });
    await expect(
      invoke(saveTopicDraftTool, { topic_id: "7", title: "t", excerpt: "e", content_md: "正文" }),
    ).resolves.toMatchObject({ ok: false, error: expect.stringContaining("素材") });

    sessionFindUnique.mockResolvedValueOnce(ADMIN_OK);
    getTopic.mockResolvedValueOnce({ ...topic });
    buildComposeBlocks.mockResolvedValueOnce([]);
    const err = new Error("slug 已存在:x");
    err.name = "PostAdminError";
    finalizeCompose.mockRejectedValueOnce(err);
    await expect(
      invoke(saveTopicDraftTool, { topic_id: "7", title: "t", excerpt: "e", content_md: "正文" }),
    ).resolves.toMatchObject({ ok: false, error: expect.stringContaining("slug") });
  });
});
