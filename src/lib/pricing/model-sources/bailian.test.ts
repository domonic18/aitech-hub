/**
 * 阿里云百炼计费页解析单测(M74 批B2):golden 样本为真实页面裁剪(2026-11-15)。
 * 锚点:ICE 载荷取 content;**整表行列对齐闸**(多模态多级表头整表排除,不错位取价);
 * 部署范围/模式/Token 区间三维度落档位;行价取「全球」档基准价。
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { parseBailianModels } from "./bailian";

const NOW = new Date("2026-11-15T00:00:00Z");
const URL = "https://help.aliyun.com/zh/model-studio/billing";

function readFixture(): string {
  return readFileSync(join(__dirname, "..", "__fixtures__", "bailian-billing.html"), "utf8");
}

describe("parseBailianModels", () => {
  it("ICE 载荷 → content;一行一模型,部署范围/模式/区间落档位", () => {
    const rows = parseBailianModels(readFixture(), URL, NOW);
    const max = rows.find((r) => r.modelKey === "qwen3.8-max");
    expect(max).toBeDefined();
    expect(max!.providerKey).toBe("aliyun-bailian");
    expect(max!.vendor).toBe("阿里云百炼");
    // 部署范围各成一档(golden 样本含 全球 / 美国 两组)
    const scopes = new Set(
      max!.tiers!.map((t) => t.tierLabel.split("·")[0]).filter((s) => s !== "默认"),
    );
    expect(scopes.has("全球")).toBe(true);
    expect(scopes.has("美国")).toBe(true);
  });

  it("行价取「全球」档(基准价,不取最便宜那档)", () => {
    const rows = parseBailianModels(readFixture(), URL, NOW);
    const max = rows.find((r) => r.modelKey === "qwen3.8-max")!;
    expect(max.inputPrice).toBe(12);
    expect(max.outputPrice).toBe(36);
    const us = max.tiers!.find((t) => t.tierLabel.startsWith("美国·"))!;
    expect(us.inputPrice).toBe(14.988); // 美国档更贵,不进行价
  });

  it("Token 阶梯区间落 min/max", () => {
    const rows = parseBailianModels(readFixture(), URL, NOW);
    const max = rows.find((r) => r.modelKey === "qwen3.8-max")!;
    const tier = max.tiers!.find((t) => t.tierLabel.includes("0<Token≤1M"))!;
    expect(tier.minTokens).toBe(0);
    expect(tier.maxTokens).toBe(1048576);
    expect(tier.unit).toBe("per_1m_tokens");
  });

  it("多模态多级表头整表排除(不错位取价)", () => {
    const rows = parseBailianModels(readFixture(), URL, NOW);
    // 多模态表是 4 列表头 + 6 格数据行,按列序映射会把「音频输入价」当输出价
    expect(rows.find((r) => r.modelKey === "qwen3.5-omni-plus")).toBeUndefined();
  });

  it("免费额度原文入 free_tier(不是「完全免费」)", () => {
    const rows = parseBailianModels(readFixture(), URL, NOW);
    const max = rows.find((r) => r.modelKey === "qwen3.8-max")!;
    expect(max.freeTier).toContain("100万");
  });

  it("页面改版(ICE 载荷缺失)时抛错,不静默返回空", () => {
    expect(() => parseBailianModels("<div></div>", URL, NOW)).toThrow(/页面可能改版/);
  });
});
