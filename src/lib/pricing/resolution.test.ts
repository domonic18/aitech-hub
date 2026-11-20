/**
 * 分辨率口径单测(M77):档位标签取分辨率原文、大小序、行价对应分辨率。
 */
import { describe, expect, it } from "vitest";

import { resolutionOf, resolutionRank, rowResolution } from "./resolution";

describe("resolutionOf", () => {
  it("K 族/P 族/宽×高/方舟像素档都认;token 阶梯标签不认", () => {
    expect(resolutionOf("1k")).toBe("1k");
    expect(resolutionOf("2K")).toBe("2K");
    expect(resolutionOf("480P")).toBe("480P");
    expect(resolutionOf("2048×2048")).toBe("2048×2048");
    expect(resolutionOf("P ≤ 2.61M")).toBe("P ≤ 2.61M");
    expect(resolutionOf("2.61M < P ≤ 4.63M")).toBe("2.61M < P ≤ 4.63M");
    // 标签末段才是分辨率(方舟图片表 = 场景组·分辨率)
    expect(resolutionOf("单图生成场景·P ≤ 2.61M")).toBe("P ≤ 2.61M");
    expect(resolutionOf("全球·480P")).toBe("480P");
    // 非分辨率标签
    expect(resolutionOf("在线推理（常规）·[0, 32]K")).toBeNull();
    expect(resolutionOf("默认")).toBeNull();
    expect(resolutionOf("")).toBeNull();
  });
});

describe("resolutionRank", () => {
  it("K 族按边长、P 族按高度、宽×高按长边;非分辨率 → null", () => {
    expect(resolutionRank("1k")).toBe(1024);
    expect(resolutionRank("2K")).toBe(2048);
    expect(resolutionRank("480P")).toBe(480);
    expect(resolutionRank("1080P")).toBe(1080);
    expect(resolutionRank("2048×2048")).toBe(2048);
    // 方舟像素档:取最大像素数(M)
    expect(resolutionRank("P ≤ 2.61M")).toBe(2.61);
    expect(resolutionRank("2.61M < P ≤ 4.63M")).toBe(4.63);
    expect(resolutionRank("有声视频·720P")).toBe(720);
    expect(resolutionRank("默认")).toBeNull();
    expect(resolutionRank(null)).toBeNull();
  });
});

describe("rowResolution", () => {
  it("取与行价同价的第一档的分辨率", () => {
    const row = {
      outputPrice: 0.25,
      tiers: [
        { tierLabel: "1k", outputPrice: 0.25 },
        { tierLabel: "2k", outputPrice: 0.5 },
      ],
    };
    expect(rowResolution(row)).toBe("1k");
  });

  it("同价多档取**分辨率最低**那档(库内档位按名排序,第一档未必是基准档)", () => {
    // 「2k」在库里排在「全球·1k」前,但行价基准是 1k
    const row = {
      outputPrice: 0.18,
      tiers: [
        { tierLabel: "2k", outputPrice: 0.18 },
        { tierLabel: "全球·1k", outputPrice: 0.18 },
        { tierLabel: "全球·2k", outputPrice: 0.18 },
      ],
    };
    expect(rowResolution(row)).toBe("1k");
  });

  it("同价多档取档序第一档(最低分辨率);无档位/无价 → null", () => {
    const row = {
      outputPrice: 0.2,
      tiers: [
        { tierLabel: "1K", outputPrice: 0.2 },
        { tierLabel: "2K", outputPrice: 0.2 },
      ],
    };
    expect(rowResolution(row)).toBe("1K");
    expect(rowResolution({ outputPrice: 1, tiers: [] })).toBeNull();
    expect(
      rowResolution({ outputPrice: null, tiers: [{ tierLabel: "1k", outputPrice: 1 }] }),
    ).toBeNull();
    // 档位价与行价不等 → 不臆测
    expect(
      rowResolution({ outputPrice: 0.3, tiers: [{ tierLabel: "1k", outputPrice: 0.25 }] }),
    ).toBeNull();
  });
});
