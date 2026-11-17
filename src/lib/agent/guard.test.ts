/**
 * 护栏判定单测(口径分离,2026-11-17):三闸各管一件事;usage 归属把逐帧
 * usage 归到「每次模型调用」——生产实测形态(一帧=一次调用)与「每 chunk
 * 累计上报」形态都要算对(后者不得重复计入总量)。
 */
import { describe, expect, it } from "vitest";

import {
  absorbUsage,
  createUsageAccumulator,
  evaluateGuard,
  guardMessage,
  markCallEnd,
  runTokensOf,
} from "./guard";

const LIMITS = { callTokens: 96_000, toolCalls: 12, tokens: 500_000 };

describe("evaluateGuard", () => {
  it("三闸全过 → 不命中", () => {
    expect(
      evaluateGuard({ runTokens: 48_487, maxCallTokens: 15_917, toolCalls: 4 }, LIMITS),
    ).toBeNull();
  });

  it("单次调用超限 → call_tokens(优先于用量闸)", () => {
    expect(evaluateGuard({ runTokens: 600_000, maxCallTokens: 96_001, toolCalls: 1 }, LIMITS)).toBe(
      "call_tokens",
    );
  });

  it("工具调用超限 → tool_calls", () => {
    expect(evaluateGuard({ runTokens: 1000, maxCallTokens: 1000, toolCalls: 13 }, LIMITS)).toBe(
      "tool_calls",
    );
  });

  it("真实消耗超限 → tokens(单次调用未超闸时)", () => {
    expect(evaluateGuard({ runTokens: 540_006, maxCallTokens: 90_001, toolCalls: 6 }, LIMITS)).toBe(
      "tokens",
    );
  });

  it("命中闸各有可读文案", () => {
    expect(guardMessage("call_tokens")).toContain("上下文过大");
    expect(guardMessage("tool_calls")).toContain("工具调用已达上限");
    expect(guardMessage("tokens")).toContain("用量已达上限");
  });
});

describe("usage 归属", () => {
  it("生产实测形态:一帧=一次调用,总量=各次之和,单次最大=最大那次", () => {
    const acc = createUsageAccumulator();
    // 生产实测:7212 → 10501 → 14023 → 15917
    absorbUsage(acc, 7212, 108);
    absorbUsage(acc, 10501, 287);
    absorbUsage(acc, 14023, 240);
    absorbUsage(acc, 15917, 199);
    expect(acc.tokensIn).toBe(7212 + 10501 + 14023 + 15917);
    expect(acc.tokensOut).toBe(108 + 287 + 240 + 199);
    expect(runTokensOf(acc)).toBe(48_487);
    expect(acc.maxCallTokens).toBe(15_917 + 199);
  });

  it("累计上报形态(每 chunk 同值):不重复计入总量", () => {
    const acc = createUsageAccumulator();
    absorbUsage(acc, 8000, 100);
    absorbUsage(acc, 8000, 100); // 同一调用的重复上报
    absorbUsage(acc, 8000, 120); // 输出涨了 → 只补差额
    expect(acc.tokensIn).toBe(8000);
    expect(acc.tokensOut).toBe(120);
    expect(runTokensOf(acc)).toBe(8120);
  });

  it("stop 帧划调用边界:下一帧即便同值也算新调用", () => {
    const acc = createUsageAccumulator();
    absorbUsage(acc, 8000, 100);
    markCallEnd(acc);
    absorbUsage(acc, 8000, 100);
    expect(acc.tokensIn).toBe(16_000);
    expect(acc.tokensOut).toBe(200);
  });

  it("两次调用输入量相同且无 stop → 视作同一调用的累计上报", () => {
    const acc = createUsageAccumulator();
    absorbUsage(acc, 8000, 100);
    absorbUsage(acc, 8000, 100);
    expect(acc.tokensIn).toBe(8000);
  });
});
