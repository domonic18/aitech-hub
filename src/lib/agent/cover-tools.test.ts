/**
 * 编辑页封面工具单测(M31 建,2026-10-20 auto 档扩展):admin 会话防线 /
 * auto 档零 interrupt 直接采纳(held 复用零重入队、入库与设封面失败口径、
 * 超时/生图失败断路)/ 手动档 interrupt adopt/discard 两路与异常 resume 兜底。
 * 生成管线、媒体库、落库全 mock;LangGraph interrupt 桩收答案模拟 resume。
 */
import { describe, expect, it, vi, beforeEach } from "vitest";

const interrupt = vi.hoisted(() => vi.fn());
vi.mock("@langchain/langgraph", () => ({ interrupt }));

vi.mock("../logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

const adoptCoverCandidate = vi.hoisted(() => vi.fn());
const deleteCoverTemp = vi.hoisted(() => vi.fn());
const enqueueCoverGen = vi.hoisted(() => vi.fn());
const listHeldCandidatesForPost = vi.hoisted(() => vi.fn());
const loadCoverPostContext = vi.hoisted(() => vi.fn());
const probeCoverGen = vi.hoisted(() => vi.fn());
vi.mock("../ai/cover-generate", () => ({
  adoptCoverCandidate,
  deleteCoverTemp,
  enqueueCoverGen,
  listHeldCandidatesForPost,
  loadCoverPostContext,
  probeCoverGen,
}));

const updatePostCover = vi.hoisted(() => vi.fn());
vi.mock("../content/posts-admin", () => ({ updatePostCover }));

const assertAdminThread = vi.hoisted(() => vi.fn());
const adminThreadDeny = vi.hoisted(() =>
  vi.fn((_tid: unknown, scope: string) => JSON.stringify({ ok: false, error: `非${scope}会话` })),
);
vi.mock("./admin-thread", () => ({ adminThreadDeny, assertAdminThread }));

const pollUntil = vi.hoisted(() => vi.fn());
vi.mock("./poll", () => ({ pollUntil }));

import { generatePostCoverTool } from "./cover-tools";

const CTX = {
  title: "WorkBuddy 实战",
  excerpt: "e",
  tags: ["AI"],
  contentMd: "正文取样",
};

const FRESH_ROWS = [
  { id: "c1", path: null, prompt: "p", createdAt: new Date() },
  { id: "c2", path: null, prompt: "p", createdAt: new Date() },
];

/** 工具体内 token 是本地 randomUUID(非 enqueue 返回值):从入队入参捕获对账 */
function enqueuedToken(): string {
  const arg = enqueueCoverGen.mock.calls.at(-1)?.[0] as { token: string } | undefined;
  return arg?.token ?? "";
}

async function invoke(args: Record<string, unknown>): Promise<Record<string, unknown>> {
  const raw = (await generatePostCoverTool.invoke(
    args as never,
    {
      configurable: { thread_id: "t-admin" },
    } as never,
  )) as string;
  return JSON.parse(raw) as Record<string, unknown>;
}

beforeEach(() => {
  vi.resetAllMocks();
  assertAdminThread.mockResolvedValue(true);
  loadCoverPostContext.mockResolvedValue(CTX);
  listHeldCandidatesForPost.mockResolvedValue([]);
  enqueueCoverGen.mockResolvedValue({ jobId: "j1", token: "tok-1" });
  // 轮询桩透传 probe:probeCoverGen 的逐例 mock 即轮询结果(零延时),探测
  // 闭包真被执行——比直接桩 pollUntil 返回值更贴近现实
  pollUntil.mockImplementation(async (probe: () => Promise<unknown>) => probe());
});

describe("admin 会话防线与前置校验", () => {
  it("非 admin 会话 → 拒且不触达文章读取", async () => {
    assertAdminThread.mockResolvedValueOnce(false);
    await expect(invoke({ id: "9" })).resolves.toMatchObject({ ok: false });
    expect(loadCoverPostContext).not.toHaveBeenCalled();
  });

  it("文章不存在 → ok:false 人话", async () => {
    loadCoverPostContext.mockResolvedValueOnce(null);
    await expect(invoke({ id: "9" })).resolves.toMatchObject({
      ok: false,
      error: expect.stringContaining("不存在"),
    });
  });
});

describe("auto 档(专题合成免确认,2026-10-20)", () => {
  it("候选就绪直接采纳第一张并设封面:interrupt 零调用、零挂起", async () => {
    probeCoverGen.mockResolvedValueOnce({ rows: FRESH_ROWS });
    adoptCoverCandidate.mockResolvedValueOnce("/wp-content/uploads/2026/10/a.png");
    const out = await invoke({ id: "9", prompt: "高质量提示词", auto_adopt: true });
    expect(out).toMatchObject({
      ok: true,
      decision: "adopt",
      auto: true,
      path: "/wp-content/uploads/2026/10/a.png",
    });
    expect(String(out.summary)).toContain("自动生成并采用");
    expect(interrupt).not.toHaveBeenCalled();
    expect(enqueueCoverGen).toHaveBeenCalledWith(
      expect.objectContaining({ hold: true, postId: "9" }),
    );
    expect(adoptCoverCandidate).toHaveBeenCalledWith("c1");
    expect(updatePostCover).toHaveBeenCalledWith(BigInt(9), "/wp-content/uploads/2026/10/a.png");
    expect(deleteCoverTemp).not.toHaveBeenCalled();
  });

  it("held 候选复用:零重入队零轮询,仍走 auto 采纳", async () => {
    listHeldCandidatesForPost.mockResolvedValueOnce([
      { id: "h1", token: "tok-h", path: null, prompt: "", createdAt: new Date() },
      { id: "h2", token: "tok-h", path: null, prompt: "", createdAt: new Date() },
    ]);
    adoptCoverCandidate.mockResolvedValueOnce("/wp-content/uploads/2026/10/h.png");
    const out = await invoke({ id: "9", auto_adopt: true });
    expect(out).toMatchObject({ ok: true, auto: true, path: "/wp-content/uploads/2026/10/h.png" });
    expect(enqueueCoverGen).not.toHaveBeenCalled();
    expect(pollUntil).not.toHaveBeenCalled();
    expect(adoptCoverCandidate).toHaveBeenCalledWith("h1");
  });

  it("设封面失败降级 ok:true(入库不回滚,提示手动选用)", async () => {
    probeCoverGen.mockResolvedValueOnce({ rows: FRESH_ROWS });
    adoptCoverCandidate.mockResolvedValueOnce("/wp-content/uploads/2026/10/a.png");
    updatePostCover.mockRejectedValueOnce(new Error("pg 无此行"));
    const out = await invoke({ id: "9", auto_adopt: true });
    expect(out).toMatchObject({ ok: true, auto: true, path: "/wp-content/uploads/2026/10/a.png" });
    expect(String(out.summary)).toContain("手动选用");
  });

  it("入库失败 → ok:false 人话;超时/生图失败断路(失败清临时件)", async () => {
    probeCoverGen.mockResolvedValueOnce({ rows: FRESH_ROWS });
    adoptCoverCandidate.mockRejectedValueOnce(new Error("媒体库写入失败"));
    await expect(invoke({ id: "9", auto_adopt: true })).resolves.toMatchObject({
      ok: false,
      error: "媒体库写入失败",
    });

    probeCoverGen.mockResolvedValueOnce(null);
    await expect(invoke({ id: "9", auto_adopt: true })).resolves.toMatchObject({
      ok: false,
      timeout: true,
    });

    probeCoverGen.mockResolvedValueOnce({ failure: "模型超时" });
    await expect(invoke({ id: "9", auto_adopt: true })).resolves.toMatchObject({
      ok: false,
      error: expect.stringContaining("生图失败"),
    });
    expect(deleteCoverTemp).toHaveBeenCalledWith(enqueuedToken());
  });
});

describe("手动档(默认,两段 ask_user 后调用)", () => {
  it("interrupt adopt:入库并设封面;discard:清临时件不入库", async () => {
    probeCoverGen.mockResolvedValueOnce({ rows: FRESH_ROWS });
    adoptCoverCandidate.mockResolvedValueOnce("/wp-content/uploads/2026/10/a.png");
    interrupt.mockReturnValueOnce({ decision: "adopt", candidateId: "c2" });
    const out = await invoke({ id: "9", prompt: "p" });
    expect(out).toMatchObject({
      ok: true,
      decision: "adopt",
      path: "/wp-content/uploads/2026/10/a.png",
    });
    expect(interrupt).toHaveBeenCalledTimes(1);
    expect(adoptCoverCandidate).toHaveBeenCalledWith("c2");
    expect(updatePostCover).toHaveBeenCalled();

    probeCoverGen.mockResolvedValueOnce({ rows: FRESH_ROWS });
    interrupt.mockReturnValueOnce({ decision: "discard" });
    const out2 = await invoke({ id: "9", prompt: "p" });
    expect(out2).toMatchObject({ ok: true, decision: "discard" });
    expect(deleteCoverTemp).toHaveBeenCalledWith(enqueuedToken());
    expect(adoptCoverCandidate).toHaveBeenCalledTimes(1); // 未新增入库
  });

  it("interrupt 载荷形状异常同 discard 清临时件(不误入库)", async () => {
    probeCoverGen.mockResolvedValueOnce({ rows: FRESH_ROWS });
    interrupt.mockReturnValueOnce({ decision: "whatever" });
    const out = await invoke({ id: "9", prompt: "p" });
    expect(out).toMatchObject({ ok: true, decision: "discard" });
    expect(adoptCoverCandidate).not.toHaveBeenCalled();
    expect(deleteCoverTemp).toHaveBeenCalledWith(enqueuedToken());
  });
});
