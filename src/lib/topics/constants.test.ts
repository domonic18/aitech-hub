/**
 * 撰写目的预置单测(2026-10-18 体裁治理):定位模板精确匹配 → 目的 key;
 * 空=缺省「视频安利」;自定义文案=null(UI 显示自定义且切目的不覆盖)。
 */
import { describe, expect, it } from "vitest";

import {
  DEFAULT_TOPIC_POSITIONING,
  matchTopicPurpose,
  TOPIC_PURPOSES,
  TUTORIAL_TOPIC_POSITIONING,
} from "./constants";

describe("matchTopicPurpose(定位 → 撰写目的)", () => {
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

  it("预置项自洽:每项目录含 key/label/genreWord/模板,模板互不重复", () => {
    const templates = new Set(TOPIC_PURPOSES.map((t) => t.positioningTemplate));
    expect(templates.size).toBe(TOPIC_PURPOSES.length);
    for (const t of TOPIC_PURPOSES) {
      expect(t.label.length).toBeGreaterThan(0);
      expect(t.genreWord.length).toBeGreaterThan(0);
      expect(matchTopicPurpose(t.positioningTemplate)).toBe(t.key);
    }
  });
});
