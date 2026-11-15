/**
 * agent 图装配纯函数单测(工具面/系统提示;M72 瘦身 B4 后**全员只读六件**,
 * admin 与 guest/user 同面——站内创作职责外移线下,写工具与其提示段整体退役)。
 * 重 IO 装配(getAgentGraph/checkpointer/模型解析)不入单测,由真机验收。
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("./tools", () => ({
  AGENT_TOOLS: [
    { name: "search_site" },
    { name: "read_post" },
    { name: "read_repo" },
    { name: "get_time" },
    { name: "ask_user" },
    { name: "submit_feedback" },
  ],
  readPostToolFor: (kind: string) => ({ name: "read_post", mode: kind }),
}));
vi.mock("./checkpointer", () => ({
  ensureAgentCheckpointer: vi.fn(),
  getAgentCheckpointer: vi.fn(),
}));
vi.mock("./model-factory", () => ({ resolveAgentModel: vi.fn() }));
vi.mock("../logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

import { AGENT_SYSTEM_PROMPT, agentSystemPrompt, agentToolsFor } from "./agent";

const READ_ONLY = [
  "search_site",
  "read_post",
  "read_repo",
  "get_time",
  "ask_user",
  "submit_feedback",
];

describe("agentToolsFor(全员只读六件)", () => {
  it("guest/user/admin 同面:只读六件,无任何写工具", () => {
    for (const kind of ["guest", "user", "admin"] as const) {
      expect(agentToolsFor(kind).map((t) => t.name)).toEqual(READ_ONLY);
    }
  });

  it("read_post 按身份换档(M69):guest/user/admin 各取对应门禁实例", () => {
    for (const kind of ["guest", "user", "admin"] as const) {
      const t = agentToolsFor(kind).find((x) => x.name === "read_post");
      expect((t as unknown as { mode: string }).mode).toBe(kind);
    }
  });
});

describe("agentSystemPrompt(全员同一份只读定调)", () => {
  it("三种身份同面:即基线提示,不含创作语义", () => {
    for (const kind of ["guest", "user", "admin"] as const) {
      expect(agentSystemPrompt(kind)).toBe(AGENT_SYSTEM_PROMPT);
    }
  });

  it("创作写工具的语义词全部退役(B4)", () => {
    const p = agentSystemPrompt("admin");
    for (const gone of [
      "save_topic_draft",
      "read_draft",
      "propose_edits",
      "write_article",
      "render_card",
      "generate_illustration",
      "generate_post_cover",
      "list_skills",
      "get_skill",
      "topic",
    ]) {
      expect(p.includes(gone), `提示仍引用 ${gone}`).toBe(false);
    }
  });

  it("只读边界仍在:明示不能写入或修改数据", () => {
    const p = agentSystemPrompt("guest");
    expect(p).toContain("不能写入或修改任何数据");
    expect(p).toContain("search_site");
    expect(p).toContain("ask_user");
  });
});
