/**
 * 快手可灵(Kling)视频牌价解析单测(M81,2026-11-27 实探):golden 样本为渲染后页面裁剪。
 * 锚点:积分按官方单价折算(视频 1 元/积分);行价取基准能力
 * (无输入视频/无声)× 最低分辨率档;HDR 加价行与功能行(数字人/对口型/扩图)
 * 不落行;合并格(rowspan/colspan)展开后价不错列。
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { parseKlingVideoPricing } from "./kling";
import { parseKlingCreditRates } from "./kling-shared";

const NOW = new Date("2026-11-27T00:00:00Z");
const URL = "https://klingai.com/document-api/pricing/base/video";

function fixture(name: string): string {
  return readFileSync(join(__dirname, "..", "__fixtures__", name), "utf8");
}

describe("parseKlingVideoPricing", () => {
  const rows = parseKlingVideoPricing(fixture("kling-video-pricing.html"), URL, NOW, 1);

  it("行价取基准能力(无输入视频)× 最低分辨率档;积分按 1 元/积分折算", () => {
    const k4 = rows.find((r) => r.modelKey === "kling-4-0")!;
    expect(k4.priceUnit).toBe("per_second");
    expect(k4.modality).toBe("video");
    expect(k4.providerKey).toBe("kuaishou-kling");
    expect(k4.inputPrice).toBeNull();
    expect(k4.outputPrice).toBe(1); // 720p 1.0 积分/秒 × 1 元/积分
    expect(k4.tiers!.map((t) => [t.tierLabel, t.outputPrice])).toEqual([
      ["无输入视频·720p", 1],
      ["无输入视频·1080p", 1.5],
      ["无输入视频·4K", 3.5],
      ["有输入视频·720p", 0.6],
      ["有输入视频·1080p", 0.9],
      ["有输入视频·4K", 2.1],
    ]);
  });

  it("HDR 加价行不落档(「+ 0.3积分/秒」是加价不是档价)", () => {
    const k4 = rows.find((r) => r.modelKey === "kling-4-0")!;
    for (const t of k4.tiers ?? []) {
      expect(t.tierLabel).not.toContain("HDR");
      expect([0.3, 0.5]).not.toContain(t.outputPrice);
    }
  });

  it("功能行(数字人/对口型/音频生成/图像识别)不是模型价,不落行", () => {
    const keys = rows.map((r) => r.modelKey);
    for (const k of ["数字人", "对口型", "音频生成", "图像识别", "多模态视频编辑"]) {
      expect(keys).not.toContain(k);
    }
    expect(keys.sort()).toEqual([
      "kling-2-5-turbo",
      "kling-2-6",
      "kling-3-0",
      "kling-3-0-omni",
      "kling-3-0-turbo",
      "kling-4-0",
      "kling-4-0-flash",
      "kling-o1",
    ]);
  });

  it("基准能力优先「无声」(默认无音轨):Kling 3.0 行价 0.6 元/秒", () => {
    const k3 = rows.find((r) => r.modelKey === "kling-3-0")!;
    expect(k3.outputPrice).toBe(0.6);
    expect(k3.tiers!.map((t) => t.tierLabel)).toContain("无声·720p");
  });

  it("不支持的分辨率不落档(缺价不臆测)", () => {
    const flash = rows.find((r) => r.modelKey === "kling-4-0-flash")!;
    expect(flash.outputPrice).toBe(0.6);
    expect(flash.tiers!.map((t) => t.tierLabel)).toEqual(["无输入视频·720p", "有输入视频·720p"]);
  });
});

describe("parseKlingCreditRates", () => {
  it("从页面内嵌 kConf 的 zh 段取积分单价(视频 1 元/积分、图片 0.025 元/积分)", () => {
    const html = `<script>window['kConf_ytech.klingWeb.devModelPageInfo_18n']=${JSON.stringify({
      en: { newVideoApi: { main: { subTitle: "Video API Pricing 1 Unit = $0.14 (list price)" } } },
      zh: {
        newVideoApi: { main: { subTitle: "视频API 1积分等于 1元（原价）" } },
        newImageApi: { main: { subTitle: "图片API 1积分等于 0.025元（原价）" } },
      },
    })};</script>`;
    expect(parseKlingCreditRates(html)).toEqual({ video: 1, image: 0.025 });
  });

  it("页面没有 kConf 时返回 null(调用方回落常量,不臆测)", () => {
    expect(parseKlingCreditRates("<html><body>无配置</body></html>")).toEqual({
      video: null,
      image: null,
    });
  });
});
