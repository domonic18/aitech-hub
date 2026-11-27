/**
 * 快手可灵(Kling)图片牌价解析单测(M81,2026-11-27 实探):golden 样本为渲染后页面裁剪。
 * 锚点:积分按官方单价折算(图片 0.025 元/积分);行价取基准能力(文生图)
 * × 最低分辨率档;参考图价落 inputPrice;「通用」功能行不落行。
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { parseKlingImagePricing } from "./kling-image";

const NOW = new Date("2026-11-27T00:00:00Z");
const URL = "https://klingai.com/document-api/pricing/base/image";

function fixture(name: string): string {
  return readFileSync(join(__dirname, "..", "__fixtures__", name), "utf8");
}

describe("parseKlingImagePricing", () => {
  const rows = parseKlingImagePricing(fixture("kling-image-pricing.html"), URL, NOW, 0.025);

  it("行价取单图 × 最低分辨率档;积分按 0.025 元/积分折算", () => {
    const img = rows.find((r) => r.modelKey === "kling-image-4-0")!;
    expect(img.priceUnit).toBe("per_image");
    expect(img.modality).toBe("image");
    expect(img.outputPrice).toBe(0.4); // 2K 16 积分/张 × 0.025
    expect(img.tiers!.map((t) => [t.tierLabel, t.outputPrice])).toEqual([
      ["单图·2K", 0.4],
      ["单图·4K", 0.6],
      ["单图·8K", 1],
      ["组图·2K", 0.4],
      ["组图·4K", 0.6],
      ["组图·8K", 1],
      ["长图·网页设计·1K", 3.5],
      ["长图·网页设计·2K", 3.8],
      ["长图·电商详情页·短·1K", 1.5],
      ["长图·电商详情页·短·2K", 1.8],
      ["长图·电商详情页·中·1K", 3],
      ["长图·电商详情页·中·2K", 3.5],
      ["长图·电商详情页·长·1K", 5],
      ["长图·电商详情页·长·2K", 5.5],
    ]);
  });

  it("参考图/参考主体价落 inputPrice(按张输入价形态)", () => {
    const img = rows.find((r) => r.modelKey === "kling-image-4-0")!;
    expect(img.inputPrice).toBe(0.02); // 0.8 积分/张 × 0.025
    const legacy = rows.find((r) => r.modelKey === "kling-image-3-0")!;
    expect(legacy.inputPrice).toBeNull(); // 老模型参考图免费
  });

  it("扩图/补全主体图等「通用」功能行不是模型价,不落行", () => {
    expect(rows.map((r) => r.modelKey).sort()).toEqual([
      "kling-image-2-1",
      "kling-image-3-0",
      "kling-image-3-0-omni",
      "kling-image-4-0",
      "kling-image-o1",
    ]);
  });

  it("同型号不同能力不合并:Kling Image 2.1 的文生/图生/多图参考三档都在", () => {
    const v21 = rows.find((r) => r.modelKey === "kling-image-2-1")!;
    expect(v21.outputPrice).toBe(0.1); // 文生图 4 积分/张
    expect(v21.tiers!.map((t) => t.tierLabel)).toEqual([
      "文生图·1K、2K",
      "图生图·1K、2K",
      "多图参考生图·1K、2K",
    ]);
  });
});
