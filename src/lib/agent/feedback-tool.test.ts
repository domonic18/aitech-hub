/**
 * submit_feedback 工具单测(M22 批⑤):工具面唯一可写口的落库口径——
 * sessionId 取 run 注入的 LangChain config(configurable.thread_id,模型
 * 参数里没有、不可伪造);contact 空串落 null;prisma 失败不抛(返回人话
 * JSON 供模型转述)。tools.ts 的重依赖(检索/发布过滤/DB/logger)全 mock。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const prismaMock = vi.hoisted(() => ({ feedback: { create: vi.fn() } }));
const loggerMock = vi.hoisted(() => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }));

vi.mock("@/lib/db", () => ({ prisma: prismaMock }));
vi.mock("@/lib/logger", () => ({ logger: loggerMock }));
vi.mock("@/lib/search/unified-search", () => ({ searchAll: vi.fn() }));
vi.mock("@/lib/content/posts", () => ({ PUBLISHED: { status: "published" } }));

const { submitFeedbackTool } = await import("./tools");

beforeEach(() => {
  prismaMock.feedback.create.mockReset();
  prismaMock.feedback.create.mockResolvedValue({ id: BigInt(7) });
  loggerMock.info.mockClear();
  loggerMock.warn.mockClear();
});

describe("submit_feedback(M22 批⑤)", () => {
  it("落库 open 行:sessionId 透传 configurable.thread_id,contact 空串落 null", async () => {
    const out = await submitFeedbackTool.invoke(
      { category: "issue", content: "文章里的代码示例跑不通", contact: "" },
      { configurable: { thread_id: "t-abc" } },
    );

    expect(prismaMock.feedback.create).toHaveBeenCalledWith({
      data: {
        category: "issue",
        content: "文章里的代码示例跑不通",
        contact: null,
        sessionId: "t-abc",
        status: "open",
      },
      select: { id: true },
    });
    expect(JSON.parse(out)).toEqual({ ok: true, message: "反馈已提交,感谢你的反馈!" });
    expect(loggerMock.info).toHaveBeenCalledWith(
      expect.objectContaining({ event: "feedback.submitted", feedbackId: "7" }),
    );
  });

  it("无 run config(旁路调用):sessionId 缺省,不写溯源", async () => {
    await submitFeedbackTool.invoke({
      category: "suggestion",
      content: "希望增加标签订阅功能",
      contact: "me@example.com",
    });

    expect(prismaMock.feedback.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ sessionId: undefined, contact: "me@example.com" }),
      }),
    );
  });

  it("prisma 失败:不抛,返回 ok:false 人话 JSON 并告警", async () => {
    prismaMock.feedback.create.mockRejectedValue(new Error("db down"));

    const out = await submitFeedbackTool.invoke(
      { category: "other", content: "随便聊聊,没什么具体的" },
      { configurable: { thread_id: "t-1" } },
    );

    expect(JSON.parse(out)).toEqual({ ok: false, message: "反馈提交失败,请稍后再试。" });
    expect(loggerMock.warn).toHaveBeenCalledWith(
      expect.objectContaining({ event: "feedback.submit_failed" }),
    );
  });

  it("入参契约钉 submitFeedbackSchema:content <5 字在 schema 层拒绝", async () => {
    await expect(
      submitFeedbackTool.invoke({ category: "issue", content: "太短" }),
    ).rejects.toThrow();
    expect(prismaMock.feedback.create).not.toHaveBeenCalled();
  });
});
