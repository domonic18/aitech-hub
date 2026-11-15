/**
 * tools 单测(prisma/unified-search 必 mock):工具面构成(名字收口;K2.6 四
 * 只读工具 + ask_user HITL 提问 + M22 批⑤ submit_feedback 唯一可写口)+
 * get_time 输出形状(iso/beijing/timezone,北京时区显式锚定不随机器漂)+
 * ask_user 入参 schema 形状(question/options 界)+ M27 批⑧-b read_draft
 * (admin 会话防线 fail-closed/任意状态可读/截断形状/同会话正文未变重复读取
 * 去重——2026-10-21 反刍烧 token 守卫)。
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

import { AGENT_TOOLS, askUserTool, getTimeTool, readPostTool, readPostToolFor } from "./tools";

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

describe("read_post 门禁(M69):按身份取正文档,默认 fail-closed", () => {
  const LONG = "段".repeat(7000);
  const row = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
    title: "标题",
    contentMd: LONG,
    contentHtml: null,
    isPurchasable: false,
    isLoginRequired: false,
    ...over,
  });
  const read = async (t: typeof readPostTool, id = "123"): Promise<Record<string, unknown>> =>
    JSON.parse((await t.invoke({ id } as never)) as string) as Record<string, unknown>;

  it("未门禁文各身份全文(超长截断到 TOOL_BODY_MAX,无 gated 标记)", async () => {
    prismaMock.post.findFirst.mockResolvedValue(row());
    for (const t of [
      readPostTool,
      readPostToolFor("guest"),
      readPostToolFor("user"),
      readPostToolFor("admin"),
    ]) {
      const out = await read(t);
      expect(out.gated).toBeUndefined();
      expect(String(out.content)).toHaveLength(6000);
    }
  });

  it("付费文:游客/登录用户只给预览(≤800 + gated + notice);admin 全文", async () => {
    prismaMock.post.findFirst.mockResolvedValue(row({ isPurchasable: true }));
    for (const t of [readPostTool, readPostToolFor("guest"), readPostToolFor("user")]) {
      const out = await read(t);
      expect(out.gated).toBe(true);
      expect(out.notice).toBe("[付费文章,仅预览]");
      expect((out.content as string).length).toBeLessThanOrEqual(800);
    }
    const admin = await read(readPostToolFor("admin"));
    expect(admin.gated).toBeUndefined();
    expect(String(admin.content)).toHaveLength(6000);
  });

  it("仅登录可见文:游客预览,登录用户/admin 全文", async () => {
    prismaMock.post.findFirst.mockResolvedValue(row({ isLoginRequired: true }));
    const guest = await read(readPostToolFor("guest"));
    expect(guest.gated).toBe(true);
    expect(guest.notice).toBe("[登录可见,仅预览]");
    expect((await read(readPostToolFor("user"))).gated).toBeUndefined();
    expect((await read(readPostToolFor("admin"))).gated).toBeUndefined();
  });

  it("旧迁移文 contentMd 为空 → contentHtml 转 Markdown 兜底(不再是空正文)", async () => {
    prismaMock.post.findFirst.mockResolvedValue(
      row({ contentMd: null, contentHtml: "<p>正文段落甲</p><p>乙</p>" }),
    );
    const out = await read(readPostTool);
    expect(String(out.content)).toContain("正文段落甲");
    expect(String(out.content)).not.toContain("<p>");
  });

  it("文章不存在/未发布 → 业务降级;非法 id 不触库", async () => {
    prismaMock.post.findFirst.mockResolvedValue(null);
    expect(await read(readPostTool)).toEqual({ error: "文章不存在或未发布" });
    prismaMock.post.findFirst.mockReset();
    expect(await read(readPostTool, "99999999999999999999999999")).toEqual({
      error: "文章不存在或未发布",
    });
    expect(prismaMock.post.findFirst).not.toHaveBeenCalled();
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

  it("schema:detail 可选 ≤2000(两段式确认的提示词全文通道)", () => {
    const schema = askUserTool.schema;
    expect(schema.safeParse({ question: "q", detail: "提示词全文" }).success).toBe(true);
    expect(schema.safeParse({ question: "q", detail: "字".repeat(2001) }).success).toBe(false);
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
