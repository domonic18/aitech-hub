/**
 * tools 单测(prisma/unified-search 必 mock):工具面构成(名字收口;K2.6 四
 * 只读工具 + ask_user HITL 提问 + M22 批⑤ submit_feedback 唯一可写口)+
 * get_time 输出形状(iso/beijing/timezone,北京时区显式锚定不随机器漂)+
 * ask_user 入参 schema 形状(question/options 界)+ M27 批⑧-b read_draft
 * (admin 会话防线 fail-closed/任意状态可读/截断形状)。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const prismaMock = vi.hoisted(() => ({
  post: { findFirst: vi.fn() },
  githubRepo: { findFirst: vi.fn() },
  searchAgentSession: { findUnique: vi.fn() },
}));
const searchAllMock = vi.hoisted(() => vi.fn());

vi.mock("../db", () => ({ prisma: prismaMock }));
vi.mock("../search/unified-search", () => ({ searchAll: searchAllMock }));
vi.mock("../logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

import {
  AGENT_TOOLS,
  EDIT_TOOLS,
  askUserTool,
  getTimeTool,
  proposeEditsTool,
  readDraftTool,
} from "./tools";

beforeEach(() => {
  prismaMock.post.findFirst.mockReset();
  prismaMock.githubRepo.findFirst.mockReset();
  prismaMock.searchAgentSession.findUnique.mockReset();
  searchAllMock.mockReset();
});

describe("AGENT_TOOLS", () => {
  it("工具面收口为六只(四只读 + ask_user 提问 + submit_feedback 唯一可写),名字与顺序固定", () => {
    expect(AGENT_TOOLS).toHaveLength(6);
    expect(AGENT_TOOLS.map((t) => t.name)).toEqual([
      "search_site",
      "read_post",
      "read_repo",
      "get_time",
      "ask_user",
      "submit_feedback",
    ]);
  });
});

describe("askUserTool", () => {
  it("schema:question 必填 ≤500,options 2-4 项可选", () => {
    const schema = askUserTool.schema;
    expect(schema.safeParse({ question: "想问什么?" }).success).toBe(true);
    expect(schema.safeParse({ question: "q", options: ["报问题", "提建议"] }).success).toBe(true);
    expect(schema.safeParse({ question: "q", options: ["只有一项"] }).success).toBe(false);
    expect(schema.safeParse({ question: "q", options: ["a", "b", "c", "d", "e"] }).success).toBe(
      false,
    );
    expect(schema.safeParse({}).success).toBe(false);
  });
});

describe("getTimeTool", () => {
  it("返回 iso/beijing/timezone,beijing 为北京时区 YYYY/MM/DD HH:mm", async () => {
    const out = JSON.parse(await getTimeTool.invoke({}));
    expect(out.timezone).toBe("Asia/Shanghai");
    expect(new Date(out.iso).toISOString()).toBe(out.iso);
    // zh-CN 2-digit 组合固定为 2026/10/07 14:33 形态;时区显式指定,不随机器 TZ 漂移
    expect(out.beijing).toMatch(/^\d{4}\/\d{2}\/\d{2} \d{2}:\d{2}$/);
    // beijing 与 iso 同源:同一时刻的北京钟面(用 iso 反推校验日期一致性)
    const fromIso = new Intl.DateTimeFormat("zh-CN", {
      timeZone: "Asia/Shanghai",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).format(new Date(out.iso));
    expect(out.beijing).toBe(fromIso);
  });
});

describe("readDraftTool(M27 批⑧-b)", () => {
  /** 会话行归属桩(admin: 前缀 = admin 会话);invoke 结构化入参/配置逆变同 topic-tools */
  const mockSession = (visitorId: string | null): void => {
    prismaMock.searchAgentSession.findUnique.mockResolvedValue(
      visitorId === null ? null : { visitorId },
    );
  };
  const invoke = (cfg: { threadId: string }): Promise<string> =>
    readDraftTool.invoke(
      { id: "123" } as never,
      {
        configurable: { thread_id: cfg.threadId },
      } as never,
    ) as Promise<string>;

  it("EDIT_TOOLS 收口为 read_draft + propose_edits(不进 AGENT_TOOLS 基线面)", () => {
    expect(EDIT_TOOLS.map((t) => t.name)).toEqual(["read_draft", "propose_edits"]);
    expect(AGENT_TOOLS.map((t) => t.name)).not.toContain("read_draft");
    expect(AGENT_TOOLS.map((t) => t.name)).not.toContain("propose_edits");
  });

  it("非 admin 会话(无行/user 归属)fail-closed 拒绝,不触库", async () => {
    mockSession(null);
    expect(JSON.parse(await invoke({ threadId: "t1" }))).toEqual({
      ok: false,
      error: "无权限:仅管理员会话可执行此操作",
    });
    mockSession("user:u1");
    expect(JSON.parse(await invoke({ threadId: "t1" })).ok).toBe(false);
    expect(prismaMock.post.findFirst).not.toHaveBeenCalled();
  });

  it("admin 会话读任意状态文章(草稿可读),返回标题/状态/正文/全长", async () => {
    mockSession("admin:u1");
    prismaMock.post.findFirst.mockResolvedValue({
      title: "草稿标题",
      status: "draft",
      contentMd: "正文内容",
    });
    expect(JSON.parse(await invoke({ threadId: "t1" }))).toEqual({
      id: "123",
      title: "草稿标题",
      status: "draft",
      content: "正文内容",
      content_length: 4,
      truncated: false,
    });
    // 不带 PUBLISHED 过滤(草稿放行),仅排除已删除
    expect(prismaMock.post.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ status: { not: "deleted" } }),
      }),
    );
  });

  it("超长正文截断:content 取 TOOL_BODY_MAX,truncated=true 且 content_length 为全长", async () => {
    mockSession("admin:u1");
    const { TOOL_BODY_MAX } = await import("./tools");
    prismaMock.post.findFirst.mockResolvedValue({
      title: "长文",
      status: "published",
      contentMd: "x".repeat(TOOL_BODY_MAX + 10),
    });
    const out = JSON.parse(await invoke({ threadId: "t1" }));
    expect(out.truncated).toBe(true);
    expect(out.content_length).toBe(TOOL_BODY_MAX + 10);
    expect(out.content).toHaveLength(TOOL_BODY_MAX);
  });

  it("文章不存在(已删除/无此 id)业务降级人话", async () => {
    mockSession("admin:u1");
    prismaMock.post.findFirst.mockResolvedValue(null);
    expect(JSON.parse(await invoke({ threadId: "t1" }))).toEqual({
      ok: false,
      error: "文章不存在",
    });
  });
});

