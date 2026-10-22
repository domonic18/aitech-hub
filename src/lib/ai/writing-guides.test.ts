/**
 * 写作技能注册表守卫(M39 批④):内容形式(TOPIC_PURPOSES)绑定的每个
 * skillKey 都必须有种子技能——断链时 deriveSkillKey 回写一个库中不存在的
 * key,brief 绑定降级为 list_skills 兜底,专属指南常态性失联(静默劣化,
 * 必须机器拦)。另守:M39 五场景新指南携带公共条款(写作要求优先/配图工艺/
 * 码点预算),防止插值丢失或新增指南漏拼。E1(2026-10-21)扩:文生图内容
 * 规划标准(CRAFT_ILLUSTRATION_PLAN)六指南逐字插值守卫——纪律单源住指南层,
 * 系统提示/工具描述只留锚点,勿回填。
 */
import { describe, expect, it } from "vitest";

import { TOPIC_PURPOSES } from "../topics/constants";
import { CRAFT_ILLUSTRATION_PLAN, WRITING_SKILLS } from "./writing-guides";

describe("WRITING_SKILLS 注册表", () => {
  it("TOPIC_PURPOSES 绑定的 skillKey 全部有种子技能(防 form→skill 断链)", () => {
    const keys = new Set<string>(WRITING_SKILLS.map((s) => s.key));
    for (const p of TOPIC_PURPOSES) {
      expect(keys.has(p.skillKey), `形式 ${p.key} 绑定的技能 ${p.skillKey} 无种子`).toBe(true);
    }
  });

  it("key 唯一且既有两技能在册", () => {
    const keys = WRITING_SKILLS.map((s) => s.key);
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys).toContain("blogger-video");
    expect(keys).toContain("card-rendering");
  });

  it("M39 五场景指南携带公共条款与 §13.9 编排开放原则", () => {
    for (const key of [
      "open-source-intro",
      "paper-interpret",
      "tutorial-refine",
      "weekly-news",
      "model-pricing",
    ]) {
      const g = WRITING_SKILLS.find((s) => s.key === key);
      expect(g, key).toBeDefined();
      expect(g!.guideMd).toContain("写作要求优先");
      expect(g!.guideMd).toContain("配图工艺");
      expect(g!.guideMd).toContain("不设限");
      expect(g!.guideMd).toContain("measure_wechat_budget");
      expect(g!.guideMd).toContain("码点预算");
    }
  });

  it("文生图内容规划标准单源插值(E1:六指南同文,防再走三处同步改的发版老路)", () => {
    for (const key of [
      "blogger-video",
      "open-source-intro",
      "paper-interpret",
      "tutorial-refine",
      "weekly-news",
      "model-pricing",
    ]) {
      const g = WRITING_SKILLS.find((s) => s.key === key);
      expect(g, key).toBeDefined();
      // 全文逐字包含共享常量 = 插值未丢、未手抄漂移
      expect(g!.guideMd).toContain(CRAFT_ILLUSTRATION_PLAN);
    }
  });
});
