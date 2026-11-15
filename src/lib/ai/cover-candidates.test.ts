/**
 * 封面候选编排单测(D3 的 HTTP 触发面与 agent 工具共用一份):
 * 复用/入队/轮询四路 + 失败断路(生图失败清临时件、超时、模型未绑定)、
 * 采纳入库与设封面降级、放弃清临时件。生成管线与媒体库全 mock。
 */
import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("@/lib/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

const adoptCoverCandidate = vi.hoisted(() => vi.fn());
const deleteCoverTemp = vi.hoisted(() => vi.fn());
const enqueueCoverGen = vi.hoisted(() => vi.fn());
const listHeldCandidatesForPost = vi.hoisted(() => vi.fn());
const loadCoverPostContext = vi.hoisted(() => vi.fn());
const probeCoverGen = vi.hoisted(() => vi.fn());
vi.mock("@/lib/ai/cover-generate", () => ({
  adoptCoverCandidate,
  deleteCoverTemp,
  enqueueCoverGen,
  listHeldCandidatesForPost,
  loadCoverPostContext,
  probeCoverGen,
}));

const updatePostCover = vi.hoisted(() => vi.fn());
vi.mock("@/lib/content/posts-admin", () => ({ updatePostCover }));

const pollUntil = vi.hoisted(() => vi.fn());
vi.mock("@/lib/ai/poll", () => ({ pollUntil }));

import { AiAdminError } from "@/lib/ai/errors";

import {
  adoptCoverForPost,
  discardCoverCandidates,
  requestCoverCandidates,
} from "./cover-candidates";

const CTX = { title: "标题", excerpt: "摘要", tags: ["AI"], contentMd: "正文" };

beforeEach(() => {
  vi.resetAllMocks();
  loadCoverPostContext.mockResolvedValue(CTX);
  listHeldCandidatesForPost.mockResolvedValue([]);
  enqueueCoverGen.mockResolvedValue({ jobId: "j1", token: "tok-1" });
  pollUntil.mockImplementation(async (probe: () => Promise<unknown>) => probe());
});

describe("requestCoverCandidates", () => {
  it("文章不存在 → not_found", async () => {
    loadCoverPostContext.mockResolvedValueOnce(null);
    await expect(requestCoverCandidates({ postId: "9" })).resolves.toMatchObject({
      ok: false,
      reason: "not_found",
    });
    expect(enqueueCoverGen).not.toHaveBeenCalled();
  });

  it("正常出图 → 候选 id + 预览路径(hold 不入媒体库)", async () => {
    probeCoverGen.mockResolvedValueOnce({ rows: [{ id: "c1" }, { id: "c2" }] });
    const r = await requestCoverCandidates({ postId: "9", prompt: "p" });
    expect(r).toMatchObject({
      ok: true,
      candidates: [
        { id: "c1", url: "/api/posts/cover-candidates/c1/raw" },
        { id: "c2", url: "/api/posts/cover-candidates/c2/raw" },
      ],
    });
    expect(enqueueCoverGen).toHaveBeenCalledWith(
      expect.objectContaining({ hold: true, postId: "9", prompt: "p" }),
    );
    expect(adoptCoverCandidate).not.toHaveBeenCalled();
  });

  it("已有存活 hold 候选 → 直接复用,零入队零轮询", async () => {
    listHeldCandidatesForPost.mockResolvedValueOnce([
      { id: "h1", token: "tok-h", mediaPath: "/tmp/x" },
      { id: "h2", token: "tok-h", mediaPath: "/tmp/y" },
    ]);
    const r = await requestCoverCandidates({ postId: "9" });
    expect(r).toMatchObject({ ok: true, token: "tok-h", candidates: [{ id: "h1" }, { id: "h2" }] });
    expect(enqueueCoverGen).not.toHaveBeenCalled();
    expect(pollUntil).not.toHaveBeenCalled();
  });

  it("生图失败 → 清临时件并断路(不傻等)", async () => {
    probeCoverGen.mockResolvedValueOnce({ failure: "模型超时" });
    const r = await requestCoverCandidates({ postId: "9" });
    expect(r).toMatchObject({ ok: false, reason: "failed" });
    expect(deleteCoverTemp).toHaveBeenCalled();
  });

  it("轮询兜底超时 → timeout", async () => {
    pollUntil.mockResolvedValueOnce(null);
    await expect(requestCoverCandidates({ postId: "9" })).resolves.toMatchObject({
      ok: false,
      reason: "timeout",
    });
  });

  it("封面模型未绑定 → disabled(不入队)", async () => {
    enqueueCoverGen.mockRejectedValueOnce(new AiAdminError("disabled", "未绑定封面模型"));
    await expect(requestCoverCandidates({ postId: "9" })).resolves.toMatchObject({
      ok: false,
      reason: "disabled",
      message: "未绑定封面模型",
    });
  });
});

describe("adoptCoverForPost", () => {
  it("入库成功且设封面成功 → coverSet true", async () => {
    adoptCoverCandidate.mockResolvedValueOnce("/wp-content/uploads/2026/11/a.png");
    await expect(adoptCoverForPost({ candidateId: "c1", postId: "9" })).resolves.toEqual({
      path: "/wp-content/uploads/2026/11/a.png",
      coverSet: true,
    });
    expect(updatePostCover).toHaveBeenCalledWith(BigInt(9), "/wp-content/uploads/2026/11/a.png");
  });

  it("设封面失败 → 入库不回滚,降级带 coverError", async () => {
    adoptCoverCandidate.mockResolvedValueOnce("/wp-content/uploads/2026/11/a.png");
    updatePostCover.mockRejectedValueOnce(new Error("pg 无此行"));
    const r = await adoptCoverForPost({ candidateId: "c1", postId: "9" });
    expect(r).toMatchObject({ coverSet: false, coverError: "pg 无此行" });
  });
});

describe("discardCoverCandidates", () => {
  it("清临时件", async () => {
    await discardCoverCandidates("tok-h");
    expect(deleteCoverTemp).toHaveBeenCalledWith("tok-h");
  });
});
