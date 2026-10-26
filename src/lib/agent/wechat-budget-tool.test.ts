/**
 * 码点预算自查工具单测(M30 批③):admin 会话防线(fail-closed)/载荷四段
 * 分解与超限判定/建议文案两分支(超预算必精简 vs 预算健康)。计量走真函数
 * (纯渲染零 IO),仅 mock 会话行。
 */
import { describe, expect, it, vi, beforeEach } from "vitest";

const sessionFindUnique = vi.hoisted(() => vi.fn());
vi.mock("../db", () => ({
  prisma: { searchAgentSession: { findUnique: sessionFindUnique } },
}));
vi.mock("../logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

import { measureWechatBudgetTool } from "./wechat-budget-tool";

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
  vi.resetAllMocks();
});

describe("measure_wechat_budget", () => {
  it("非 admin 会话 / 无 threadId → 全拒且不触达渲染", async () => {
    sessionFindUnique.mockResolvedValueOnce({ visitorId: "user:u1" });
    const r = await invoke(measureWechatBudgetTool, { content_md: "# t" });
    expect(r).toMatchObject({ ok: false });

    const raw = (await measureWechatBudgetTool.invoke(
      { content_md: "# t" } as never,
      {} as never,
    )) as string;
    expect(JSON.parse(raw)).toMatchObject({ ok: false });
  });

  it("预算健康:四段分解 + usagePct<85 → 建议可直接交稿", async () => {
    sessionFindUnique.mockResolvedValueOnce(ADMIN_OK);
    const r = await invoke(measureWechatBudgetTool, { content_md: "# 短文\n\n一段话。" });
    expect(r).toMatchObject({ ok: true, over_budget: false });
    expect(r.total_chars as number).toBeLessThan(r.limit as number);
    expect(r.markup_chars as number).toBe((r.total_chars as number) - (r.plain_chars as number));
    expect(String(r.suggestion)).toContain("可直接交稿");
  });

  it("超预算:over_budget=true → 建议给精简优先级与复核要求", async () => {
    sessionFindUnique.mockResolvedValueOnce(ADMIN_OK);
    const r = await invoke(measureWechatBudgetTool, { content_md: "超长".repeat(15_000) });
    expect(r).toMatchObject({ ok: true, over_budget: true });
    expect(r.total_chars as number).toBeGreaterThan(r.limit as number);
    expect(String(r.suggestion)).toContain("精简");
    expect(String(r.suggestion)).toContain("复核");
  });
});
