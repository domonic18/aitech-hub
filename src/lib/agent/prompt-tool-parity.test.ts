/**
 * 工具面-系统提示一致性守卫(M39 §13.7 修 2,防再犯机器防线):
 * 2026-10-21 真机故障复盘——generate_illustration 入了工具面但系统提示
 * 「正文配图只有两类」未同步,弱模型照旧清单走 HTML 卡。本测试钉死两条:
 * 1) 正向:admin 图每个工具名必须在系统提示中出现(新增工具漏改提示直接红);
 * 2) 反向:系统提示中的 snake_case 词元只允许真实工具名与显式豁免词表
 *   (参数名/字段名/harness 能力),提示引用不存在/已退役工具直接红。
 * 能力清单唯一权威副本 = 系统提示(与工具面同发版节奏);技能指南/注释
 * 不再维护「只用 X 与 Y」式枚举句。
 */
import { describe, expect, it } from "vitest";

import { agentSystemPrompt, agentToolsFor } from "./agent";

/** 反向检查豁免词表:提示中的非工具 snake_case 词元(参数名/字段名/harness 能力) */
const NON_TOOL_TOKENS = new Set([
  "auto_adopt", // generate_post_cover 自动档参数
  "card_urls", // save_topic_draft 参数
  "content_md", // save_topic_draft 参数
  "cover_path", // 素材/落稿字段
  "draft_md", // write_article 返回字段
  "markdown_line", // render_card 返回字段
  "output_type", // brief 结构化标记:主意图 article|pin(M42 创作中心)
  "pin_config", // brief 结构化标记:贴图配置(M42 批④;reference 为管理员指定参照图)
  "pin_id", // update_topic_pin 参数 / save_topic_pin 回执字段
  "post_id", // save_topic_draft 返回字段
  "post_url", // save_topic_draft 返回字段
  "reference_path", // generate_illustration 样例参照图参数(M39 批③;2026-10-21 提示加参照纪律)
  "sample_image", // brief 结构化标记:样例参照图(M39 批③)
  "skill_key", // 专题绑定字段 / write_article 参数
  "skip_cover_generation", // brief 结构化标记(M39 批④+)
  "topic_id", // 各工具参数
  "video_url", // brief 素材区字段:原视频链接(M46 验收批:视频体贴图轻文字带源)
  "visual_mode", // brief 结构化标记(M39 §13.7 修 1)
  "write_todos", // deepagents harness 计划工具(todoListMiddleware 挂载)
]);

describe("admin 工具面与系统提示一致性(M39 §13.7 修 2)", () => {
  const prompt = agentSystemPrompt("admin");
  const toolNames: string[] = agentToolsFor("admin").map((t) => t.name);

  it("正向:admin 图每个工具名都在系统提示中提及(新增工具漏改提示直接红)", () => {
    expect(toolNames.length).toBeGreaterThan(10);
    const missing = toolNames.filter((n) => !prompt.includes(n));
    expect(missing).toEqual([]);
  });

  it("反向:提示中的 snake_case 词元 ⊆ 真实工具名 ∪ 豁免词表(引用不存在/已退役工具直接红)", () => {
    const tokens = new Set(prompt.match(/[a-z][a-z0-9]*(?:_[a-z0-9]+)+/g) ?? []);
    const unknown = [...tokens].filter((t) => !toolNames.includes(t) && !NON_TOOL_TOKENS.has(t));
    expect(unknown).toEqual([]);
  });
});
