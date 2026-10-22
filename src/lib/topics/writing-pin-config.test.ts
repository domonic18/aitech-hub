/**
 * 贴图创作配置单测(M42 创作中心):条款往返(画面行恒出、风格行有值才出)、
 * 补充块 verbatim 无损、张数收敛到 1..20、契约行被手改/越界进 custom 且内容
 * 不丢、与长文配置互不派生(独立列纪律的解析侧锚点)。
 */
import { describe, expect, it } from "vitest";

import { PIN_ASPECTS, PIN_ASPECT_LABEL, PIN_CROP_LABEL } from "./writing-pin-config";
import {
  clampPinCount,
  composePinWritingText,
  DEFAULT_PIN_WRITING_SELECTION,
  PIN_COUNT_MAX,
  PIN_COUNT_MIN,
  parsePinWritingText,
  pinReferenceOf,
  pinStyleOf,
} from "./writing-pin-config";
import { SUPPLEMENT_HEADER, composeWritingText, parseWritingText } from "./writing-config";
import { DEFAULT_WRITING_SELECTION } from "./writing-config";

const DEFAULT_FRAME = "画面:共 6 张,比例 3:4,首图裁剪 1_1。";

describe("composePinWritingText", () => {
  it("全缺省 = 仅画面条款行(风格空不出一行)", () => {
    expect(composePinWritingText(DEFAULT_PIN_WRITING_SELECTION)).toBe(DEFAULT_FRAME);
  });

  it("非缺省比例/裁剪/风格逐项落行;风格行在画面行之后", () => {
    const text = composePinWritingText({
      count: 9,
      aspect: "1:1",
      crop: "2.35_9",
      style: "手绘笔记风,米白纸底",
      reference: "",
    });
    expect(text).toBe(
      ["画面:共 9 张,比例 1:1,首图裁剪 2.35_9。", "风格:手绘笔记风,米白纸底"].join("\n"),
    );
  });

  it("补充要求接【补充要求】分界,verbatim 保留", () => {
    const text = composePinWritingText(DEFAULT_PIN_WRITING_SELECTION, " 每张都要带中文标题 ");
    expect(text).toBe(`${DEFAULT_FRAME}\n${SUPPLEMENT_HEADER}\n每张都要带中文标题`);
  });

  it("张数越界在合成侧收敛(0→1、99→20),不产出非法契约行", () => {
    const low = composePinWritingText({ ...DEFAULT_PIN_WRITING_SELECTION, count: 0 });
    const high = composePinWritingText({ ...DEFAULT_PIN_WRITING_SELECTION, count: 99 });
    expect(low).toBe("画面:共 1 张,比例 3:4,首图裁剪 1_1。");
    expect(high).toBe(`画面:共 ${PIN_COUNT_MAX} 张,比例 3:4,首图裁剪 1_1。`);
  });
});

describe("parsePinWritingText", () => {
  it("规范文本往返幂等(parse→compose === 原文)", () => {
    const text = composePinWritingText(
      { count: 4, aspect: "16:9", crop: "16_9", style: "扁平插画", reference: "" },
      "少用阴影",
    );
    const parsed = parsePinWritingText(text);
    expect(parsed.custom).toBe(false);
    expect(composePinWritingText(parsed.selection, parsed.supplement)).toBe(text);
  });

  it("null/空串回落缺省,无补充", () => {
    for (const text of [null, "", "   "]) {
      const parsed = parsePinWritingText(text);
      expect(parsed.selection).toEqual(DEFAULT_PIN_WRITING_SELECTION);
      expect(parsed.supplement).toBe("");
      expect(parsed.custom).toBe(false);
    }
  });

  it("未识别行一律收进补充块(无损不变量)", () => {
    const parsed = parsePinWritingText(`${DEFAULT_FRAME}\n要更亮一点`);
    expect(parsed.selection.count).toBe(6);
    expect(parsed.supplement).toBe("要更亮一点");
    expect(parsed.custom).toBe(false);
  });

  it("画面行被手改 → custom,原文不丢", () => {
    const parsed = parsePinWritingText("画面:来 8 张,竖的");
    expect(parsed.custom).toBe(true);
    expect(parsed.supplement).toContain("画面:来 8 张,竖的");
    expect(parsed.selection).toEqual(DEFAULT_PIN_WRITING_SELECTION);
  });

  it("张数越界仍收敛并标 custom(存量手改不炸)", () => {
    const parsed = parsePinWritingText("画面:共 25 张,比例 1:1,首图裁剪 1_1。");
    expect(parsed.selection.count).toBe(PIN_COUNT_MAX);
    expect(parsed.selection.aspect).toBe("1:1");
    expect(parsed.custom).toBe(true);
  });

  it("重复画面行 -> custom,后者生效(防御同维冲突)", () => {
    const parsed = parsePinWritingText(
      ["画面:共 3 张,比例 1:1,首图裁剪 1_1。", "画面:共 5 张,比例 3:4,首图裁剪 16_9。"].join("\n"),
    );
    expect(parsed.custom).toBe(true);
    expect(parsed.selection).toMatchObject({ count: 5, aspect: "3:4", crop: "16_9" });
  });

  it("补充正文里再出现同款分界头不会被二次切分", () => {
    const parsed = parsePinWritingText(
      `${DEFAULT_FRAME}\n${SUPPLEMENT_HEADER}\n第一段\n${SUPPLEMENT_HEADER}\n第二段`,
    );
    expect(parsed.supplement).toBe(`第一段\n${SUPPLEMENT_HEADER}\n第二段`);
  });
});

