/**
 * 火山引擎方舟牌价解析单测(M74 批B3):golden 样本为渲染后页面裁剪(2026-11-15)。
 * 锚点:场景(在线推理常规/低延迟/低优)与输入长度阶梯都落档位;行价取
 * 「在线推理（常规）」场景 + 最小输入长度档(常态价);零宽字符不进模型键。
 * 批G:表级单位闸——按张表收单价格(生成价→outputPrice)、单位不明整表跳过。
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { parseVolcengineArk } from "./volcengine";

const NOW = new Date("2026-11-15T00:00:00Z");
const URL = "https://www.volcengine.com/docs/ark/model-pricing";

function readFixture(): string {
  return readFileSync(join(__dirname, "..", "__fixtures__", "volcengine-ark-pricing.html"), "utf8");
}

describe("parseVolcengineArk", () => {
  it("推理场景与输入长度阶梯都落档位", () => {
    const rows = parseVolcengineArk(readFixture(), URL, NOW);
    const lite = rows.find((r) => r.modelKey === "doubao-seed-2.1-lite");
    expect(lite).toBeDefined();
    const labels = lite!.tiers!.map((t) => t.tierLabel);
    expect(labels).toContain("在线推理（常规）·[0, 1024]K");
    expect(labels).toContain("在线推理（低延迟）·[0, 1024]K");
    expect(labels).toContain("在线推理（低优）·[0, 1024]K");
    expect(lite!.providerKey).toBe("volcengine-ark");
    expect(lite!.currency).toBe("CNY");
  });

  it("行价取「在线推理（常规）」场景(最主流口径)", () => {
    const rows = parseVolcengineArk(readFixture(), URL, NOW);
    const lite = rows.find((r) => r.modelKey === "doubao-seed-2.1-lite")!;
    // 常规 0.8/2.7;低延迟 1.6/5.4;低优 0.4/1.35 —— 行价取常规,不是最便宜的低优
    expect(lite.inputPrice).toBe(0.8);
    expect(lite.outputPrice).toBe(2.7);
  });

  it("阶梯边界落 min/max tokens(K token → token 数)", () => {
    const rows = parseVolcengineArk(readFixture(), URL, NOW);
    const turbo = rows.find((r) => r.modelKey === "doubao-seed-2.1-turbo")!;
    const tier = turbo.tiers!.find((t) => t.tierLabel.includes("[0, 256]K"))!;
    expect(tier.minTokens).toBe(0);
    expect(tier.maxTokens).toBe(262144);
    expect(tier.unit).toBe("per_1m_tokens");
  });

  it("缓存命中价落档位 cachePrice", () => {
    const rows = parseVolcengineArk(readFixture(), URL, NOW);
    const lite = rows.find((r) => r.modelKey === "doubao-seed-2.1-lite")!;
    const tier = lite.tiers!.find((t) => t.tierLabel.startsWith("在线推理（常规）"))!;
    expect(tier.cachePrice).toBe(0.16);
  });

  it("模型键不含零宽字符", () => {
    const rows = parseVolcengineArk(readFixture(), URL, NOW);
    for (const r of rows) expect(r.modelKey).not.toContain("​");
  });

  it("页面改版(无价格表)时抛错,不静默返回空", () => {
    expect(() => parseVolcengineArk("<div></div>", URL, NOW)).toThrow(/页面可能改版/);
  });

  it("批G:token 表行级 priceUnit 为 per_1m_tokens", () => {
    const rows = parseVolcengineArk(readFixture(), URL, NOW);
    const lite = rows.find((r) => r.modelKey === "doubao-seed-2.1-lite")!;
    expect(lite.priceUnit).toBe("per_1m_tokens");
  });
});

describe("parseVolcengineArk · 批G 单位闸", () => {
  /** 构造最小表格页:表头单位在格内,与真实渲染 DOM 同形 */
  function page(...tables: string[]): string {
    return `<html><body>${tables.join("")}</body></html>`;
  }
  function table(headers: string[], dataRows: string[][]): string {
    const head = `<tr>${headers.map((h) => `<td>${h}</td>`).join("")}</tr>`;
    const body = dataRows.map((r) => `<tr>${r.map((c) => `<td>${c}</td>`).join("")}</tr>`).join("");
    return `<table>${head}${body}</table>`;
  }

  it("按张表:单价格落 outputPrice,inputPrice=null,行级与档位单位 per_image,行价取最低档", () => {
    const html = page(
      table(
        ["模型名称", "条件", "输出图片单价 元/张"],
        [
          ["doubao-seedream-4-0", "1K×1K", "0.06"],
          ["doubao-seedream-4-0", "4K×4K", "0.24"],
        ],
      ),
    );
    const rows = parseVolcengineArk(html, URL, NOW);
    expect(rows).toHaveLength(1);
    const r = rows[0]!;
    expect(r.priceUnit).toBe("per_image");
    expect(r.inputPrice).toBeNull();
    expect(r.outputPrice).toBe(0.06); // 最低档
    expect(r.tiers).toHaveLength(2);
    expect(r.tiers![0]).toMatchObject({ tierLabel: "1K×1K", outputPrice: 0.06, unit: "per_image" });
  });

  it("按秒表(视频)收 per_second", () => {
    const html = page(
      table(["模型名称", "输出视频单价 元/秒"], [["doubao-seedance-1-0-pro", "3.67"]]),
    );
    const rows = parseVolcengineArk(html, URL, NOW);
    expect(rows[0]!.priceUnit).toBe("per_second");
    expect(rows[0]!.outputPrice).toBe(3.67);
  });

  it("单位不明的表整表跳过(宁可少收不可错收);全部不明才抛错", () => {
    const unknown = table(["模型名称", "输出"], [["mystery-model", "1.00"]]);
    // 只有不明表 → 等同页面改版
    expect(() => parseVolcengineArk(page(unknown), URL, NOW)).toThrow(/页面可能改版/);
    // 明表 + 不明表混排 → 只收明表
    const mixed = page(
      table(["模型名称", "输入(非音频) 元/M token", "输出 元/M token"], [["ok-model", "1", "2"]]),
      unknown,
    );
    const rows = parseVolcengineArk(mixed, URL, NOW);
    expect(rows.map((r) => r.modelKey)).toEqual(["ok-model"]);
  });

  it("同模型跨单位表出现:保 token 系记录", () => {
    const html = page(
      table(["模型名称", "输入(非音频) 元/M token", "输出 元/M token"], [["m-1", "1", "2"]]),
      table(["模型名称", "输出 元/张"], [["m-1", "0.1"]]),
    );
    const rows = parseVolcengineArk(html, URL, NOW);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.priceUnit).toBe("per_1m_tokens");
    expect(rows[0]!.tiers!.every((t) => t.unit === "per_1m_tokens")).toBe(true);
  });
});

