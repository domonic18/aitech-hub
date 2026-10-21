/**
 * 写作配置单测(2026-10-20 详情页重构):合成/解析往返(缺省=纯模板存量兼容、
 * 条款行精确回显)、自定义侦测(未知文本不猜)、resolvePurpose 派生口径、
 * 条款注册表健全性(唯一且非空——反向解析锚点,文案改动必须连测试一起改)。
 */
import { describe, expect, it } from "vitest";

import { DEFAULT_TOPIC_POSITIONING, TOPIC_PURPOSES, TUTORIAL_TOPIC_POSITIONING } from "./constants";
import {
  composeWritingText,
  DEFAULT_WRITING_SELECTION,
  deriveSkillKey,
  parseWritingText,
  resolvePurpose,
  WRITING_DIMENSIONS,
  type WritingSelection,
} from "./writing-config";

const EDITORIAL = "口吻:专业编辑,克制陈述,让数据与事实说话,少用感叹号与网络流行语。";
const COMPACT = "篇幅:精炼,全文约 800 字,每节只留一个核心论点与一条证据。";
const ILLUSTRATE = "配图:文生图插画为主,按小节内容生成概念/场景插画(数据密集内容仍可配信息卡)。";
const MINIMAL = "配图:少图,最多 1 张信息卡,以文字与行内链接表达为主。";

describe("composeWritingText(选择 → 写作要求文本)", () => {
  it("全缺省 = 纯模板原文(老专题存量定位无损)", () => {
    expect(composeWritingText(DEFAULT_WRITING_SELECTION)).toBe(DEFAULT_TOPIC_POSITIONING);
  });

  it("非缺省维追加条款行,缺省维不出行;行序固定 口吻→篇幅→配图", () => {
    const text = composeWritingText({
      form: "video-tutorial",
      tone: "editorial",
      length: "compact",
      visual: "minimal",
    });
    expect(text).toBe([TUTORIAL_TOPIC_POSITIONING, EDITORIAL, COMPACT, MINIMAL].join("\n"));
  });

  it("只改配图 = 模板 + 单条配图条款(插画/少图各归其位)", () => {
    const illu = composeWritingText({ ...DEFAULT_WRITING_SELECTION, visual: "illustrate" });
    expect(illu).toBe(`${DEFAULT_TOPIC_POSITIONING}\n${ILLUSTRATE}`);
    const min = composeWritingText({ ...DEFAULT_WRITING_SELECTION, visual: "minimal" });
    expect(min).toBe(`${DEFAULT_TOPIC_POSITIONING}\n${MINIMAL}`);
  });
});

describe("parseWritingText(写作要求文本 → 选择)", () => {
  it("null/空串 → 全缺省且非自定义(未设置=按缺省理解)", () => {
    expect(parseWritingText(null)).toEqual({ selection: DEFAULT_WRITING_SELECTION, custom: false });
    expect(parseWritingText("  ")).toEqual({ selection: DEFAULT_WRITING_SELECTION, custom: false });
  });

  it("纯模板 → 全缺省;带条款行 → 对应维回显且 custom=false", () => {
    expect(parseWritingText(DEFAULT_TOPIC_POSITIONING).custom).toBe(false);
    const p = parseWritingText(
      composeWritingText({ ...DEFAULT_WRITING_SELECTION, tone: "editorial", length: "compact" }),
    );
    expect(p.selection).toEqual({
      ...DEFAULT_WRITING_SELECTION,
      tone: "editorial",
      length: "compact",
    });
    expect(p.custom).toBe(false);
  });

  it("教程模板 + 条款往返不失真(form 回显 video-tutorial)", () => {
    const text = composeWritingText({
      form: "video-tutorial",
      tone: "friendly",
      length: "standard",
      visual: "minimal",
    });
    expect(parseWritingText(text).selection.form).toBe("video-tutorial");
  });

  it("模板被手改 → form 匹配失败,custom=true(不猜)", () => {
    const p = parseWritingText(
      `${DEFAULT_TOPIC_POSITIONING}\n${MINIMAL}`.replace("口语化", "书面化"),
    );
    expect(p.custom).toBe(true);
    expect(p.selection.visual).toBe("minimal"); // 已知条款行仍回显
  });

  it("条款行之外多出手写行 → custom=true", () => {
    const text = `${composeWritingText(DEFAULT_WRITING_SELECTION)}\n多用具体数字,少用形容词。`;
    expect(parseWritingText(text).custom).toBe(true);
  });

  it("插画条款往返回显 illustrate;新形式模板(开源项目介绍)精确匹配", () => {
    const p = parseWritingText(
      composeWritingText({ ...DEFAULT_WRITING_SELECTION, visual: "illustrate" }),
    );
    expect(p.custom).toBe(false);
    expect(p.selection.visual).toBe("illustrate");
    const form = TOPIC_PURPOSES.find((t) => t.key === "open-source-intro");
    expect(form).toBeDefined();
    expect(parseWritingText(form!.positioningTemplate).selection.form).toBe("open-source-intro");
  });
});

