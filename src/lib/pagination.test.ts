/**
 * 分页页码解析单测(2026-11-01 收口时补):两种语义固化为契约 ——
 * API/admin 非法回落 1;站内 /page/[page] 非法必须 null 交给 notFound,
 * 绝不能静默落到第 1 页(否则同一内容两个 URL 都能访问)。
 */
import { describe, expect, it } from "vitest";

import { parsePage, parsePageFromSecond } from "./pagination";

describe("parsePage(API/管理页:非法回落 1)", () => {
  it.each([
    ["3", 3],
    ["1", 1],
    ["0", 1],
    ["-2", 1],
    ["abc", 1],
    ["", 1],
    [null, 1],
    [undefined, 1],
  ])("%s → %s", (raw, expected) => {
    expect(parsePage(raw)).toBe(expected);
  });
});

describe("parsePageFromSecond(站内分页路由:仅 >=2 合法)", () => {
  it.each([
    ["2", 2],
    ["17", 17],
    ["1", null],
    ["0", null],
    ["-3", null],
    ["abc", null],
    ["", null],
    [null, null],
    [undefined, null],
  ])("%s → %s", (raw, expected) => {
    expect(parsePageFromSecond(raw)).toBe(expected);
  });
});
