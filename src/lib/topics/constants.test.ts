/**
 * 内容形式预置单测(2026-10-18 体裁治理;2026-10-20 起为写作配置「内容形式」
 * 维度的底座,可视化构建见 writing-config):定位模板精确匹配 → 形式 key;
 * 空=缺省「视频安利」;自定义文案=null(解析层显示已自定义且不猜)。
 */
import { describe, expect, it } from "vitest";

import {
  DEFAULT_TOPIC_POSITIONING,
  matchTopicPurpose,
  TOPIC_PURPOSES,
  TUTORIAL_TOPIC_POSITIONING,
} from "./constants";

describe("matchTopicPurpose(写作要求模板 → 内容形式)", () => {
  it("预置模板精确匹配各自目的", () => {
    expect(matchTopicPurpose(DEFAULT_TOPIC_POSITIONING)).toBe("video-recommend");
    expect(matchTopicPurpose(TUTORIAL_TOPIC_POSITIONING)).toBe("video-tutorial");
  });

  it("空/null = 缺省「视频安利」;自定义文案 = null", () => {
    expect(matchTopicPurpose(null)).toBe("video-recommend");
    expect(matchTopicPurpose("")).toBe("video-recommend");
    expect(matchTopicPurpose("  ")).toBe("video-recommend");
    expect(matchTopicPurpose("面向开发者的深度解读")).toBeNull();
  });

  it("模板被手改即视为自定义(不误配;trim 后仍须全等)", () => {
    expect(matchTopicPurpose(`${TUTORIAL_TOPIC_POSITIONING}!`)).toBeNull();
    expect(matchTopicPurpose(`${TUTORIAL_TOPIC_POSITIONING} `)).toBe("video-tutorial");
  });

  it("预置项自洽:每项目录含 key/label/genreWord/模板/skillKey,模板互不重复", () => {
    const templates = new Set(TOPIC_PURPOSES.map((t) => t.positioningTemplate));
    expect(templates.size).toBe(TOPIC_PURPOSES.length);
    for (const t of TOPIC_PURPOSES) {
      expect(t.label.length).toBeGreaterThan(0);
      expect(t.genreWord.length).toBeGreaterThan(0);
      expect(t.skillKey).toMatch(/^[a-z0-9-]+$/); // AGENT_SKILL_KEY_RE 同域
      expect(matchTopicPurpose(t.positioningTemplate)).toBe(t.key);
    }
  });

  it("M39 扩容:7 形式,两个视频形式同挂 blogger-video,5 新形式各专属 skill", () => {
    expect(TOPIC_PURPOSES).toHaveLength(7);
    const byKey = Object.fromEntries(TOPIC_PURPOSES.map((t) => [t.key, t.skillKey]));
    expect(byKey["video-recommend"]).toBe("blogger-video");
    expect(byKey["video-tutorial"]).toBe("blogger-video");
    for (const k of [
      "open-source-intro",
      "paper-interpret",
      "tutorial-refine",
      "weekly-news",
      "model-pricing",
    ]) {
      expect(byKey[k]).not.toBe("blogger-video");
      expect(byKey[k].length).toBeGreaterThan(0);
    }
  });
});
