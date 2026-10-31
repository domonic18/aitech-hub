/**
 * 榜单展示格式化单测(M63):来源域名解析是署名 chip 的唯一派生点
 * (站名 + 域名 + ↗),域名错了署名就指向错的地方,故单独钉死。
 */
import { describe, expect, it } from "vitest";

import { formatCnyPrice, formatCompact, formatPrice, hostOf } from "./format";

describe("hostOf", () => {
  it("取域名并去掉 www", () => {
    expect(hostOf("https://www.huggingface.co/models?sort=trending")).toBe("huggingface.co");
    expect(hostOf("https://github.com/trending?since=daily")).toBe("github.com");
    expect(hostOf("https://artificialanalysis.ai/leaderboards/models")).toBe(
      "artificialanalysis.ai",
    );
  });

  it("非 http(s) 或畸形输入回空串(署名不渲染域名,不抛错)", () => {
    expect(hostOf("")).toBe("");
    expect(hostOf("not a url")).toBe("");
    expect(hostOf("/relative/path")).toBe("");
  });
});

describe("价格与计数格式", () => {
  it("缺值/NaN/负数一律空串或破折号,不出现 NaN", () => {
    for (const v of [null, undefined, Number.NaN, -1]) {
      expect(formatCompact(v)).toBe("");
      expect(formatPrice(v)).toBe("");
      expect(formatCnyPrice(v)).toBe("");
    }
  });

  it("美元原文与人民币折算各留合适位宽,0 显示免费", () => {
    expect(formatPrice(0.6)).toBe("$0.6");
    expect(formatCnyPrice(0.6 * 7.2)).toBe("¥4.3");
    expect(formatCnyPrice(0.6 * 1.1)).toBe("¥0.66");
    expect(formatPrice(0)).toBe("免费");
    expect(formatCnyPrice(0)).toBe("免费");
  });
});
