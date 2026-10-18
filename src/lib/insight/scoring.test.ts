/** 洞察纯函数单测(原 label.test.ts 内联段拆出,随 scoring.ts):机会评分卡/
 * 覆盖度分与档位/异动判定/簇动量判定。 */
import { describe, expect, it } from "vitest";

import {
  clusterMomentum,
  computeCoverageScore,
  computeOpportunityScore,
  coverageStateOf,
  isAnomaly,
} from "./scoring";

describe("computeOpportunityScore", () => {
  it("三项加权:介质广度×40 + 近 7 日热度×30 + 内容空白×30", () => {
    // 介质 2/5=16 + 热度 5/10=15 + 空白(coverage=0.5)=15 → 46
    expect(computeOpportunityScore({ mediaCount: 2, heatNew: 5, coverage: 0.5 })).toBe(46);
  });

  it("各维饱和封顶(介质 5+、热度 10+)", () => {
    // 40 + 30 + (1-0)×30 = 100
    expect(computeOpportunityScore({ mediaCount: 9, heatNew: 99, coverage: 0 })).toBe(100);
  });

  it("覆盖度未回写(null)按空白满额处理,促日批回写", () => {
    expect(computeOpportunityScore({ mediaCount: 0, heatNew: 0, coverage: null })).toBe(30);
  });

  it("全被覆盖且无介质无热度 → 0", () => {
    expect(computeOpportunityScore({ mediaCount: 0, heatNew: 0, coverage: 1 })).toBe(0);
  });
});

describe("computeCoverageScore / coverageStateOf", () => {
  it("覆盖度分 = 最佳相似度 × 命中饱和因子", () => {
    // 相似 0.8 × min(2,3)/3 = 0.53
    expect(computeCoverageScore(0.2, 2)).toBe(0.53);
    // 命中 3+ 饱和
    expect(computeCoverageScore(0.1, 5)).toBe(0.9);
  });

  it("档位:≥0.5 covered / ≥0.15 partial / 其余 blank", () => {
    expect(coverageStateOf(0.5)).toBe("covered");
    expect(coverageStateOf(0.15)).toBe("partial");
    expect(coverageStateOf(0.14)).toBe("blank");
    expect(coverageStateOf(0)).toBe("blank");
  });
});

describe("isAnomaly", () => {
  it("最新分 ≥ 前 3 日均值 3 倍且绝对增量 ≥ 10 → 告警", () => {
    // 前 3 日均值 10,最新 40(4 倍,+30)
    expect(isAnomaly([8, 10, 12, 40])).toBe(true);
  });

  it("倍数够但绝对增量不足 → 不告警(双门)", () => {
    // 均值 5,最新 15(3 倍但 +10 恰达下限 → 告警);改 +9 场景:
    expect(isAnomaly([4, 5, 6, 15])).toBe(true);
    expect(isAnomaly([4, 5, 6, 14])).toBe(false); // 14 < 3×5
  });

  it("基线为零/无历史/样本不足 → 不告警(防冷启动假告警)", () => {
    expect(isAnomaly([0, 0, 0, 30])).toBe(false);
    expect(isAnomaly([40])).toBe(false);
    expect(isAnomaly([])).toBe(false);
  });

  it("平稳序列不告警", () => {
    expect(isAnomaly([10, 11, 12, 11])).toBe(false);
  });
});

describe("clusterMomentum", () => {
  it("新晋爆发:24h≥3 且此前≤2", () => {
    expect(clusterMomentum(8, 0)).toBe("burst");
    expect(clusterMomentum(3, 2)).toBe("burst");
  });

  it("升温:24h≥3 且占比≥40%", () => {
    expect(clusterMomentum(5, 5)).toBe("rising"); // 50%
    expect(clusterMomentum(4, 5)).toBe("rising"); // 44%
    expect(clusterMomentum(3, 5)).toBe("steady"); // 37.5%,差临门
  });

  it("退潮:24h 零新增且有历史;全无信号按平稳(无可言方向)", () => {
    expect(clusterMomentum(0, 8)).toBe("cooling");
    expect(clusterMomentum(0, 0)).toBe("steady");
  });

  it("其余(零星新增/低占比)按平稳", () => {
    expect(clusterMomentum(1, 41)).toBe("steady");
    expect(clusterMomentum(2, 3)).toBe("steady");
  });
});
