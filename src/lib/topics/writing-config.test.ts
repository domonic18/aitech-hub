/**
 * 写作配置单测(2026-10-20 详情页重构;2026-10-21 §13.8 交互重构):合成/
 * 解析往返(缺省=纯模板存量兼容、条款行精确回显)+ 三段式载体(体裁模板 +
 * 条款行 +【补充要求】自由块)——补充要求 verbatim 往返、custom 仅=体裁模板
 * 被手改/条款冲突(自由文本不再触发)、无损不变量(未识别行一律收进补充块,
 * 保存永不销毁内容)、规范文本幂等(parse→compose===原文)、deriveSkillKey
 * 带补充照常派生(§13.8 修复:自由文本不再杀死技能路由)、条款注册表健全性
 * (唯一且非空——反向解析锚点,文案改动必须连测试一起改)。
 */
import { describe, expect, it } from "vitest";

import { DEFAULT_TOPIC_POSITIONING, TOPIC_PURPOSES, TUTORIAL_TOPIC_POSITIONING } from "./constants";
import {
  composeWritingText,
  DEFAULT_WRITING_SELECTION,
  deriveSkillKey,
  parseWritingText,
  resolvePurpose,
  skipCoverGeneration,
  SUPPLEMENT_HEADER,
  WRITING_DIMENSIONS,
  type WritingSelection,
} from "./writing-config";

const EDITORIAL = "口吻:专业编辑,克制陈述,让数据与事实说话,少用感叹号与网络流行语。";
const COMPACT = "篇幅:精炼,全文约 800 字,每节只留一个核心论点与一条证据。";
const ILLUSTRATE =
  "配图:文生图图文为主,由 AI 按小节内容编排呈现形态(文字入图;数据密集内容仍可配信息卡)。";
const MINIMAL = "配图:少图,最多 1 张信息卡,以文字与行内链接表达为主。";
const SKIP_CLAUSE = "封面:不生成封面图,重写时保留现有封面。";
const SAMPLE_SUPP = "多用具体数字,少用形容词;结尾给读者一个立刻能做的动作。";

describe("composeWritingText(选择 + 补充 → 写作要求文本)", () => {
  it("全缺省 = 纯模板原文(老专题存量定位无损)", () => {
    expect(composeWritingText(DEFAULT_WRITING_SELECTION)).toBe(DEFAULT_TOPIC_POSITIONING);
  });

  it("非缺省维追加条款行,缺省维不出行;行序固定 口吻→篇幅→配图(封面缺省不出行)", () => {
    const text = composeWritingText({
      form: "video-tutorial",
      tone: "editorial",
      length: "compact",
      visual: "minimal",
      cover: "generate",
    });
    expect(text).toBe([TUTORIAL_TOPIC_POSITIONING, EDITORIAL, COMPACT, MINIMAL].join("\n"));
  });

  it("只改配图 = 模板 + 单条配图条款(插画/少图各归其位)", () => {
    const illu = composeWritingText({ ...DEFAULT_WRITING_SELECTION, visual: "illustrate" });
    expect(illu).toBe(`${DEFAULT_TOPIC_POSITIONING}\n${ILLUSTRATE}`);
    const min = composeWritingText({ ...DEFAULT_WRITING_SELECTION, visual: "minimal" });
    expect(min).toBe(`${DEFAULT_TOPIC_POSITIONING}\n${MINIMAL}`);
  });

  it("带补充要求:头两段之后接【补充要求】分界,补充文本 verbatim(§13.8 三段式)", () => {
    const text = composeWritingText(
      { ...DEFAULT_WRITING_SELECTION, visual: "illustrate" },
      SAMPLE_SUPP,
    );
    expect(text).toBe(
      [DEFAULT_TOPIC_POSITIONING, ILLUSTRATE, SUPPLEMENT_HEADER, SAMPLE_SUPP].join("\n"),
    );
  });

  it("补充为空/纯空白/显式 null → 不出补充头(与无补充同构)", () => {
    expect(composeWritingText(DEFAULT_WRITING_SELECTION, "  \n  ")).toBe(DEFAULT_TOPIC_POSITIONING);
    expect(composeWritingText(DEFAULT_WRITING_SELECTION, null)).toBe(DEFAULT_TOPIC_POSITIONING);
  });
});

