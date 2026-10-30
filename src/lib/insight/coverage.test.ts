/** 覆盖矩阵族级判定单测(M60):族汇总(停滞折叠)、空白/特色/覆盖/部分四态、
 * 分段占比。纯函数,无 DB。 */
import { describe, expect, it } from "vitest";

import {
  SIGNATURE_MIN_INTERNAL,
  buildCoverageFamilies,
  coverageVerdict,
  familyShares,
  type CoverageFamily,
} from "./coverage";
import {
  INSIGHT_SOURCE_FAMILY,
  SOURCE_FAMILIES,
  sourcesInFamily,
  type InsightSource,
  type InsightSourceFamily,
} from "./source-registry";

/** 测试用源列表:全部在役源(默认不停滞),可指定停滞集 */
function allSources(staleSources: string[] = []): { source: InsightSource; stale: boolean }[] {
  return SOURCE_FAMILIES.flatMap((f) => sourcesInFamily(f)).map((s) => ({
    source: s,
    stale: staleSources.includes(s),
  }));
}

/** 按族给计数:注入到该族首个成员上(族合计=成员和,单点注入即可) */
function familiesWith(
  counts: Partial<Record<InsightSourceFamily, number>>,
  staleSources: string[] = [],
): CoverageFamily[] {
  const map = new Map<InsightSource, number>();
  for (const [family, n] of Object.entries(counts)) {
    const members = sourcesInFamily(family as InsightSourceFamily);
    if (members.length > 0) map.set(members[0], n as number);
  }
  return buildCoverageFamilies(allSources(staleSources), (s) => map.get(s) ?? 0);
}

describe("buildCoverageFamilies", () => {
  it("按注册表族序输出,成员含 0 值源,族合计为成员和", () => {
    const fams = buildCoverageFamilies(allSources(), (s) => (s === "internal-comment" ? 2 : 0));
    expect(fams.map((f) => f.family)).toEqual([...SOURCE_FAMILIES]);
    const internal = fams.find((f) => f.family === "internal");
    expect(internal?.total).toBe(2);
    expect(internal?.members.find((m) => m.source === "internal-comment")?.count).toBe(2);
    // 族内 0 值成员也保留(行内展开要看空缺),停接入源不进成员
    expect(internal?.members.some((m) => m.source === "internal-agent" && m.count === 0)).toBe(
      true,
    );
    expect(internal?.members.some((m) => m.source === "internal-search")).toBe(false);
  });

  it("族内成员全部停滞才判族停滞", () => {
    const hotMembers = sourcesInFamily("hotlist");
    const allStale = buildCoverageFamilies(allSources(hotMembers), () => 0);
    expect(allStale.find((f) => f.family === "hotlist")?.stale).toBe(true);
    expect(allStale.find((f) => f.family === "internal")?.stale).toBe(false);

    const partialStale = buildCoverageFamilies(allSources([hotMembers[0]]), () => 0);
    expect(partialStale.find((f) => f.family === "hotlist")?.stale).toBe(false);
  });
});

describe("coverageVerdict", () => {
  it("热簇:站内族 0 + 外部族有信号 = 内容空白", () => {
    expect(coverageVerdict("hot", familiesWith({ hotlist: 4, vendor: 2 }))).toBe("blank");
    expect(coverageVerdict("hot", familiesWith({ hotlist: 4, internal: 1 }))).toBe("partial");
  });

  it("痛簇:站内族 ≥3 + 外部族 0 = 自有特色", () => {
    expect(coverageVerdict("pain", familiesWith({ internal: SIGNATURE_MIN_INTERNAL }))).toBe(
      "signature",
    );
    expect(coverageVerdict("pain", familiesWith({ internal: 2 }))).toBe("partial");
  });

  it("所有非停滞族都有信号 = 覆盖良好", () => {
    expect(
      coverageVerdict("hot", familiesWith({ internal: 1, hotlist: 1, vendor: 1, community: 1 })),
    ).toBe("covered");
  });

  it("站内族停滞时不判空白/特色(停滞源不参与判定)", () => {
    const internalMembers = sourcesInFamily("internal");
    expect(coverageVerdict("hot", familiesWith({ hotlist: 4 }, internalMembers))).not.toBe("blank");
  });
});

describe("familyShares", () => {
  it("按族合计折算百分比;全零回空", () => {
    const shares = familyShares(familiesWith({ internal: 1, hotlist: 3 }));
    expect(shares).toEqual([
      { family: "internal", pct: 25 },
      { family: "hotlist", pct: 75 },
    ]);
    expect(familyShares(familiesWith({}))).toEqual([]);
  });
});

describe("注册表族口径", () => {
  it("站内四源归 internal、六厂商归 vendor、四社区归 community", () => {
    expect(sourcesInFamily("internal")).toEqual(
      expect.arrayContaining(["internal-comment", "internal-agent"]),
    );
    expect(sourcesInFamily("internal")).not.toContain("internal-search"); // 停接入不在役
    expect(sourcesInFamily("vendor")).toHaveLength(6);
    expect(sourcesInFamily("community")).toHaveLength(4);
    expect(INSIGHT_SOURCE_FAMILY["internal-agent"]).toBe("internal");
  });
});
