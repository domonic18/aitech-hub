import { describe, expect, it } from "vitest";

import { MAX_QUERY_TERMS, MAX_TERM_LEN, tokenizeQuery } from "./tokenize";

describe("tokenizeQuery", () => {
  it("空白/标点切分并小写归一", () => {
    expect(tokenizeQuery("MCP 入门,到实战!")).toEqual(["mcp", "入门", "到实战"]);
  });

  it("CJK 连续段保留为整词(含数字混合)", () => {
    expect(tokenizeQuery("Agent框架")).toEqual(["agent框架"]);
    expect(tokenizeQuery("Claude5 实战")).toEqual(["claude5", "实战"]);
  });

  it("去重保序", () => {
    expect(tokenizeQuery("MCP mcp Mcp 实战")).toEqual(["mcp", "实战"]);
  });

  it("截断超上限词项数(保序取前 MAX_QUERY_TERMS)", () => {
    const terms = tokenizeQuery("a b c d e f g h i j");
    expect(terms).toHaveLength(MAX_QUERY_TERMS);
    expect(terms).toEqual(["a", "b", "c", "d", "e", "f", "g", "h"]);
  });

  it("单词项截断到 MAX_TERM_LEN", () => {
    const long = "x".repeat(50);
    expect(tokenizeQuery(long)).toEqual(["x".repeat(MAX_TERM_LEN)]);
  });

  it("空 q / 纯标点 → []", () => {
    expect(tokenizeQuery("")).toEqual([]);
    expect(tokenizeQuery("   ")).toEqual([]);
    expect(tokenizeQuery("!?.,、")).toEqual([]);
  });
});
