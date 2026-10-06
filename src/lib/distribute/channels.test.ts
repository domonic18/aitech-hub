/**
 * 分发渠道常量纯工具单测:clampDigest 按码点截断(汉字/emoji 代理对算 1)。
 */
import { describe, expect, it } from "vitest";

import { clampDigest, WECHAT_DIGEST_MAX } from "./channels";

describe("clampDigest", () => {
  it("不超上限原样返回", () => {
    expect(clampDigest("短摘要")).toBe("短摘要");
  });

  it("汉字按码点截到 120(String.length 会把代理对算 2,此处不得)", () => {
    const text = "一".repeat(WECHAT_DIGEST_MAX + 10);
    expect(clampDigest(text)).toHaveLength(WECHAT_DIGEST_MAX);
    expect([...clampDigest(text)]).toHaveLength(WECHAT_DIGEST_MAX);
  });

  it("emoji(代理对)按 1 码点计,截断不产生半个字符", () => {
    const text = "🤖".repeat(WECHAT_DIGEST_MAX + 5);
    const out = clampDigest(text);
    expect([...out]).toHaveLength(WECHAT_DIGEST_MAX);
    expect(out.startsWith("🤖")).toBe(true);
  });

  it("自定义上限生效", () => {
    expect(clampDigest("abcdef", 3)).toBe("abc");
  });
});
