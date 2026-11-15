/**
 * 硅基流动价格页解析单测(M74 批B):golden 样本为真实页面裁剪(2026-11-15)。
 * 锚点:模型 id 取 `a[title]`(不是显示名)、时段价分组、行价取最高(保守基准)、
 * 缓存价进档位(行上无处安放)、分类行不入库。
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { parseSiliconflow } from "./siliconflow";

const NOW = new Date("2026-11-15T00:00:00Z");
const URL = "https://siliconflow.cn/pricing";

function readFixture(): string {
  return readFileSync(join(__dirname, "..", "__fixtures__", "siliconflow-pricing.html"), "utf8");
}

describe("parseSiliconflow", () => {
  it("模型 id 取 a[title] 的 org/model,不是显示名", () => {
    const rows = parseSiliconflow(readFixture(), URL, NOW);
    expect(rows.length).toBeGreaterThan(0);
    expect(rows[0]!.modelKey).toBe("deepseek-ai/DeepSeek-V4.1-Flash");
    expect(rows[0]!.vendor).toBe("硅基流动 SiliconFlow");
    expect(rows[0]!.providerKey).toBe("siliconflow");
    expect(rows[0]!.currency).toBe("CNY");
  });

  it("时段价分组落档位:同模型两个时段各一档", () => {
    const rows = parseSiliconflow(readFixture(), URL, NOW);
    const flash = rows.find((r) => r.modelKey === "deepseek-ai/DeepSeek-V4.1-Flash");
    expect(flash).toBeDefined();
    expect(flash!.tiers).toHaveLength(2);
    expect(flash!.tiers!.map((t) => t.tierLabel)).toEqual(["0点～2点/8点～24点", "2点～8点"]);
  });

  it("行价取各时段最高价(保守基准,不把优惠窗当常态价)", () => {
    const rows = parseSiliconflow(readFixture(), URL, NOW);
    const flash = rows.find((r) => r.modelKey === "deepseek-ai/DeepSeek-V4.1-Flash")!;
    // 时段价 输入 2.00 / 1.00 → 行价取 2.00;输出 8.00 / 4.00 → 8.00
    expect(flash.inputPrice).toBe(2);
    expect(flash.outputPrice).toBe(8);
  });

  it("缓存价进档位(cachePrice 列位第三)", () => {
    const rows = parseSiliconflow(readFixture(), URL, NOW);
    const pro = rows.find((r) => r.modelKey === "deepseek-ai/DeepSeek-V4-Pro")!;
    expect(pro.tiers).toHaveLength(1);
    expect(pro.tiers![0]!.tierLabel).toBe("默认");
    expect(pro.tiers![0]!.inputPrice).toBe(12);
    expect(pro.tiers![0]!.outputPrice).toBe(24);
    expect(pro.tiers![0]!.cachePrice).toBe(1);
    expect(pro.tiers![0]!.unit).toBe("per_1m_tokens");
  });

  it("页面改版(无价格行)时抛错,不静默返回空", () => {
    expect(() => parseSiliconflow("<div></div>", URL, NOW)).toThrow(/页面可能改版/);
  });
});
