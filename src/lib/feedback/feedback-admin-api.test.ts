/**
 * 反馈 admin API 守卫单测(M22 批⑤):GET/PUT 都在 requireAdminRequest
 * 之后(非 admin 401);PUT 侧 isSameOrigin → zod 值域 → 存在性 → 流转,
 * not_found 映射 404,操作者进审计日志。守卫/流转 lib 全 mock,只验路由接线。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const guardMock = vi.hoisted(() => ({ requireAdminRequest: vi.fn() }));
const adminMock = vi.hoisted(() => ({
  FEEDBACK_PAGE_SIZE: 15,
  FEEDBACK_LIST_SEGMENTS: ["all", "open", "processing", "resolved"],
  listFeedbackAdmin: vi.fn(),
  updateFeedbackStatus: vi.fn(),
  requireFeedback: vi.fn(),
  FeedbackAdminError: class extends Error {
    constructor(
      public code: string,
      message: string,
    ) {
      super(message);
    }
  },
}));
const loggerMock = vi.hoisted(() => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }));

vi.mock("@/lib/auth/guard", () => guardMock);
vi.mock("@/lib/feedback/feedback-admin", () => adminMock);
vi.mock("@/lib/logger", () => ({ logger: loggerMock }));
vi.mock("@/lib/http/origin", () => ({ isSameOrigin: () => true }));

const { GET } = await import("@/app/api/feedback/route");
const { PUT } = await import("@/app/api/feedback/[id]/route");

const req = (init?: { method?: string; body?: unknown; url?: string }) =>
  new Request(init?.url ?? "http://localhost:3000/api/feedback", {
    method: init?.method ?? "GET",
    headers: init?.body === undefined ? undefined : { "content-type": "application/json" },
    body: init?.body === undefined ? undefined : JSON.stringify(init.body),
  }) as never;

beforeEach(() => {
  guardMock.requireAdminRequest.mockReset();
  adminMock.listFeedbackAdmin.mockReset();
  adminMock.updateFeedbackStatus.mockReset();
  adminMock.requireFeedback.mockReset();
  adminMock.requireFeedback.mockResolvedValue(undefined);
  adminMock.updateFeedbackStatus.mockResolvedValue({ id: "7", status: "processing" });
  loggerMock.info.mockClear();
});

describe("GET /api/feedback", () => {
  it("非 admin:401,不触列表", async () => {
    guardMock.requireAdminRequest.mockResolvedValue(null);
    const res = await GET(req());
    expect(res.status).toBe(401);
    expect(adminMock.listFeedbackAdmin).not.toHaveBeenCalled();
  });

  it("admin:分段/页码/搜索参数解析进 lib", async () => {
    guardMock.requireAdminRequest.mockResolvedValue({ sub: "1", role: "admin" });
    adminMock.listFeedbackAdmin.mockResolvedValue({ items: [], total: 0, counts: {} });

    const res = await GET(
      req({ url: "http://localhost:3000/api/feedback?status=open&page=2&q=头像" }),
    );
    expect(res.status).toBe(200);
    expect(adminMock.listFeedbackAdmin).toHaveBeenCalledWith({
      page: 2,
      segment: "open",
      q: "头像",
    });
  });

  it("非法分段/页码回落默认(all/1)", async () => {
    guardMock.requireAdminRequest.mockResolvedValue({ sub: "1", role: "admin" });
    adminMock.listFeedbackAdmin.mockResolvedValue({ items: [], total: 0, counts: {} });

    await GET(req({ url: "http://localhost:3000/api/feedback?status=zzz&page=-3" }));
    expect(adminMock.listFeedbackAdmin).toHaveBeenCalledWith({
      page: 1,
      segment: "all",
      q: undefined,
    });
  });
});

describe("PUT /api/feedback/[id]", () => {
  it("非 admin:401,不触流转", async () => {
    guardMock.requireAdminRequest.mockResolvedValue(null);
    const res = await PUT(req({ method: "PUT", body: { status: "processing" } }), {
      params: Promise.resolve({ id: "7" }),
    });
    expect(res.status).toBe(401);
    expect(adminMock.updateFeedbackStatus).not.toHaveBeenCalled();
  });

  it("admin:按 id 流转,操作者进审计日志", async () => {
    guardMock.requireAdminRequest.mockResolvedValue({ sub: "1", role: "admin" });

    const res = await PUT(
      req({ method: "PUT", body: { status: "processing", adminNote: "已排期" } }),
      { params: Promise.resolve({ id: "7" }) },
    );
    const body = (await res.json()) as { code: number };
    expect(res.status).toBe(200);
    expect(body.code).toBe(0);
    expect(adminMock.updateFeedbackStatus).toHaveBeenCalledWith(BigInt(7), "processing", "已排期");
    expect(loggerMock.info).toHaveBeenCalledWith(
      expect.objectContaining({ event: "admin.feedback.status_changed", operatorId: "1" }),
    );
  });

  it("非法 status 值域:400,不触流转", async () => {
    guardMock.requireAdminRequest.mockResolvedValue({ sub: "1", role: "admin" });

    const res = await PUT(req({ method: "PUT", body: { status: "closed" } }), {
      params: Promise.resolve({ id: "7" }),
    });
    expect(res.status).toBe(400);
    expect(adminMock.updateFeedbackStatus).not.toHaveBeenCalled();
  });

  it("id 不存在:404(requireFeedback 业务错误映射)", async () => {
    guardMock.requireAdminRequest.mockResolvedValue({ sub: "1", role: "admin" });
    adminMock.requireFeedback.mockRejectedValue(
      new adminMock.FeedbackAdminError("not_found", "反馈不存在"),
    );

    const res = await PUT(req({ method: "PUT", body: { status: "resolved" } }), {
      params: Promise.resolve({ id: "99" }),
    });
    expect(res.status).toBe(404);
    expect(adminMock.updateFeedbackStatus).not.toHaveBeenCalled();
  });

  it("非数字 id:400", async () => {
    guardMock.requireAdminRequest.mockResolvedValue({ sub: "1", role: "admin" });

    const res = await PUT(req({ method: "PUT", body: { status: "resolved" } }), {
      params: Promise.resolve({ id: "abc" }),
    });
    expect(res.status).toBe(400);
    expect(adminMock.requireFeedback).not.toHaveBeenCalled();
  });
});
