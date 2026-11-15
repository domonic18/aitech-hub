/**
 * 火山引擎方舟牌价解析单测(M74 批B3):golden 样本为渲染后页面裁剪(2026-11-15)。
 * 锚点:场景(在线推理常规/低延迟/低优)与输入长度阶梯都落档位;行价取
 * 「在线推理（常规）」场景 + 最小输入长度档(常态价);零宽字符不进模型键。
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
});