describe("proposeEditsTool schema(M27 批⑧-c)", () => {
  const schema = proposeEditsTool.schema;
  const edit = { oldString: "原文", newString: "新文" };

  it("双档二选一:edits 档与 rewrite 档各自通过", () => {
    expect(schema.safeParse({ note: "展开", edits: [edit] }).success).toBe(true);
    expect(schema.safeParse({ note: "重写", content_md: "# 全文" }).success).toBe(true);
  });

  it("双档互斥:都传/都不传一律拒绝(refine)", () => {
    expect(schema.safeParse({ note: "n", edits: [edit], content_md: "# 全文" }).success).toBe(
      false,
    );
    expect(schema.safeParse({ note: "n" }).success).toBe(false);
  });

  it("edits 界:≤20 块、单块 oldString/newString ≤8000、note ≤200;note 总说明必填", () => {
    expect(
      schema.safeParse({ note: "n", edits: Array.from({ length: 20 }, () => ({ ...edit })) })
        .success,
    ).toBe(true);
    expect(
      schema.safeParse({ note: "n", edits: Array.from({ length: 21 }, () => ({ ...edit })) })
        .success,
    ).toBe(false);
    expect(
      schema.safeParse({ note: "n", edits: [{ oldString: "a".repeat(8001), newString: "b" }] })
        .success,
    ).toBe(false);
    expect(
      schema.safeParse({ note: "n", edits: [{ oldString: "a", newString: "b".repeat(8001) }] })
        .success,
    ).toBe(false);
    expect(
      schema.safeParse({
        note: "n",
        edits: [{ oldString: "a", newString: "b", note: "x".repeat(201) }],
      }).success,
    ).toBe(false);
    expect(schema.safeParse({ edits: [edit] }).success).toBe(false);
  });

  it("rewrite 界:content_md ≤50000 字", () => {
    expect(schema.safeParse({ note: "n", content_md: "x".repeat(50_000) }).success).toBe(true);
    expect(schema.safeParse({ note: "n", content_md: "x".repeat(50_001) }).success).toBe(false);
  });
});