describe("parseWritingText(写作要求文本 → 选择 + 补充)", () => {
  it("null/空串 → 全缺省、无补充、非自定义(未设置=按缺省理解)", () => {
    expect(parseWritingText(null)).toEqual({
      selection: DEFAULT_WRITING_SELECTION,
      supplement: "",
      custom: false,
    });
    expect(parseWritingText("  ")).toEqual({
      selection: DEFAULT_WRITING_SELECTION,
      supplement: "",
      custom: false,
    });
  });

  it("纯模板 → 全缺省;带条款行 → 对应维回显、无补充、custom=false", () => {
    const plain = parseWritingText(DEFAULT_TOPIC_POSITIONING);
    expect(plain).toEqual({ selection: DEFAULT_WRITING_SELECTION, supplement: "", custom: false });
    const p = parseWritingText(
      composeWritingText({ ...DEFAULT_WRITING_SELECTION, tone: "editorial", length: "compact" }),
    );
    expect(p.selection).toEqual({
      ...DEFAULT_WRITING_SELECTION,
      tone: "editorial",
      length: "compact",
    });
    expect(p.supplement).toBe("");
    expect(p.custom).toBe(false);
  });

  it("教程模板 + 条款往返不失真(form 回显 video-tutorial)", () => {
    const text = composeWritingText({
      form: "video-tutorial",
      tone: "friendly",
      length: "standard",
      visual: "minimal",
      cover: "generate",
    });
    expect(parseWritingText(text).selection.form).toBe("video-tutorial");
  });

  it("补充块往返:selection 全回显、supplement verbatim、custom=false(自由文本≠自定义,§13.8)", () => {
    const text = composeWritingText(
      { ...DEFAULT_WRITING_SELECTION, form: "model-pricing", length: "compact", cover: "skip" },
      SAMPLE_SUPP,
    );
    const p = parseWritingText(text);
    expect(p.selection).toEqual({
      ...DEFAULT_WRITING_SELECTION,
      form: "model-pricing",
      length: "compact",
      cover: "skip",
    });
    expect(p.supplement).toBe(SAMPLE_SUPP);
    expect(p.custom).toBe(false);
  });

  it("体裁模板被手改 → custom=true、form 回落缺省(不猜);手改 prose 无损收进补充块", () => {
    const handEdited = DEFAULT_TOPIC_POSITIONING.replace("口语化", "书面化");
    const p = parseWritingText(`${handEdited}\n${MINIMAL}`);
    expect(p.custom).toBe(true);
    expect(p.selection.visual).toBe("minimal"); // 已知条款行仍回显
    expect(p.selection.form).toBe(DEFAULT_WRITING_SELECTION.form);
    expect(p.supplement).toBe(handEdited);
  });

  it("条款行之外多出手写行 → custom=true 且无损收进补充块(模板+手写行都在)", () => {
    const text = `${composeWritingText(DEFAULT_WRITING_SELECTION)}\n多用具体数字,少用形容词。`;
    const p = parseWritingText(text);
    expect(p.custom).toBe(true);
    expect(p.supplement).toContain("多用具体数字,少用形容词。");
    expect(p.supplement).toContain(DEFAULT_TOPIC_POSITIONING);
  });

  it("补充块内的条款样式行不回显进选项(解析只认第一处分界头)", () => {
    const text = `${composeWritingText(DEFAULT_WRITING_SELECTION)}\n${SUPPLEMENT_HEADER}\n${ILLUSTRATE}`;
    const p = parseWritingText(text);
    expect(p.custom).toBe(false); // 头两段是纯模板,体裁精确匹配
    expect(p.selection.visual).toBe("cards"); // 块内条款行留在补充里
    expect(p.supplement).toBe(ILLUSTRATE);
  });

  it("同维条款重复/冲突 → custom=true(防御:不该出现,提示核对)", () => {
    const dup = `${DEFAULT_TOPIC_POSITIONING}\n${ILLUSTRATE}\n${ILLUSTRATE}`;
    expect(parseWritingText(dup).custom).toBe(true);
    const conflict = `${DEFAULT_TOPIC_POSITIONING}\n${ILLUSTRATE}\n${MINIMAL}`;
    expect(parseWritingText(conflict).custom).toBe(true);
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

  it("规范文本幂等:parse→compose === 原文(保存不改写用户内容)", () => {
    const sel: WritingSelection = {
      ...DEFAULT_WRITING_SELECTION,
      form: "video-tutorial",
      tone: "editorial",
      visual: "illustrate",
      cover: "skip",
    };
    const text = composeWritingText(sel, SAMPLE_SUPP);
    const p = parseWritingText(text);
    expect(composeWritingText(p.selection, p.supplement || null)).toBe(text);
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

  it("带补充要求照常派生(§13.8 修复:自由文本不再杀死技能路由)", () => {
    const withSupp = composeWritingText(
      { ...DEFAULT_WRITING_SELECTION, form: "model-pricing", length: "compact" },
      SAMPLE_SUPP,
    );
    expect(deriveSkillKey(withSupp)).toBe("model-pricing");
  });

  it("体裁被手改(custom)→ undefined(不动人工绑定);7 形式全量可派生", () => {
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

  it("模板 + 条款 + 补充(全由选择合成)仍非自定义,体裁词照常派生(§13.8)", () => {
    const r = resolvePurpose(
      composeWritingText({ ...DEFAULT_WRITING_SELECTION, length: "compact" }, SAMPLE_SUPP),
    );
    expect(r).toEqual({ label: "视频安利", genreWord: "视频安利稿", custom: false });
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
      cover: "generate",
    };
    expect(byDim.form).toContain(sel.form);
    expect(byDim.tone).toContain(sel.tone);
    expect(byDim.length).toContain(sel.length);
    expect(byDim.visual).toContain(sel.visual);
  });
});

describe("封面图勾选(M39 批④+:compose/parse 往返 + 守卫同源)", () => {
  it("缺省勾选不出条款行(纯模板解析回 generate);取消勾选 = 精确条款行,往返回显 skip", () => {
    expect(parseWritingText(DEFAULT_TOPIC_POSITIONING).selection.cover).toBe("generate");
    const skip = composeWritingText({ ...DEFAULT_WRITING_SELECTION, cover: "skip" });
    expect(skip).toBe(`${DEFAULT_TOPIC_POSITIONING}\n${SKIP_CLAUSE}`);
    expect(parseWritingText(skip)).toEqual({
      selection: { ...DEFAULT_WRITING_SELECTION, cover: "skip" },
      supplement: "",
      custom: false,
    });
  });

  it("带补充要求时 skip 守卫仍生效(§13.8:分界头不影响条款解析)", () => {
    const skip = composeWritingText({ ...DEFAULT_WRITING_SELECTION, cover: "skip" }, SAMPLE_SUPP);
    expect(skipCoverGeneration(skip)).toBe(true);
    expect(parseWritingText(skip).supplement).toBe(SAMPLE_SUPP);
  });

  it("手改模板 + skip 条款 → cover 仍回显 skip 且 custom=true(锚点独立于 custom)", () => {
    const p = parseWritingText(`${DEFAULT_TOPIC_POSITIONING}!\n${SKIP_CLAUSE}`);
    expect(p.custom).toBe(true);
    expect(p.selection.cover).toBe("skip");
  });

  it("skipCoverGeneration(brief 标记/工具守卫同源):缺省 false;skip 条款 true(含手改)", () => {
    expect(skipCoverGeneration(null)).toBe(false);
    expect(skipCoverGeneration(DEFAULT_TOPIC_POSITIONING)).toBe(false);
    expect(
      skipCoverGeneration(composeWritingText({ ...DEFAULT_WRITING_SELECTION, cover: "skip" })),
    ).toBe(true);
    expect(skipCoverGeneration(`${DEFAULT_TOPIC_POSITIONING}!\n${SKIP_CLAUSE}`)).toBe(true);
  });
});
