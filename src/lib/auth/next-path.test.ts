/**
 * 回跳参数单测:钉 open redirect 防线契约(仅站内根相对路径;拒 //、/\、
 * 外链/空值)与 sessionStorage 便签链路(node 环境以最小 stub 模拟)。
 */
import { afterEach, describe, expect, it } from "vitest";

import {
  clearPostLoginNext,
  normalizeNextPath,
  readPostLoginNext,
  savePostLoginNext,
  withNext,
} from "./next-path";

function stubSessionStorage(): Storage {
  const map = new Map<string, string>();
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
    clear: () => map.clear(),
    key: () => null,
    get length() {
      return map.size;
    },
  };
}

describe("normalizeNextPath(open redirect 防线)", () => {
  it("站内根相对路径放行", () => {
    expect(normalizeNextPath("/post/136-lm-evaluation-harness/")).toBe(
      "/post/136-lm-evaluation-harness/",
    );
    expect(normalizeNextPath("/pay/ORD1")).toBe("/pay/ORD1");
    expect(normalizeNextPath("/")).toBe("/");
  });

  it("协议相对 //、反斜杠 /\\、外链、空值一律回首页", () => {
    expect(normalizeNextPath("//evil.com")).toBe("/");
    expect(normalizeNextPath("/\\evil.com")).toBe("/");
    expect(normalizeNextPath("https://evil.com/post")).toBe("/");
    expect(normalizeNextPath("javascript:alert(1)")).toBe("/");
    expect(normalizeNextPath(undefined)).toBe("/");
    expect(normalizeNextPath(null)).toBe("/");
    expect(normalizeNextPath("")).toBe("/");
  });
});

describe("withNext(站内跳转链构造)", () => {
  it("有效 next 编码拼接;无 next 返回原路径", () => {
    expect(withNext("/login", "/post/136-x/")).toBe("/login?next=%2Fpost%2F136-x%2F");
    expect(withNext("/register", undefined)).toBe("/register");
    expect(withNext("/register", "//evil.com")).toBe("/register");
  });
});

describe("sessionStorage 便签(node 环境以 stub 模拟)", () => {
  afterEach(() => {
    // @ts-expect-error 测试后拆桩,避免泄漏到其它用例
    delete globalThis.window;
  });

  it("save→read→clear 往返;无效路径与无 window 均静默", () => {
    globalThis.window = { sessionStorage: stubSessionStorage() } as unknown as Window &
      typeof globalThis;

    expect(readPostLoginNext()).toBeNull(); // 未存
    savePostLoginNext("/post/136-lm-evaluation-harness/");
    expect(readPostLoginNext()).toBe("/post/136-lm-evaluation-harness/");
    savePostLoginNext("//evil.com"); // 无效不覆盖
    expect(readPostLoginNext()).toBe("/post/136-lm-evaluation-harness/");
    clearPostLoginNext();
    expect(readPostLoginNext()).toBeNull();
  });

  it("无 window(SSR/异常环境)不抛错", () => {
    expect(() => savePostLoginNext("/a")).not.toThrow();
    expect(readPostLoginNext()).toBeNull();
    expect(() => clearPostLoginNext()).not.toThrow();
  });
});
