/**
 * 联想词契约解析单测(M25 批④):样本取自 2026-10-12 真机实证捕获
 * (首验两源形态全偏的修正回归钉点)。
 */
import { describe, expect, it } from "vitest";

import { BiliApiUnavailableError } from "./bili/errors";
import { parseBiliSuggest, parseBingSuggest } from "./suggest";

/** 真机捕获裁剪:bili main/suggest({code,result.tag[].value},name 带 <em> 高亮) */
const BILI_PAYLOAD = {
  exp_str: "",
  code: 0,
  result: {
    tag: [
      {
        value: "cursor教程从入门到精通",
        term: "cursor教程从入门到精通",
        ref: 0,
        name: '<em class="suggest_high_light">cursor教程</em>从入门到精通',
        spid: 5,
        type: "",
        item_feature: "",
      },
      { value: "cursor教程python", term: "cursor教程python", ref: 0, name: "…", spid: 5 },
    ],
  },
};

/** 真机捕获:bing osjson 五元([query, terms, [], [], 相关度元数据]) */
const BING_PAYLOAD = [
  "cursor 教程",
  ["cursor 教程", "cursor教程中文", "cursor 教程 2026", "cursor教程从0到一", "cursor 教程 b站"],
  [],
  [],
  { "google:suggestrelevance": [1300, 1299, 1298, 1297, 1296] },
];

describe("parseBiliSuggest(真机实证形态)", () => {
  it("顶层 result.tag[].value 提词,name 的 <em> 高亮不影响 value", () => {
    expect(parseBiliSuggest(BILI_PAYLOAD)).toEqual(["cursor教程从入门到精通", "cursor教程python"]);
  });

  it("tag 缺省 → 空数组(不报错,产出即空)", () => {
    expect(parseBiliSuggest({ code: 0 })).toEqual([]);
    expect(parseBiliSuggest({ code: 0, result: {} })).toEqual([]);
  });

  it("形态偏离(tag 条目缺 value / 非对象)→ BiliApiUnavailableError", () => {
    expect(() => parseBiliSuggest({ code: 0, result: { tag: [{ name: "no value" }] } })).toThrow(
      BiliApiUnavailableError,
    );
    expect(() => parseBiliSuggest("not json shape")).toThrow(BiliApiUnavailableError);
  });

  it("首验踩坑回归钉点:旧误解形态 data.tag 剥离未知键 → 空产出而非报错(缺 tag 合法)", () => {
    expect(parseBiliSuggest({ code: 0, data: { tag: [{ value: "x" }] } })).toEqual([]);
  });
});

describe("parseBingSuggest(真机实证形态)", () => {
  it("五元取 [1] 词表;首尾空白 trim、空词滤除", () => {
    expect(parseBingSuggest(BING_PAYLOAD)).toEqual([
      "cursor 教程",
      "cursor教程中文",
      "cursor 教程 2026",
      "cursor教程从0到一",
      "cursor 教程 b站",
    ]);
    expect(parseBingSuggest(["q", ["  a  ", "", "b"], [], [], {}])).toEqual(["a", "b"]);
  });

  it("二元组(旧记忆形态)同兼容(rest 放行任意尾缀)", () => {
    expect(parseBingSuggest(["q", ["a"]])).toEqual(["a"]);
  });

  it("形态偏离(元素不足 / [1] 非词表)→ BiliApiUnavailableError", () => {
    expect(() => parseBingSuggest(["q"])).toThrow(BiliApiUnavailableError);
    expect(() => parseBingSuggest(["q", "not-array"])).toThrow(BiliApiUnavailableError);
  });
});
