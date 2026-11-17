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

describe("parseSiliconflow · 批G 单价格行与阶梯行(2026-11-17 复勘形态)", () => {
  it("文生图行:单价落 outputPrice、行级 per_image、显式模态 image、免费=0", () => {
    const rows = parseSiliconflow(readFixture(), URL, NOW);
    const moss = rows.find((r) => r.modelKey === "OpenMOSS-Team/MOSS-Image")!;
    expect(moss.priceUnit).toBe("per_image");
    expect(moss.inputPrice).toBeNull();
    expect(moss.outputPrice).toBe(0.15);
    expect(moss.modality).toBe("image");
    expect(moss.tiers![0]).toMatchObject({ outputPrice: 0.15, unit: "per_image" });

    const kolors = rows.find((r) => r.modelKey === "Kwai-Kolors/Kolors")!;
    expect(kolors.priceUnit).toBe("per_image");
    expect(kolors.outputPrice).toBe(0); // 「免费」=完全免费,价 0 落库
  });

  it("视频行:按秒计价 per_second + 显式模态 video(ASR 按音频秒计价同单位但模态 audio)", () => {
    const rows = parseSiliconflow(readFixture(), URL, NOW);
    const h3 = rows.find((r) => r.modelKey === "MiniMaxAI/MiniMax-H3")!;
    expect(h3.priceUnit).toBe("per_second");
    expect(h3.modality).toBe("video");
    expect(h3.outputPrice).toBe(0.5);
    const asr = rows.find((r) => r.modelKey === "Qwen/Qwen3-ASR-1.7B")!;
    expect(asr.priceUnit).toBe("per_second");
    expect(asr.modality).toBe("audio");
  });

  it("单位认不出的单价格行不收(每千字符 UTF-8 不臆测成 token 价)", () => {
    const rows = parseSiliconflow(readFixture(), URL, NOW);
    expect(rows.some((r) => r.modelKey.includes("SenseVoice"))).toBe(false);
  });

  it("输入长度阶梯行:两档落 tier 且带 token 边界,行价取最小阶梯档", () => {
    const rows = parseSiliconflow(readFixture(), URL, NOW);
    const qwen = rows.find((r) => r.modelKey === "Qwen/Qwen3.5-35B-A3B")!;
    const labels = qwen.tiers!.map((t) => t.tierLabel);
    expect(labels).toContain("[0, 128k)");
    expect(labels).toContain("[128k, +∞)");
    const first = qwen.tiers!.find((t) => t.tierLabel === "[0, 128k)")!;
    expect(first.minTokens).toBe(0);
    expect(first.maxTokens).toBe(131072);
    expect(first.inputPrice).toBe(0.4);
    expect(first.outputPrice).toBe(3.2);
    expect(qwen.inputPrice).toBe(0.4); // 行价 = 最小阶梯档,不是 [128k,+∞) 的 1.6
  });

  it("时段行照旧:缓存价进档位、行价取各时段最高(页面 11-17 起缓存列常驻)", () => {
    const rows = parseSiliconflow(readFixture(), URL, NOW);
    const flash = rows.find((r) => r.modelKey === "deepseek-ai/DeepSeek-V4.1-Flash")!;
    expect(flash.inputPrice).toBe(2);
    expect(flash.outputPrice).toBe(8);
    const peak = flash.tiers!.find((t) => t.tierLabel === "0点～2点/8点～24点")!;
    expect(peak.cachePrice).toBe(0.04);
    const off = flash.tiers!.find((t) => t.tierLabel === "2点～8点")!;
    expect(off.cachePrice).toBe(0.02);
  });
});
