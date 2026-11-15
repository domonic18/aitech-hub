/**
 * 素材包导出路由单测(D5/B3):鉴权(仅会话)· id 校验 · 不存在 404。
 * 拼装逻辑全 mock,本单测只守路由边界。
 */
import { describe, expect, it, vi, beforeEach } from "vitest";

const requireSessionActor = vi.hoisted(() => vi.fn());
vi.mock("@/lib/http/session-guard", () => ({ requireSessionActor }));

const buildTopicExportBundle = vi.hoisted(() => vi.fn());
vi.mock("@/lib/topics/export-bundle", () => ({ buildTopicExportBundle }));

import { TopicError } from "@/lib/topics/errors";

import { GET } from "./route";

function req() {
  return { headers: new Headers() } as unknown as Parameters<typeof GET>[0];
}

async function call(id: string) {
  return GET(req(), { params: Promise.resolve({ id }) });
}

beforeEach(() => {
  vi.clearAllMocks();
  requireSessionActor.mockResolvedValue({ kind: "ok", sub: "7" });
});

describe("GET /api/topics/[id]/export", () => {
  it("PAT 到场 → 403,不导出", async () => {
    requireSessionActor.mockResolvedValueOnce({
      kind: "reject",
      response: new Response("no", { status: 403 }),
    });
    expect((await call("9")).status).toBe(403);
    expect(buildTopicExportBundle).not.toHaveBeenCalled();
  });

  it("id 非法 → 400", async () => {
    expect((await call("abc")).status).toBe(400);
    expect(buildTopicExportBundle).not.toHaveBeenCalled();
  });

  it("创作不存在 → 404", async () => {
    buildTopicExportBundle.mockRejectedValueOnce(new TopicError("not_found", "专题不存在"));
    expect((await call("9")).status).toBe(404);
  });

  it("成功 → 200 带素材包", async () => {
    buildTopicExportBundle.mockResolvedValueOnce({ topic: { id: "9" }, materials: [] });
    const res = await call("9");
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ code: 0, data: { topic: { id: "9" } } });
    expect(buildTopicExportBundle).toHaveBeenCalledWith(BigInt(9));
  });
});
