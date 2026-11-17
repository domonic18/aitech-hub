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

describe("parseBailianModels · 批G 按张/按秒表(2026-11-17 增补样本)", () => {
  it("按张双价表(qwen-image):两价均按张落行,分辨率落档位,显式模态 image", () => {
    const rows = parseBailianModels(readFixture(), URL, NOW);
    const pro = rows.find((r) => r.modelKey === "qwen-image-3.0-pro")!;
    expect(pro.priceUnit).toBe("per_image");
    expect(pro.modality).toBe("image");
    expect(pro.inputPrice).toBe(0.02); // 图生图参考图按张输入价
    expect(pro.outputPrice).toBe(0.25);
    const t1k = pro.tiers!.find((t) => t.tierLabel.includes("1k"))!;
    expect(t1k.outputPrice).toBe(0.25);
    expect(t1k.unit).toBe("per_image");
    expect(pro.freeTier).toContain("10张");
  });

  it("rowspan 续行(分辨率阶梯)继承模型与免费额度;kling 斜杠 id 完整", () => {
    const rows = parseBailianModels(readFixture(), URL, NOW);
    const kling = rows.find((r) => r.modelKey === "kling/kling-v3-image-generation")!;
    expect(kling.priceUnit).toBe("per_image");
    expect(kling.outputPrice).toBe(0.2);
    expect(kling.tiers!.length).toBeGreaterThanOrEqual(2); // 1K + 2K 分辨率各一档
  });

  it("按秒视频表:输入和输出同价落生成价,表头带「视频」→显式模态 video", () => {
    const rows = parseBailianModels(readFixture(), URL, NOW);
    const edit = rows.find((r) => r.modelKey === "happyhorse-1.0-video-edit")!;
    expect(edit.priceUnit).toBe("per_second");
    expect(edit.modality).toBe("video");
    expect(edit.inputPrice).toBeNull();
    expect(edit.outputPrice).toBe(0.9);
    const t2v = rows.find((r) => r.modelKey === "happyhorse-1.1-t2v")!;
    expect(t2v.outputPrice).toBe(0.45); // 行价=全球 480P 档
  });

  it("音乐按秒表(表头无「视频」)不标显式模态——留给关键词推断成 audio", () => {
    const rows = parseBailianModels(readFixture(), URL, NOW);
    const music = rows.find((r) => r.modelKey === "fun-music-preview")!;
    expect(music.priceUnit).toBe("per_second");
    expect(music.modality).toBeUndefined();
  });

  it("token 表照旧 per_1m_tokens(单位闸不放跑老口径)", () => {
    const rows = parseBailianModels(readFixture(), URL, NOW);
    const max = rows.find((r) => r.modelKey === "qwen3.8-max")!;
    expect(max.priceUnit).toBe("per_1m_tokens");
  });
});
