/** 增量聚类纯函数单测:归簇判定(过短短路/阈值内外分流)与介质并集(白名单/去重)。 */
import { describe, expect, it } from "vitest";

import { decideAssignment, majorityRegion, unionMedia } from "./cluster";

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

describe("majorityRegion(M58 批①:簇地域=成员多数,差距 <20% 判 mixed)", () => {
  it("全 cn / 全 global → 对应地域", () => {
    expect(majorityRegion(["cn", "cn", null])).toBe("cn");
    expect(majorityRegion(["global", "global", undefined])).toBe("global");
  });

  it("压倒多数 → 多数方(未知成员不计入分母)", () => {
    expect(majorityRegion(["cn", "cn", "cn", "global"])).toBe("cn");
    expect(majorityRegion([null, "global", "global", "cn", undefined])).toBe("global");
  });

  it("cn/global 差距 <20% → mixed;恰 20% 仍归多数方(边界取 < 而非 ≤)", () => {
    // 4:4 → 0%;9:8 → 5.9% → mixed
    expect(majorityRegion(["cn", "global", "cn", "global"])).toBe("mixed");
    expect(
      majorityRegion([
        "cn",
        "cn",
        "cn",
        "cn",
        "global",
        "global",
        "global",
        "cn",
        "cn",
        "cn",
        "cn",
        "cn",
        "global",
        "global",
        "global",
        "global",
        "global",
      ]),
    ).toBe("mixed");
    // 3:2 → 恰 20% → 不 mixed,取多数
    expect(majorityRegion(["cn", "cn", "cn", "global", "global"])).toBe("cn");
  });

  it("无已知地域 → null(存量/未知成员不臆造地域)", () => {
    expect(majorityRegion([])).toBeNull();
    expect(majorityRegion([null, undefined])).toBeNull();
  });
});

describe("decideAssignment 短文本严配归簇(M52 批D)", () => {
  const nearest = { clusterId: BigInt(7), distance: 0.25 };

  it("短文本 + 严阈值内 → join(不建簇)", () => {
    const d = decideAssignment(nearest, 2, 4, 0.35, 0.28);
    expect(d).toEqual({ action: "join", clusterId: BigInt(7) });
  });

  it("短文本 + 超严阈值(常规阈值内也不行)→ short", () => {
    // 0.3 在常规阈值(0.35)内但超严阈值(0.28)→ 仍 short(短文本永不建簇)
    expect(decideAssignment({ clusterId: BigInt(7), distance: 0.3 }, 2, 4, 0.35, 0.28)).toEqual({
      action: "short",
    });
    expect(decideAssignment({ clusterId: BigInt(7), distance: 0.32 }, 2, 4, 0.35, 0.28)).toEqual({
      action: "short",
    });
    expect(decideAssignment(undefined, 2, 4, 0.35, 0.28)).toEqual({ action: "short" });
  });
});
