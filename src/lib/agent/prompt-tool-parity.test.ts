/**
 * 工具面-系统提示一致性守卫(M39 §13.7 修 2 建,M72 瘦身 B4 收窄为只读面):
 * 2026-10-21 真机故障复盘——generate_illustration 入了工具面但系统提示
 * 「正文配图只有两类」未同步,弱模型照旧清单走 HTML 卡。本测试钉死两条:
 * 1) 正向:每个工具名必须在系统提示中出现(新增工具漏改提示直接红);
 * 2) 反向:系统提示中的 snake_case 词元只允许真实工具名与显式豁免词表
 *   (参数名/字段名/harness 能力),提示引用不存在/已退役工具直接红。
 *
 * M72 B4 后工具面塌缩为全员只读六件(admin 与 guest/user 同面),本守卫
 * 随之只守只读面 —— 创作写工具与其提示段整体退役。
 */
import { describe, expect, it } from "vitest";

import { agentSystemPrompt, agentToolsFor } from "./agent";

/** 反向检查豁免词表:提示中的非工具 snake_case 词元(参数名/字段名/harness 能力) */
const NON_TOOL_TOKENS = new Set([
  "post_id", // read_post 参数
  "write_todos", // deepagents harness 计划工具(todoListMiddleware 挂载)
]);

describe("只读工具面与系统提示一致性", () => {
  const prompt = agentSystemPrompt("guest");
  const toolNames: string[] = agentToolsFor("guest").map((t) => t.name);

  it("正向:工具面每个工具名都在系统提示中提及(新增工具漏改提示直接红)", () => {
    expect(toolNames.length).toBe(6);
    const missing = toolNames.filter((n) => !prompt.includes(n));
    expect(missing).toEqual([]);
  });

  it("反向:提示中的 snake_case 词元 ⊆ 真实工具名 ∪ 豁免词表(引用不存在/已退役工具直接红)", () => {
    const tokens = new Set(prompt.match(/[a-z][a-z0-9]*(?:_[a-z0-9]+)+/g) ?? []);
    const unknown = [...tokens].filter((t) => !toolNames.includes(t) && !NON_TOOL_TOKENS.has(t));
    expect(unknown).toEqual([]);
  });

  it("退役的写工具不得再出现在提示里(admin 段已随 B4 删除)", () => {
    for (const gone of [
      "read_draft",
      "propose_edits",
      "save_topic_draft",
      "write_article",
      "render_card",
      "generate_illustration",
      "generate_post_cover",
      "list_skills",
      "get_skill",
    ]) {
      expect(prompt.includes(gone), `提示仍引用已退役工具 ${gone}`).toBe(false);
    }
  });
});
