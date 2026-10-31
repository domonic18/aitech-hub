/**
 * 内部失效端点单测(2026-10-31):鉴权对称 token + 定向失效白名单是安全红线,
 * 端点绝不能因 body 变成任意路径的缓存清除器。`next/cache` 与 env 全 mock,无真库。
 */
import { createHash } from "node:crypto";

import { describe, expect, it, vi, beforeEach } from "vitest";

const { SECRET, revalidatePath } = vi.hoisted(() => ({
  SECRET: "test-secret-0123456789abcdef",
  revalidatePath: vi.fn(),
}));

vi.mock("next/cache", () => ({ revalidatePath }));
vi.mock("@/lib/env", () => ({ env: { AUTH_SECRET: SECRET } }));

import { POST } from "./route";

const TOKEN = createHash("sha256").update(`${SECRET}:revalidate`).digest("hex");

function req(body: string, token: string | null = TOKEN) {
  return {
    headers: new Headers(token === null ? {} : { "x-internal-token": token }),
    text: async () => body,
  } as unknown as Parameters<typeof POST>[0];
}

describe("POST /api/internal/revalidate", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("token 缺失/长度不符/值错 → 403,不动缓存", async () => {
    expect((await POST(req("", null))).status).toBe(403);
    expect((await POST(req("", "deadbeef"))).status).toBe(403); // 长度不同
    expect((await POST(req("", "0".repeat(TOKEN.length)))).status).toBe(403); // 同长错值
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("空 body(entrypoint 老口径)→ 全站失效 + SEO 路由,行为与扩展前一致", async () => {
    const res = await POST(req(""));
    expect(res.status).toBe(200);
    expect(revalidatePath).toHaveBeenCalledWith("/", "layout");
    expect(revalidatePath).toHaveBeenCalledWith("/sitemap.xml");
  });

  it("合法 paths → 只失效白名单内的路径", async () => {
    const res = await POST(req(JSON.stringify({ paths: ["/leaderboards/"] })));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ revalidated: true, paths: ["/leaderboards/"] });
    expect(revalidatePath).toHaveBeenCalledTimes(1);
    expect(revalidatePath).toHaveBeenCalledWith("/leaderboards/");
  });

  it("白名单外路径 → 400 且一条都不失效(防越权清缓存)", async () => {
    const res = await POST(req(JSON.stringify({ paths: ["/leaderboards/", "/articles/"] })));
    expect(res.status).toBe(400);
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("非法 JSON / 结构不符 → 按空 body 全站失效(向后兼容)", async () => {
    expect((await POST(req("{"))).status).toBe(200);
    expect((await POST(req(JSON.stringify({ paths: [] })))).status).toBe(200);
    expect(revalidatePath).toHaveBeenCalledWith("/", "layout");
  });
});
