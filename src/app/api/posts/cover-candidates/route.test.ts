/**
 * 封面候选 HTTP 触发面单测(D3):鉴权(仅会话)· 入参校验 · 结果映射。
 * 生图编排与鉴权实现全 mock,本单测只守路由自身的边界。
 */
import { describe, expect, it, vi, beforeEach } from "vitest";

const requireSessionActor = vi.hoisted(() => vi.fn());
vi.mock("@/lib/http/session-guard", () => ({ requireSessionActor }));

const requestCoverCandidates = vi.hoisted(() => vi.fn());
const discardCoverCandidates = vi.hoisted(() => vi.fn());
vi.mock("@/lib/ai/cover-candidates", () => ({
  requestCoverCandidates,
  discardCoverCandidates,
}));

import { DELETE, POST } from "./route";

function req(body: unknown, headers: Record<string, string> = {}) {
  return {
    headers: new Headers(headers),
    json: async () => body,
  } as unknown as Parameters<typeof POST>[0];
}

beforeEach(() => {
  vi.clearAllMocks();
  requireSessionActor.mockResolvedValue({ kind: "ok", sub: "7" });
});

describe("POST /api/posts/cover-candidates", () => {
  it("PAT 到场 → 403,不触达生成", async () => {
    requireSessionActor.mockResolvedValueOnce({
      kind: "reject",
      response: new Response("no", { status: 403 }),
    });
    const res = await POST(req({ postId: "9" }));
    expect(res.status).toBe(403);
    expect(requestCoverCandidates).not.toHaveBeenCalled();
  });

  it("postId 缺失/非法 → 400", async () => {
    expect((await POST(req({}))).status).toBe(400);
    expect((await POST(req({ postId: "abc" }))).status).toBe(400);
    expect(requestCoverCandidates).not.toHaveBeenCalled();
  });

  it("prompt 超长 → 400", async () => {
    expect((await POST(req({ postId: "9", prompt: "x".repeat(2001) }))).status).toBe(400);
  });

  it("成功 → 200 带 token 与候选", async () => {
    requestCoverCandidates.mockResolvedValueOnce({
      ok: true,
      token: "tok-1",
      candidates: [{ id: "c1", url: "/api/posts/cover-candidates/c1/raw" }],
    });
    const res = await POST(req({ postId: "9" }));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      code: 0,
      data: { token: "tok-1", candidates: [{ id: "c1" }] },
    });
  });

  it("文章不存在 → 404;生成失败/超时 → 502", async () => {
    requestCoverCandidates.mockResolvedValueOnce({
      ok: false,
      reason: "not_found",
      message: "无此文",
    });
    expect((await POST(req({ postId: "9" }))).status).toBe(404);

    requestCoverCandidates.mockResolvedValueOnce({
      ok: false,
      reason: "failed",
      message: "生图失败",
    });
    expect((await POST(req({ postId: "9" }))).status).toBe(502);
  });
});

describe("DELETE /api/posts/cover-candidates", () => {
  it("token 缺失 → 400,不清理", async () => {
    const res = await DELETE(req(null));
    expect(res.status).toBe(400);
    expect(discardCoverCandidates).not.toHaveBeenCalled();
  });

  it("token 合法 → 200 且清理临时件", async () => {
    const res = await DELETE(
      req(null, { "x-cover-token": "0123abcd-45ef-6789-abcd-0123456789ab" }),
    );
    expect(res.status).toBe(200);
    expect(discardCoverCandidates).toHaveBeenCalledWith("0123abcd-45ef-6789-abcd-0123456789ab");
  });
});
