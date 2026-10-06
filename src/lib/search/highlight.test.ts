import { describe, expect, it } from "vitest";

import { highlightSegments } from "./highlight";

describe("highlightSegments", () => {
  it("单词项切段,大小写不敏感且保留原文大小写", () => {
    expect(highlightSegments("MCP 入门到实战", ["mcp"])).toEqual([{ mark: "MCP" }, " 入门到实战"]);
  });

  it("多词项多命中", () => {
    expect(highlightSegments("Agent 框架与 Agent 编排", ["agent", "框架"])).toEqual([
      { mark: "Agent" },
      " ",
      { mark: "框架" },
      "与 ",
      { mark: "Agent" },
      " 编排",
    ]);
  });

  it("长词优先,短词不嵌进长词区间", () => {
    // 「agent框架」整词命中优先于其内部的「agent」
    expect(highlightSegments("Agent框架发布", ["agent", "agent框架"])).toEqual([
      { mark: "Agent框架" },
      "发布",
    ]);
  });

  it("无命中返回原文单段", () => {
    expect(highlightSegments("纯文本", ["zzz"])).toEqual(["纯文本"]);
  });

  it("空词项/空文本", () => {
    expect(highlightSegments("文本", [])).toEqual(["文本"]);
    expect(highlightSegments("", ["x"])).toEqual([]);
  });

  it("相邻命中不吞字", () => {
    expect(highlightSegments("abc", ["ab", "c"])).toEqual([{ mark: "ab" }, { mark: "c" }]);
  });
});
