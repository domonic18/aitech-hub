/**
 * 答案卡留档单测(批A):recordAnswerLog 三态字段防御(question 截断/答案截断/
 * 写失败告警返回 null 不抛)与 90 天清理分批删。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const hoisted = vi.hoisted(() => ({
  create: vi.fn(),
  deleteMany: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  prisma: { searchAnswerLog: { create: hoisted.create, deleteMany: hoisted.deleteMany } },
  deleteBatchedWhere: vi.fn(async (model: unknown, where: { createdAt: { lt: Date } }) => {
    // 模拟分批删(直调模型 deleteMany 一次即可验证 where 口径)
    return hoisted.deleteMany(where);
  }),
}));
vi.mock("@/lib/logger", () => ({ logger: { warn: vi.fn(), error: vi.fn() } }));

import {
  recordAnswerLog,
  purgeSearchAnswerOlderThan,
  ANSWER_LOG_RETENTION_DAYS,
} from "./answer-log";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("recordAnswerLog", () => {
  it("落一行并返回 id 串;question/answer 防御性截断", async () => {
    hoisted.create.mockResolvedValue({ id: BigInt(77) });
    const id = await recordAnswerLog({
      visitorId: "v-uuid",
      question: "问".repeat(150),
      answer: "答".repeat(21_000),
      cites: [{ n: 1, kind: "post", title: "t", href: "h", snippet: "s" }],
      followUps: ["追问"],
      modelKey: "deepseek-chat",
      durationMs: 1200,
      status: "ok",
    });
    expect(id).toBe("77");
    const data = hoisted.create.mock.calls[0]![0].data;
    expect(data.question).toHaveLength(120);
    expect(data.answer).toHaveLength(20_000);
    expect(data.cites.items).toHaveLength(1);
    expect(data.status).toBe("ok");
  });

  it("写失败:告警并返回 null,不抛(不反噬 SSE 流)", async () => {
    hoisted.create.mockRejectedValue(new Error("db down"));
    const id = await recordAnswerLog({
      visitorId: null,
      question: "q",
      answer: null,
      cites: [],
      modelKey: "m",
      durationMs: 5,
      status: "failed",
    });
    expect(id).toBeNull();
  });
});

describe("purgeSearchAnswerOlderThan", () => {
  it("按 90 天边界清理,返回删除行数", async () => {
    hoisted.deleteMany.mockResolvedValue(3);
    const removed = await purgeSearchAnswerOlderThan();
    expect(removed).toBe(3);
    const where = hoisted.deleteMany.mock.calls[0]![0] as { createdAt: { lt: Date } };
    const expectCutoff = Date.now() - ANSWER_LOG_RETENTION_DAYS * 86_400_000;
    expect(where.createdAt.lt.getTime()).toBeGreaterThan(expectCutoff - 5_000);
    expect(where.createdAt.lt.getTime()).toBeLessThan(expectCutoff + 5_000);
  });
});
