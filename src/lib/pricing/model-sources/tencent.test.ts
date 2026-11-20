/**
 * 腾讯云混元定价文档解析单测(M74 批B):golden 样本为真实页面裁剪(2026-11-15)。
 * 锚点:按表头识别两类表(不靠表序号)、刊例价「输入:x元输出:y元」、
 * 免费额度原文入 free_tier(不是「完全免费」,两种语义分开)。
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  applyTencentContexts,
  matchTencentContext,
  parseTencentHunyuan,
  parseTencentModelContexts,
} from "./tencent";

const NOW = new Date("2026-11-15T00:00:00Z");
const URL = "https://cloud.tencent.com/document/product/1729/97731";

function readFixture(): string {
  return readFileSync(
    join(__dirname, "..", "__fixtures__", "tencent-hunyuan-pricing.html"),
    "utf8",
  );
}

describe("parseTencentHunyuan", () => {
  it("刊例价表出模型 + 输入/输出价(每百万 tokens)", () => {
    const rows = parseTencentHunyuan(readFixture(), URL, NOW);
    const a13b = rows.find((r) => r.modelKey === "Hunyuan-a13b");
    expect(a13b).toBeDefined();
    expect(a13b!.inputPrice).toBe(0.5);
    expect(a13b!.outputPrice).toBe(2);
    expect(a13b!.providerKey).toBe("tencent-cloud");
    expect(a13b!.tiers?.[0]?.unit).toBe("per_1m_tokens");
  });

  it("免费额度原文入 free_tier(不是「完全免费」)", () => {
    const rows = parseTencentHunyuan(readFixture(), URL, NOW);
    const a13b = rows.find((r) => r.modelKey === "Hunyuan-a13b")!;
    expect(a13b.freeTier).toContain("100万");
    const role = rows.find((r) => r.modelKey === "Hunyuan-role-latest")!;
    expect(role.freeTier).toBeNull();
  });

  it("两表合流:价格表里的模型都出行", () => {
    const rows = parseTencentHunyuan(readFixture(), URL, NOW);
    expect(rows.length).toBeGreaterThanOrEqual(9);
    expect(rows.map((r) => r.modelKey)).toContain("Hunyuan-translation-lite");
  });

  it("页面改版(无价格表)时抛错,不静默返回空", () => {
    expect(() => parseTencentHunyuan("<div></div>", URL, NOW)).toThrow(/页面可能改版/);
  });
});

describe("混元产品概述页 → 上下文(伴生页)", () => {
  function readOverviewFixture(): string {
    return readFileSync(
      join(__dirname, "..", "__fixtures__", "tencent-hunyuan-overview.html"),
      "utf8",
    );
  }

  it("模型名 → 最大输入(文档名带日期后缀时前缀兜底)", () => {
    const map = parseTencentModelContexts(readOverviewFixture());
    expect(matchTencentContext("Hunyuan-a13b", map)).toBe("224K");
    expect(matchTencentContext("Hunyuan-t1-vision", map)).toBe("28K");
    expect(matchTencentContext("不存在的模型", map)).toBeNull();
  });

  it("给牌价行补上下文", () => {
    const rows = parseTencentHunyuan(readFixture(), URL, NOW);
    const patched = applyTencentContexts(rows, parseTencentModelContexts(readOverviewFixture()));
    const a13b = patched.find((r) => r.modelKey === "Hunyuan-a13b");
    expect(a13b?.contextWindow).toBe("224K");
  });
});
