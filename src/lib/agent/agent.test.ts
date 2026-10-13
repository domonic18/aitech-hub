/**
 * agent 图装配纯函数单测(工具面/系统提示按身份档分发,M27 批④建、批⑤随
 * agent 自主生产重构更新):guest/user 维持 K2.5 只读六件与基线提示;admin
 * 追加专题生产四件工具与工作流段。重 IO 装配(getAgentGraph/checkpointer/
 * 模型解析)不入单测,由真机验收。
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
}));
vi.mock("./topic-tools", () => ({
  TOPIC_TOOLS: [
    { name: "get_topic_brief" },
    { name: "transfer_video_cover" },
    { name: "generate_cover_candidates" },
    { name: "save_topic_draft" },
  ],
}));
vi.mock("./checkpointer", () => ({
  ensureAgentCheckpointer: vi.fn(),
  getAgentCheckpointer: vi.fn(),
}));
vi.mock("./model-factory", () => ({ resolveAgentModel: vi.fn() }));
vi.mock("../logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

import { AGENT_SYSTEM_PROMPT, agentSystemPrompt, agentToolsFor } from "./agent";

describe("agentToolsFor(工具面按身份分发)", () => {
  it("guest/user 只读六件,无专题生产工具", () => {
    for (const kind of ["guest", "user"] as const) {
      expect(agentToolsFor(kind).map((t) => t.name)).toEqual([
        "search_site",
        "read_post",
        "read_repo",
        "get_time",
        "ask_user",
        "submit_feedback",
      ]);
    }
  });

  it("admin 追加专题生产四件(get_topic_brief/transfer_video_cover/generate_cover_candidates/save_topic_draft)", () => {
    expect(agentToolsFor("admin").map((t) => t.name)).toEqual([
      "search_site",
      "read_post",
      "read_repo",
      "get_time",
      "ask_user",
      "submit_feedback",
      "get_topic_brief",
      "transfer_video_cover",
      "generate_cover_candidates",
      "save_topic_draft",
    ]);
  });
});

describe("agentSystemPrompt(提示按身份分发)", () => {
  it("guest/user 即基线提示,不含专题生产语义", () => {
    for (const kind of ["guest", "user"] as const) {
      expect(agentSystemPrompt(kind)).toBe(AGENT_SYSTEM_PROMPT);
      expect(agentSystemPrompt(kind)).not.toContain("save_topic_draft");
    }
  });

  it("admin 基线之上追加工作流段(write_todos 计划先行 + 选题 ask_user + 落库确认回路)", () => {
    const p = agentSystemPrompt("admin");
    expect(p.startsWith(AGENT_SYSTEM_PROMPT)).toBe(true);
    expect(p).toContain("save_topic_draft");
    expect(p).toContain("write_todos");
    expect(p).toContain("ask_user");
    expect(p).toContain("needConfirm");
  });

  it("配图链提示(批⑥):cover_path 直引 + 生图插图 + transfer 重试 + 卡图不重复", () => {
    const p = agentSystemPrompt("admin");
    // 分配面:brief 已转存站内路径,正文直引;严禁编造外链
    expect(p).toContain("素材的 cover_path");
    expect(p).toContain("严禁编造外链图片");
    // 生图放开到正文概念示意图;transfer_video_cover 定位为重试/补传钮
    expect(p).toContain("概念示意图");
    expect(p).toContain("transfer_video_cover 重试");
    // 消费口径:头图避让文首卡同图;无合适图不硬插(2~4 张引导仍在)
    expect(p).toContain("文首推荐卡由系统自动带图");
    expect(p).toContain("2~4 张");
  });
});
