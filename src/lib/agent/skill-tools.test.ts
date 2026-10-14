/**
 * 技能工具面单测(M30 批②):admin 会话防线(fail-closed,list/get 同口径)/
 * list 元数据载荷(零正文)/ get 全文载荷与停用·缺失降级人话。
 * DB 全 mock;LLM 不入单测(e2e 零真网)。
 */
import { describe, expect, it, vi, beforeEach } from "vitest";

const sessionFindUnique = vi.hoisted(() => vi.fn());
vi.mock("../db", () => ({
  prisma: { searchAgentSession: { findUnique: sessionFindUnique } },
}));
vi.mock("../logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

const listEnabledSkillMetas = vi.hoisted(() => vi.fn());
const getEnabledSkillByKey = vi.hoisted(() => vi.fn());
vi.mock("../ai/agent-skills-admin", () => ({ listEnabledSkillMetas, getEnabledSkillByKey }));

import { getSkillTool, listSkillsTool } from "./skill-tools";

/** 工具调用统一入口(configurable.thread_id 模拟 LangGraph 注入;同 topic-tools) */
type AnyTool = { invoke: (args: never, cfg?: never) => Promise<unknown> };

async function invoke(
  t: AnyTool,
  args: Record<string, unknown> = {},
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

describe("admin 会话防线(纵深防御,两工具同口径)", () => {
  it("非 admin 会话行 / 无行 / 无 threadId → 全拒且不触达业务", async () => {
    for (const row of [{ visitorId: "user:u1" }, null]) {
      sessionFindUnique.mockResolvedValueOnce(row);
      await expect(invoke(listSkillsTool)).resolves.toMatchObject({ ok: false });
      expect(listEnabledSkillMetas).not.toHaveBeenCalled();
    }
    await expect(invoke(getSkillTool, { key: "k" }, "")).resolves.toMatchObject({ ok: false });
    expect(getEnabledSkillByKey).not.toHaveBeenCalled();
  });

  it("admin 会话行放行", async () => {
    sessionFindUnique.mockResolvedValueOnce(ADMIN_OK);
    listEnabledSkillMetas.mockResolvedValueOnce([]);
    await expect(invoke(listSkillsTool)).resolves.toMatchObject({ skills: [] });
    expect(sessionFindUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "t-admin" } }),
    );
  });
});

describe("list_skills(渐进披露第一层)", () => {
  it("只回元数据(key/名称/场景),不含指南正文", async () => {
    sessionFindUnique.mockResolvedValueOnce(ADMIN_OK);
    listEnabledSkillMetas.mockResolvedValueOnce([
      { key: "blogger-video", name: "博主×视频推荐短文", scenario: "公众号「博主×视频」短文" },
    ]);
    const r = await invoke(listSkillsTool);
    expect(r.skills).toHaveLength(1);
    expect(r.skills).toEqual([
      { key: "blogger-video", name: "博主×视频推荐短文", scenario: "公众号「博主×视频」短文" },
    ]);
    expect(JSON.stringify(r)).not.toContain("guide_md");
    expect(r.note).toContain("get_skill");
  });
});

describe("get_skill(渐进披露第二层)", () => {
  it("命中 → ok+指南全文;停用/缺失 → 人话降级", async () => {
    sessionFindUnique.mockResolvedValueOnce(ADMIN_OK);
    getEnabledSkillByKey.mockResolvedValueOnce({
      key: "blogger-video",
      name: "博主×视频推荐短文",
      scenario: "公众号「博主×视频」短文",
      guideMd: "# 指南正文",
    });
    const ok = await invoke(getSkillTool, { key: "blogger-video" });
    expect(ok).toMatchObject({ ok: true, key: "blogger-video", guide_md: "# 指南正文" });

    getEnabledSkillByKey.mockResolvedValueOnce(null);
    sessionFindUnique.mockResolvedValueOnce(ADMIN_OK);
    await expect(invoke(getSkillTool, { key: "ghost" })).resolves.toMatchObject({
      ok: false,
      error: expect.stringContaining("不存在或已停用"),
    });
  });
});
