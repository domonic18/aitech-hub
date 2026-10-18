/** 增量聚类纯函数单测:归簇判定(过短短路/阈值内外分流)与介质并集(白名单/去重)。 */
import { describe, expect, it } from "vitest";

import { decideAssignment, unionMedia } from "./cluster";

describe("decideAssignment", () => {
  const MIN_LEN = 4;
  const THRESHOLD = 0.35;

  it("最近簇距离 ≤ 阈值 → 归簇带簇 id", () => {
    expect(
      decideAssignment({ clusterId: BigInt(7), distance: 0.2 }, 20, MIN_LEN, THRESHOLD),
    ).toEqual({
      action: "join",
      clusterId: BigInt(7),
    });
  });

  it("距离恰等于阈值 → 归簇(边界含)", () => {
    expect(
      decideAssignment({ clusterId: BigInt(1), distance: 0.35 }, 20, MIN_LEN, THRESHOLD),
    ).toEqual({
      action: "join",
      clusterId: BigInt(1),
    });
  });

  it("距离超阈值或无近邻 → 建新簇", () => {
    expect(
      decideAssignment({ clusterId: BigInt(1), distance: 0.5 }, 20, MIN_LEN, THRESHOLD),
    ).toEqual({
      action: "create",
    });
    expect(decideAssignment(undefined, 20, MIN_LEN, THRESHOLD)).toEqual({ action: "create" });
  });

  it("文本过短 → short 短路(不看近邻)", () => {
    expect(
      decideAssignment({ clusterId: BigInt(1), distance: 0.1 }, 3, MIN_LEN, THRESHOLD),
    ).toEqual({
      action: "short",
    });
  });
});

describe("unionMedia", () => {
  it("并集去重,保持白名单内取值", () => {
    expect(unionMedia([["search", "voice"], ["voice", "search"], ["time"]])).toEqual([
      "search",
      "voice",
      "time",
    ]);
  });

  it("白名单外介质丢弃,null/undefined 段忽略", () => {
    expect(unionMedia([["search"], ["bogus"], null, undefined, []])).toEqual(["search"]);
  });
});