/** M80:视频表(按片价 + 官方折合价)——2026-11-27 实探裁剪 */
describe("parseVolcengineArk 视频表(折合价 · 分辨率档)", () => {
  const rows = parseVolcengineArk(
    readFileSync(join(__dirname, "..", "__fixtures__", "volcengine-ark-video.html"), "utf8"),
    URL,
    NOW,
  );

  it("行价取最低分辨率的折合价(元/秒),与百炼/百度按秒价同口径", () => {
    const r = rows.find((x) => x.modelKey === "seedance-2-5")!;
    expect(r.priceUnit).toBe("per_second");
    expect(r.outputPrice).toBe(0.67);
    expect(r.inputPrice).toBeNull();
    expect(r.modality).toBe("video");
    expect(r.providerKey).toBe("volcengine-ark");
  });

  it("各分辨率折合价落档位(档名=分辨率)", () => {
    const r = rows.find((x) => x.modelKey === "seedance-2-5")!;
    expect(r.tiers!.map((t) => [t.tierLabel, t.outputPrice, t.unit])).toEqual([
      ["480p", 0.67, "per_second"],
      ["720p", 1.51, "per_second"],
      ["1080p", 3.74, "per_second"],
      ["4K", 6.03, "per_second"],
    ]);
  });

  it("「不支持」的分辨率不落档(不臆测)", () => {
    const r = rows.find((x) => x.modelKey === "seedance-2-0-mini")!;
    expect(r.outputPrice).toBe(0.23);
    expect(r.tiers!.map((t) => t.tierLabel)).toEqual(["480p", "720p"]);
  });

  it("按片价(元/个)只进 note,不进行价", () => {
    const r = rows.find((x) => x.modelKey === "seedance-2-5")!;
    expect(r.note).toContain("0.67 元/秒");
    expect(r.note).toContain("按片 3.36 元/个");
  });

  it("模型名归一(product 名 → 字典键);同型号变体不合并", () => {
    expect(rows.map((r) => r.modelKey).sort()).toEqual([
      "seedance-2-0",
      "seedance-2-0-fast",
      "seedance-2-0-mini",
      "seedance-2-5",
      "seedance-2-5-flash",
    ]);
  });

  it("视频表不混入 token 行(单位闸:视频表只有价格口径列)", () => {
    expect(rows.every((r) => r.priceUnit === "per_second")).toBe(true);
  });
});

