/**
 * L0 准入过滤单测(M58 批④):四闸口径——过短(剥 URL 后 <8 字)、纯符号、
 * 营销/导流句式、批内归一化重复;正常社区原话不得误杀。
 */
import { describe, expect, it } from "vitest";

import { l0Digest, l0Screen, L0_MIN_TEXT_LEN, normalizeForDedupe } from "./l0";

describe("l0Screen", () => {
  it("放行正常需求原话(中英文)", () => {
    const out = l0Screen([
      { text: "有没有好用的 AI 编程助手推荐?想给团队统一采购" },
      { text: "Looking for a local LLM to summarize long documents" },
    ]);
    expect(out.accepted).toHaveLength(2);
    expect(out.rejected).toHaveLength(0);
  });

  it("过短:剥掉 URL 后不足 8 字(r=too_short)", () => {
    const out = l0Screen([{ text: "AI 工具" }, { text: "https://example.com/abc" }]);
    expect(out.accepted).toHaveLength(0);
    expect(out.rejected.map((r) => r.reason)).toEqual(["too_short", "too_short"]);
    expect([..."AI 工具"].length).toBeLessThan(L0_MIN_TEXT_LEN);
  });

  it("纯符号/表情(r=symbol_only)", () => {
    const out = l0Screen([{ text: "!!!??? ---🔥🔥🔥" }]);
    expect(out.rejected[0]?.reason).toBe("symbol_only");
  });

  it("营销/导流句式(r=marketing)", () => {
    const out = l0Screen([
      { text: "加微信领取 AI 课程资料,名额有限" },
      { text: "扫码进群,免费领 ChatGPT 账号" },
      { text: "关注公众号回复 666 获取提示词合集" },
    ]);
    expect(out.accepted).toHaveLength(0);
    expect(out.rejected.every((r) => r.reason === "marketing")).toBe(true);
  });

  it("「联系我」类真实求助不误杀", () => {
    const out = l0Screen([{ text: "有个数据迁移的问题想请教,方便的话请联系我" }]);
    expect(out.accepted).toHaveLength(1);
  });

  it("批内归一化重复:大小写/标点/空白差异视为同条,只留首条", () => {
    const out = l0Screen([
      { text: "AI 编程工具怎么选?" },
      { text: "ai编程工具怎么选" },
      { text: "AI 编程工具怎么选?!" },
    ]);
    expect(out.accepted).toHaveLength(1);
    expect(out.rejected.map((r) => r.reason)).toEqual(["duplicate", "duplicate"]);
  });

  it("digest 稳定且与标点无关", () => {
    expect(normalizeForDedupe("AI, 工具！")).toBe(normalizeForDedupe("ai工具"));
    expect(l0Digest("Same Text")).toBe(l0Digest("same-text"));
  });
});