describe("deriveSkillKey(形式 → skillKey 服务端单点派生,M39 批②)", () => {
  it("预置形式(含条款组合)返回注册表 skillKey;缺省=视频安利→blogger-video", () => {
    expect(deriveSkillKey(DEFAULT_TOPIC_POSITIONING)).toBe("blogger-video");
    expect(deriveSkillKey(null)).toBe("blogger-video"); // 未设置=缺省形式
    const tutorial = composeWritingText({
      ...DEFAULT_WRITING_SELECTION,
      form: "video-tutorial",
      tone: "editorial",
    });
    expect(deriveSkillKey(tutorial)).toBe("blogger-video");
    const pricing = composeWritingText({
      ...DEFAULT_WRITING_SELECTION,
      form: "model-pricing",
    });
    expect(deriveSkillKey(pricing)).toBe("model-pricing");
  });

  it("自定义文本 → undefined(不动人工绑定);7 形式全量可派生", () => {
    expect(deriveSkillKey("按我上一篇文章的风格写,重点讲成本账。")).toBeUndefined();
    for (const t of TOPIC_PURPOSES) {
      expect(deriveSkillKey(t.positioningTemplate)).toBe(t.skillKey);
    }
  });
});

describe("resolvePurpose(体裁词/展示名单点派生)", () => {
  it("缺省定位 → 视频安利/视频安利稿,非自定义", () => {
    expect(resolvePurpose(DEFAULT_TOPIC_POSITIONING)).toEqual({
      label: "视频安利",
      genreWord: "视频安利稿",
      custom: false,
    });
  });

  it("教程模板 → 含文字版教程体裁词", () => {
    expect(resolvePurpose(TUTORIAL_TOPIC_POSITIONING).genreWord).toBe("视频安利稿·含文字版教程");
  });

  it("自定义文案 → 自定义写作要求,体裁词回落视频安利稿(历史口径)", () => {
    const r = resolvePurpose("按我上一篇文章的风格写,重点讲成本账。");
    expect(r).toEqual({ label: "自定义写作要求", genreWord: "视频安利稿", custom: true });
  });

  it("模板 + 条款(全由选择合成)仍非自定义", () => {
    expect(
      resolvePurpose(composeWritingText({ ...DEFAULT_WRITING_SELECTION, length: "compact" }))
        .custom,
    ).toBe(false);
  });
});

describe("WRITING_DIMENSIONS(面板元数据健全性)", () => {
  it("四维齐备,每维选项 ≥2 且 key 不重;选项均有 label/desc", () => {
    expect(WRITING_DIMENSIONS.map((d) => d.key)).toEqual(["form", "tone", "length", "visual"]);
    for (const d of WRITING_DIMENSIONS) {
      const keys = d.options.map((o) => o.key);
      expect(new Set(keys).size).toBe(keys.length);
      expect(keys.length).toBeGreaterThanOrEqual(2);
      for (const o of d.options) {
        expect(o.label).not.toBe("");
        expect(o.desc).not.toBe("");
      }
    }
  });

  it("选择 key 与 WritingSelection 对齐(合成/面板同源)", () => {
    const byDim = Object.fromEntries(
      WRITING_DIMENSIONS.map((d) => [d.key, d.options.map((o) => o.key)]),
    );
    const sel: WritingSelection = {
      form: "video-recommend",
      tone: "editorial",
      length: "standard",
      visual: "minimal",
    };
    expect(byDim.form).toContain(sel.form);
    expect(byDim.tone).toContain(sel.tone);
    expect(byDim.length).toContain(sel.length);
    expect(byDim.visual).toContain(sel.visual);
  });
});
