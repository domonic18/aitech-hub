/**
 * 生数科技 Vidu 牌价解析单测(M81,2026-11-27 实探):golden 样本为渲染后页面裁剪。
 * 锚点:恒定每秒价落 per_second(积分 × 0.03125 元);错峰积分消耗列不采(只取标准价);
 * 行价取基准能力 × 最低分辨率档;递进价/按片价不收;图片按张计价。
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { parseViduPricing } from "./vidu";

const NOW = new Date("2026-11-27T00:00:00Z");
const URL = "https://platform.vidu.cn/docs/overview/pricing";

function readFixture(): string {
  return readFileSync(join(__dirname, "..", "__fixtures__", "vidu-pricing.html"), "utf8");
}

describe("parseViduPricing", () => {
  it("恒定每秒价落 per_second;积分按页面单价折算(1 积分 = 0.03125 元)", () => {
    const rows = parseViduPricing(readFixture(), URL, NOW);
    const q4 = rows.find((r) => r.modelKey === "viduq4-preview")!;
    expect(q4.priceUnit).toBe("per_second");
    expect(q4.modality).toBe("video");
    expect(q4.providerKey).toBe("shengshu-vidu");
    expect(q4.currency).toBe("CNY");
    // 540p 9 积分/秒 → 0.28125 元/秒
    expect(q4.outputPrice).toBe(0.28125);
    expect(q4.tiers!.map((t) => [t.tierLabel, t.outputPrice])).toEqual([
      ["图生、参考生·540p", 0.28125],
      ["图生、参考生·720p", 0.59375],
      ["图生、参考生·1080p", 0.75],
      ["图生、 参考生·2K", 1.1875],
      ["图生、参考生·4K", 2.4375],
    ]);
  });

  it("错峰积分消耗不采(只取标准价):viduq3-pro 540p 是 9 积分不是错峰的 5", () => {
    const rows = parseViduPricing(readFixture(), URL, NOW);
    const pro = rows.find((r) => r.modelKey === "viduq3-pro")!;
    expect(pro.outputPrice).toBe(0.28125);
    expect(pro.tiers!.map((t) => t.outputPrice)).toEqual([0.75, 0.625, 0.28125]);
  });

  it("行价取基准能力(文生)× 最低分辨率档;其余能力档全落档位表", () => {
    const rows = parseViduPricing(readFixture(), URL, NOW);
    const turbo = rows.find((r) => r.modelKey === "viduq3-turbo")!;
    // 图生、文生、首尾帧 540p = 7 积分/秒 → 0.21875;参考生视频另立档
    expect(turbo.outputPrice).toBe(0.21875);
    expect(turbo.tiers!.map((t) => t.tierLabel)).toEqual([
      "图生、文生、首尾帧·1080p",
      "图生、文生、首尾帧·720p",
      "图生、文生、首尾帧·540p",
      "参考生视频·540p",
      "参考生视频·720p",
      "参考生视频·1080p",
    ]);
  });

  it("图片按张计价(per_image);参考生图价随输入张数分档", () => {
    const rows = parseViduPricing(readFixture(), URL, NOW);
    const q2 = rows.find((r) => r.modelKey === "viduq2")!;
    expect(q2.priceUnit).toBe("per_image");
    expect(q2.modality).toBe("image");
    expect(q2.inputPrice).toBeNull();
    // 文生图 1080p 6 积分/张 → 0.1875
    expect(q2.outputPrice).toBe(0.1875);
    expect(q2.tiers!.map((t) => t.tierLabel)).toContain("参考生图·1～3张·4K");
    expect(q2.tiers!.map((t) => t.tierLabel)).toContain("文生图·1080p");
  });

  it("递进价/按片价不收(合成表:递进价与整条积分都不落行)", () => {
    const html = `
      <table><tr><th>积分</th><th>价格（RMB）</th></tr><tr><td>1</td><td>0.03125</td></tr></table>
      <table>
        <tr><th>能力</th><th>模型版本</th><th>时长</th><th>清晰度</th><th>积分消耗</th></tr>
        <tr><td>文生</td><td>Q2</td><td>1-16秒</td><td>720P</td><td>第1秒15积分，后续每秒+5积分</td></tr>
        <tr><td>文生</td><td>vidu1</td><td>5S</td><td>1080p</td><td>80</td></tr>
        <tr><td>文生</td><td>viduq3</td><td>1-16秒</td><td>720p</td><td>每秒12积分</td></tr>
      </table>`;
    const rows = parseViduPricing(html, URL, NOW);
    expect(rows.map((r) => r.modelKey)).toEqual(["viduq3"]);
    expect(rows[0]!.outputPrice).toBe(0.375);
  });

  it("只收恒定每秒价模型:fixture 里不含递进价模型", () => {
    const rows = parseViduPricing(readFixture(), URL, NOW);
    for (const r of rows) {
      for (const t of r.tiers ?? []) {
        expect(t.tierLabel).not.toContain("第1秒");
      }
    }
    expect(rows.map((r) => r.modelKey).sort()).toEqual(
      [
        "viduq2",
        "viduq3",
        "viduq3-mix",
        "viduq3-pro",
        "viduq3-pro-fast",
        "viduq3-turbo",
        "viduq4-preview",
        "viduq1",
      ].sort(),
    );
  });

  it("页面改版(无价格表)时抛错,不静默返回空", () => {
    expect(() => parseViduPricing("<div></div>", URL, NOW)).toThrow(/页面可能改版/);
  });
});
