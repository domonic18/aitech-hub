/**
 * 答案文本解析单测(K2):哨兵切分(变体/截断/漏哨兵降级)、流式可见前缀
 * (哨兵与半截哨兵扣住)、[n] 引用上标段合并。
 */
import { describe, expect, it } from "vitest";

import { FOLLOW_SENTINEL, parseAnswerSup, splitSentinel, visiblePrefix } from "./answer-parse";

describe("splitSentinel", () => {
  it("哨兵切正文与 3 条追问,剥列表符", () => {
    const raw = `答案正文[1]。${FOLLOW_SENTINEL}\n- 追问一?\n2. 追问二?\n* 追问三?\n- 多余第四条`;
    const r = splitSentinel(raw);
    expect(r.answer).toBe("答案正文[1]。");
    expect(r.followUps).toEqual(["追问一?", "追问二?", "追问三?"]);
  });

  it("追问超 20 字截断;空行过滤", () => {
    const long = "这是一个特别特别特别特别特别特别特别特别特别特别长的追问建议";
    const r = splitSentinel(`${FOLLOW_SENTINEL}\n\n- ${long}\n- 短的`);
    expect(r.followUps[0]).toHaveLength(20);
    expect(r.followUps[1]).toBe("短的");
    expect(r.followUps).toHaveLength(2);
  });

  it("漏哨兵 → 全文为答案、无 chips(优雅降级)", () => {
    expect(splitSentinel("只有正文")).toEqual({ answer: "只有正文", followUps: [] });
  });

  it("宽松变体 #### FOLLOW 同样切开", () => {
    const r = splitSentinel("正文\n#### FOLLOW\n- a\n- b\n- c");
    expect(r.answer).toBe("正文");
    expect(r.followUps).toEqual(["a", "b", "c"]);
  });
});

describe("visiblePrefix", () => {
  it("无哨兵 → 原文;完整哨兵 → 扣住其后全部", () => {
    expect(visiblePrefix("答案一二三")).toBe("答案一二三");
    expect(visiblePrefix(`答案${FOLLOW_SENTINEL}\n- x`)).toBe("答案");
  });

  it("尾部半截哨兵扣住(分帧不泄漏)", () => {
    expect(visiblePrefix("答案\n##")).toBe("答案\n");
    expect(visiblePrefix("答案\n###FOL")).toBe("答案\n");
    expect(visiblePrefix("答案\n###FOLLOW")).toBe("答案\n"); // 完整哨兵缺尾 ###
  });

  it("流式拼接全序:两段增量下可见前缀单调且最终等价 splitSentinel", () => {
    const full = `AI 解读[1]。${FOLLOW_SENTINEL}\n- a`;
    const mid = visiblePrefix(full.slice(0, 10));
    expect(full.startsWith(mid)).toBe(true);
    expect(visiblePrefix(full)).toBe("AI 解读[1]。");
  });
});

describe("parseAnswerSup", () => {
  it("[n] → 上标段;连续引用并入同一上标", () => {
    expect(parseAnswerSup("依据[1]与[2][3]作答")).toEqual([
      "依据",
      { sup: [1] },
      "与",
      { sup: [2, 3] },
      "作答",
    ]);
  });

  it("两位编号;无引用纯文本单段;空串", () => {
    expect(parseAnswerSup("x[12]y")).toEqual(["x", { sup: [12] }, "y"]);
    expect(parseAnswerSup("纯文本")).toEqual(["纯文本"]);
    expect(parseAnswerSup("")).toEqual([]);
  });
});
