/**
 * 写作指南守卫(M72 B2 建,B4 增补):`skills/writing/*.md` 是写作指南的**唯一**
 * 真相源(站内 agent_skill 表、B7 退役;站内版 TS 常量,B4 随 agent 写工具
 * 退役)。四道闸:
 * 1. 覆盖闸:产品约定的 7 份指南全部有对应 md,key 唯一、不多不少;
 * 2. 出处闸:每份 md 的 frontmatter 带 key/name/scenario/version/导出出处;
 * 3. 语境闸:md 里不得再出现站内 agent 的工具名 —— 指南是给线下 Claude Code
 *    看的,留着站内工具名会让写作助手调不存在的工具;
 * 4. 体量闸:正文非空(导出不是空壳)。
 */
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const SKILLS_DIR = path.join(process.cwd(), "skills", "writing");

/** 产品约定的指南全集(B2 导出时从站内种子注册表搬出,此后成为唯一真相源) */
const EXPECTED_KEYS = [
  "blogger-video",
  "card-rendering",
  "model-pricing",
  "open-source-intro",
  "paper-interpret",
  "tutorial-refine",
  "weekly-news",
];

/** 站内 agent 的工具名(下线后指南里不该再出现) */
const STATION_TOOL_NAMES = [
  "render_card",
  "generate_illustration",
  "save_topic_draft",
  "save_topic_pin",
  "update_topic_pin",
  "measure_wechat_budget",
  "list_skills",
  "get_skill",
  "generate_cover_candidates",
  "transfer_video_cover",
  "propose_edits",
  "mount_material",
  "get_topic_brief",
  "get_post_sources",
];

function readSkill(key: string): string {
  return readFileSync(path.join(SKILLS_DIR, `${key}.md`), "utf8");
}

function frontmatter(text: string): Record<string, string> {
  const m = text.match(/^---\n([\s\S]*?)\n---/);
  if (m === null) throw new Error("缺 frontmatter");
  const out: Record<string, string> = {};
  for (const line of (m[1] ?? "").split("\n")) {
    const i = line.indexOf(":");
    if (i > 0) out[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
  return out;
}

describe("写作指南(skills/writing)", () => {
  const boundKeys = EXPECTED_KEYS;

  it("约定的指南 key 全部有对应 md(防断链)", () => {
    for (const key of boundKeys) {
      expect(() => readSkill(key), `缺 ${key}.md`).not.toThrow();
    }
  });

  it("目录里的 md 集合与产品约定一致(不多不少)", () => {
    const files = readdirSync(SKILLS_DIR)
      .filter((f) => f.endsWith(".md") && f !== "INDEX.md")
      .map((f) => f.replace(/\.md$/, ""))
      .sort();
    expect(files).toEqual([...EXPECTED_KEYS].sort());
  });

  it("每份 md 的 frontmatter 带 key/name/scenario/version 与导出出处", () => {
    for (const key of boundKeys) {
      const fm = frontmatter(readSkill(key));
      expect(fm.key, `${key}.md frontmatter.key`).toBe(key);
      expect(fm.name, `${key}.md frontmatter.name`).toBeTruthy();
      expect(fm.scenario, `${key}.md frontmatter.scenario`).toBeTruthy();
      expect(fm.version, `${key}.md frontmatter.version`).toBeTruthy();
      expect(fm.exported_from, `${key}.md 缺导出出处`).toContain("agent_skill");
    }
  });

  it("md 里不再出现站内 agent 工具名(指南面向线下写作助手)", () => {
    for (const key of boundKeys) {
      const text = readSkill(key);
      for (const tool of STATION_TOOL_NAMES) {
        expect(text.includes(tool), `${key}.md 仍引用站内工具 ${tool}`).toBe(false);
      }
    }
  });

  it("正文非空(导出不是空壳)", () => {
    for (const key of boundKeys) {
      const body = readSkill(key)
        .replace(/^---\n[\s\S]*?\n---\n/, "")
        .trim();
      expect(body.length, `${key}.md 正文过短`).toBeGreaterThan(500);
    }
  });
});
