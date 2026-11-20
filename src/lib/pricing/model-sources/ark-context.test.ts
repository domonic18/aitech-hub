/**
 * 方舟「模型列表」页 → 上下文窗口单测(伴生页;2026-11-20 反馈「上下文全是 -」补齐)。
 * 锚点:文档模型 id 归一后与牌价行名匹配;同名多版本取最新;命不中 → null。
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { applyArkContexts, matchArkContext, parseArkModelContexts } from "./ark-context";
import { parseVolcengineArk } from "./volcengine";

const NOW = new Date("2026-11-20T00:00:00Z");
const URL = "https://www.volcengine.com/docs/ark/model-pricing";

function readModelsFixture(): string {
  return readFileSync(join(__dirname, "..", "__fixtures__", "volcengine-ark-models.html"), "utf8");
}

function readPricingFixture(): string {
  return readFileSync(join(__dirname, "..", "__fixtures__", "volcengine-ark-pricing.html"), "utf8");
}

describe("方舟模型列表页 → 上下文窗口(伴生页)", () => {
  it("文档模型 id → 上下文窗口(归一后精确命中)", () => {
    const map = parseArkModelContexts(readModelsFixture());
    expect(matchArkContext("doubao-seed-evolving", map)).toBe("1024K");
    // 文档 id 带日期后缀,牌价行名不带 → 归一 + 前缀兜底命中最新版本
    expect(matchArkContext("doubao-seed-2.1-pro", map)).toBe("1024K");
  });

  it("同名多版本取最新(260915 的 1024K 覆盖 260628 的 256K)", () => {
    const map = parseArkModelContexts(readModelsFixture());
    expect(map.get("doubao-seed-2-1-pro")?.version).toBe(260915);
    expect(map.get("doubao-seed-2-1-pro")?.context).toBe("1024K");
  });

  it("命不中的模型 → null(不臆测)", () => {
    const map = parseArkModelContexts(readModelsFixture());
    expect(matchArkContext("not-a-real-model", map)).toBeNull();
  });

  it("给牌价行补上下文:只补 token 计价行", () => {
    const rows = parseVolcengineArk(readPricingFixture(), URL, NOW);
    const patched = applyArkContexts(rows, parseArkModelContexts(readModelsFixture()));
    const evolving = patched.find((r) => r.modelKey === "doubao-seed-evolving");
    expect(evolving?.contextWindow).toBe("1M");
  });
});