describe("双配置互不派生", () => {
  it("长文条款文本不会被贴图解析认领,反之亦然", () => {
    const articleText = composeWritingText({ ...DEFAULT_WRITING_SELECTION, visual: "illustrate" });
    const pinParsed = parsePinWritingText(articleText);
    expect(pinParsed.selection).toEqual(DEFAULT_PIN_WRITING_SELECTION);
    expect(pinParsed.supplement).toContain("配图:文生图图文为主");

    const pinText = composePinWritingText({ ...DEFAULT_PIN_WRITING_SELECTION, style: "水彩" });
    const articleParsed = parseWritingText(pinText);
    expect(articleParsed.selection.visual).toBe("cards");
    expect(articleParsed.supplement).toContain("画面:共 6 张");
  });

  it("pinStyleOf 只读风格行(空文本返回空串)", () => {
    expect(pinStyleOf(null)).toBe("");
    expect(pinStyleOf(DEFAULT_FRAME)).toBe("");
    expect(pinStyleOf(`${DEFAULT_FRAME}\n风格:极简线稿`)).toBe("极简线稿");
  });
});

describe("参照图条款(M42 参照贯通)", () => {
  const REF = "/wp-content/uploads/2026/10/sample-a.png";

  it("站内 uploads 路径往返幂等(parse→compose === 原文)", () => {
    const sel = { ...DEFAULT_PIN_WRITING_SELECTION, reference: REF };
    const text = composePinWritingText(sel, "少用阴影");
    expect(text).toContain(`参照图:${REF}`);
    const parsed = parsePinWritingText(text);
    expect(parsed.selection.reference).toBe(REF);
    expect(parsed.custom).toBe(false);
    expect(composePinWritingText(parsed.selection, parsed.supplement)).toBe(text);
  });

  it("非站内路径不采纳:不落行、解析收进补充并标 custom", () => {
    const text = composePinWritingText({
      ...DEFAULT_PIN_WRITING_SELECTION,
      reference: "https://x/a.png",
    });
    expect(text).toBe(DEFAULT_FRAME); // 外链不得写进配置
    const parsed = parsePinWritingText(`${DEFAULT_FRAME}\n参照图:https://x/a.png`);
    expect(parsed.selection.reference).toBe("");
    expect(parsed.custom).toBe(true);
    expect(parsed.supplement).toBe("参照图:https://x/a.png");
  });

  it("pinReferenceOf 只读参照行", () => {
    expect(pinReferenceOf(null)).toBe("");
    expect(pinReferenceOf(DEFAULT_FRAME)).toBe("");
    expect(pinReferenceOf(`${DEFAULT_FRAME}\n参照图:${REF}`)).toBe(REF);
  });
});

describe("常量健全性", () => {
  it("clampPinCount:非法回落缺省,合法域收敛", () => {
    expect(clampPinCount(undefined)).toBe(6);
    expect(clampPinCount(Number.NaN)).toBe(6);
    expect(clampPinCount(PIN_COUNT_MIN - 1)).toBe(PIN_COUNT_MIN);
    expect(clampPinCount(PIN_COUNT_MAX + 1)).toBe(PIN_COUNT_MAX);
    expect(clampPinCount(7.9)).toBe(7);
  });

  it("比例/裁剪展示名全覆盖(UI 选项与契约字面量同源)", () => {
    for (const a of PIN_ASPECTS) expect(PIN_ASPECT_LABEL[a].length).toBeGreaterThan(0);
    for (const c of ["1_1", "16_9", "2.35_9"] as const) {
      expect(PIN_CROP_LABEL[c].length).toBeGreaterThan(0);
    }
  });
});