/** M77:图片表按像素/场景分档(实探 2026-11-20 的方舟图片表裁剪) */
describe("parseVolcengineArk 图片表(按张 · 像素分档)", () => {
  const rows = parseVolcengineArk(
    readFileSync(join(__dirname, "..", "__fixtures__", "volcengine-ark-image.html"), "utf8"),
    URL,
    NOW,
  );

  it("像素档各落一档;行价取最低像素档(入口价)", () => {
    const r = rows.find((x) => x.modelKey === "doubao-seedream-5-5")!;
    expect(r.priceUnit).toBe("per_image");
    expect(r.outputPrice).toBe(0.13);
    expect(r.inputPrice).toBe(0.05);
    expect(r.tiers!.map((t) => t.tierLabel)).toEqual(["P ≤ 2.61M", "2.61M < P ≤ 4.63M"]);
    expect(r.tiers!.map((t) => t.outputPrice)).toEqual([0.13, 0.23]);
    // 像素口径落 note:价必须带着「对应哪个分辨率」出来
    expect(r.note).toContain("P ≤ 2.61M");
  });

  it("场景分组 × 像素档:行价取首个分组的低像素档;输入取「第 2 张起」常态价", () => {
    const r = rows.find((x) => x.modelKey.includes("seedream-5-0-pro"))!;
    expect(r.outputPrice).toBe(0.3);
    expect(r.inputPrice).toBe(0.02);
    expect(r.tiers!.map((t) => t.tierLabel)).toEqual([
      "单图生成场景·P ≤ 2.61M",
      "单图生成场景·P > 2.61M",
      "图层拆分场景·P ≤ 2.61M",
      "图层拆分场景·P > 2.61M",
    ]);
  });

  it("整格一个价:行价与档位同价;免费输入价落 0", () => {
    const r = rows.find((x) => x.modelKey === "doubao-seedream-5-0-flash")!;
    expect(r.outputPrice).toBe(0.12);
    expect(r.inputPrice).toBe(0);
    expect(r.tiers!.map((t) => t.tierLabel)).toEqual(["默认"]);
  });

  it("档位名不带推理场景前缀(图片表不该标「批量推理」)", () => {
    for (const r of rows) {
      for (const t of r.tiers ?? []) {
        expect(t.tierLabel).not.toContain("批量推理");
        expect(t.tierLabel).not.toContain("在线推理");
      }
    }
  });
});
