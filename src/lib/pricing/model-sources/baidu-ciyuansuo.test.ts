/**
 * 词元所解析单测(fixture 锚,2026-11-18 实探样本):
 * 三段式解析(目录/供应方页/模型详情)+ 模态→单位闸 + 行装配 + 翻页编排
 * (mock snapshotHtml,验证满页续翻与单页失败容忍)。
 */
import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";

const snapshotMock = vi.hoisted(() => vi.fn());

vi.mock("../render-fetch", () => ({ snapshotHtml: snapshotMock }));
vi.mock("@/lib/logger", () => ({ logWarn: vi.fn() }));

import {
  buildCiyuansuoRows,
  CYSUO_MARKET_URL,
  ciyuansuoUnitForModality,
  fetchCiyuansuo,
  parseCiyuansuoModelDetail,
  parseCiyuansuoProvider,
  parseCiyuansuoProviderDir,
} from "./baidu-ciyuansuo";

const fx = (name: string): string => readFileSync(`${__dirname}/../__fixtures__/${name}`, "utf8");

const NOW = new Date("2026-11-18T08:00:00Z");

describe("目录页解析", () => {
  it("→ 供应方全集(fixture 渲染 24/25 家,含 region)", () => {
    const providers = parseCiyuansuoProviderDir(fx("cysuo-providers-dir.html"));
    expect(providers.length).toBe(24);
    expect(providers).toContainEqual({ providerId: "1021", region: "guangzhou" });
    expect(providers).toContainEqual({ providerId: "2004", region: "beijing" });
  });
});

describe("供应方页解析(模型全集枚举)", () => {
  it("「资源信息」表 → 模型×地区(模型名即详情 slug)", () => {
    const models = parseCiyuansuoProvider(fx("cysuo-provider-minimax.html"));
    expect(models.length).toBeGreaterThan(0);
    expect(models).toContainEqual({ modelKey: "MiniMax-H3-MAX", region: "北京" });
  });
});

describe("模型详情解析", () => {
  it("文本多供应方:头部元信息 + 5 行报价(价升序,折扣/双价)", () => {
    const d = parseCiyuansuoModelDetail(fx("cysuo-detail-text-multi.html"));
    expect(d.meta).toEqual({
      modelKey: "deepseek-v4.1-flash",
      modality: "文本",
      originalVendor: "深度求索",
      contextWindow: "1M",
      supplierCount: 5,
    });
    expect(d.quotes.length).toBe(5);
    const bochuan = d.quotes.find((q) => q.supplier === "博川科技");
    expect(bochuan).toMatchObject({
      kind: "cloud",
      inputPrice: 0.74,
      outputPrice: 2.96,
      discountPercent: 63,
      status: "服务中",
    });
  });

  it("文本分页第 1 页:满 10 行(续翻信号);原厂直供行在末页", () => {
    const d = parseCiyuansuoModelDetail(fx("cysuo-detail-text-paged1.html"));
    expect(d.meta.modelKey).toBe("glm-5.3");
    expect(d.meta.supplierCount).toBe(12);
    expect(d.quotes.length).toBe(10); // 满页 → 必须翻第 2 页
    expect(d.quotes.every((q) => q.kind === "cloud")).toBe(true);
  });

  it("第 2 页:2 行,含智谱原厂直供(一手价)", () => {
    const d = parseCiyuansuoModelDetail(fx("cysuo-detail-text-page2.html"));
    expect(d.quotes.length).toBe(2);
    const zhipu = d.quotes.find((q) => q.supplier === "智谱");
    expect(zhipu).toMatchObject({ kind: "official", inputPrice: 8, outputPrice: 28 });
  });

  it("视频模型:单价格(输入 '-' → null;表格单位文案不可信)", () => {
    const d = parseCiyuansuoModelDetail(fx("cysuo-detail-video.html"));
    expect(d.meta).toMatchObject({
      modelKey: "MiniMax-H3",
      modality: "视频",
      originalVendor: "minimax",
    });
    expect(d.meta.contextWindow).toBeNull(); // 视频无上下文字段
    expect(d.quotes).toHaveLength(1);
    expect(d.quotes[0]).toMatchObject({
      supplier: "minimax",
      kind: "official",
      inputPrice: null,
      outputPrice: 0.5,
    });
  });
});

describe("模态 → 单位闸", () => {
  it("文本→百万 token;视频→按秒;未实证模态(音频/图片)→ null 跳过", () => {
    expect(ciyuansuoUnitForModality("文本")).toBe("per_1m_tokens");
    expect(ciyuansuoUnitForModality("视频")).toBe("per_second");
    expect(ciyuansuoUnitForModality("音频")).toBeNull();
    expect(ciyuansuoUnitForModality("图片")).toBeNull();
  });
});

describe("行装配", () => {
  const model = { modelKey: "deepseek-v4.1-flash", region: "广州" };

  it("云服务行:vendor=词元所·供应方,providerKey=聚合,note 带详情溯源", () => {
    const detail = parseCiyuansuoModelDetail(fx("cysuo-detail-text-multi.html"));
    const rows = buildCiyuansuoRows(model, detail, "https://cysuo.com", CYSUO_MARKET_URL, NOW);
    expect(rows).toHaveLength(5);
    const r = rows.find((x) => x.vendor === "词元所·博川科技");
    expect(r).toMatchObject({
      modelKey: "deepseek-v4.1-flash",
      currency: "CNY",
      inputPrice: 0.74,
      outputPrice: 2.96,
      contextWindow: "1M",
      providerKey: "baidu-ciyuansuo",
      modality: "text",
      priceUnit: "per_1m_tokens",
      region: "cn",
      sourceUrl: CYSUO_MARKET_URL, // 墓碑/待复核按渠道 URL 匹配
    });
    expect(r?.note).toContain("云服务转售");
    expect(r?.note).toContain("省63%");
    expect(r?.note).toContain(
      "https://cysuo.com/model-market/deepseek-v4.1-flash?region=guangzhou",
    );
  });

  it("视频行:单价格落 outputPrice,输入价 null,单位 per_second", () => {
    const detail = parseCiyuansuoModelDetail(fx("cysuo-detail-video.html"));
    const rows = buildCiyuansuoRows(
      { modelKey: "MiniMax-H3", region: "北京" },
      detail,
      "https://cysuo.com",
      CYSUO_MARKET_URL,
      NOW,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      vendor: "词元所·minimax",
      inputPrice: null,
      outputPrice: 0.5,
      priceUnit: "per_second",
      modality: "video",
    });
    expect(rows[0]?.note).toContain("原厂直供");
  });

  it("非服务中资源不收;单位不明模态整模型跳过", () => {
    const detail: Parameters<typeof buildCiyuansuoRows>[1] = {
      meta: {
        modelKey: "x",
        modality: "音频",
        originalVendor: "y",
        contextWindow: null,
        supplierCount: 1,
      },
      quotes: [
        {
          supplier: "s",
          kind: "cloud",
          inputPrice: 1,
          outputPrice: 2,
          discountPercent: null,
          status: "服务中",
        },
      ],
    };
    expect(buildCiyuansuoRows(model, detail, "https://cysuo.com", CYSUO_MARKET_URL, NOW)).toEqual(
      [],
    );
    const offline: Parameters<typeof buildCiyuansuoRows>[1] = {
      ...detail,
      meta: { ...detail.meta, modality: "文本" },
      quotes: [{ ...detail.quotes[0]!, status: "已下线" }],
    };
    expect(buildCiyuansuoRows(model, offline, "https://cysuo.com", CYSUO_MARKET_URL, NOW)).toEqual(
      [],
    );
  });
});

describe("三段式编排(mock snapshotHtml)", () => {
  beforeEach(() => {
    snapshotMock.mockReset();
  });

  it("目录 → 供应方页枚举 → 详情翻页到不满页;其余供应方页失败容忍", async () => {
    snapshotMock.mockImplementation(async (url: string) => {
      if (url.endsWith("/providers"))
        return { html: fx("cysuo-providers-dir.html"), httpStatus: 200 };
      // 25 家里只 mock 两家(内联小表);其余抛错 = 单供应方页失败容忍路径
      if (url.includes("/providers/1005")) {
        return {
          html: `<table><thead><tr><th>模型</th><th>地区</th></tr></thead><tbody><tr><td>glm-5.3</td><td>广州</td></tr></tbody></table>`,
          httpStatus: 200,
        };
      }
      if (url.includes("/providers/2004")) {
        return {
          html: `<table><thead><tr><th>模型</th><th>地区</th></tr></thead><tbody><tr><td>MiniMax-H3</td><td>北京</td></tr></tbody></table>`,
          httpStatus: 200,
        };
      }
      if (url.includes("/model-market/glm-5.3") && url.includes("page=2")) {
        return { html: fx("cysuo-detail-text-page2.html"), httpStatus: 200 };
      }
      if (url.includes("/model-market/glm-5.3")) {
        return { html: fx("cysuo-detail-text-paged1.html"), httpStatus: 200 };
      }
      if (url.includes("/model-market/MiniMax-H3")) {
        return { html: fx("cysuo-detail-video.html"), httpStatus: 200 };
      }
      throw new Error(`unexpected url ${url}`);
    });

    const rows = await fetchCiyuansuo(CYSUO_MARKET_URL, undefined, NOW, { gapMs: 0 });
    // glm-5.3:10(cloud)+2(末页含智谱原厂);MiniMax-H3:1(原厂)
    const glm = rows.filter((r) => r.modelKey === "glm-5.3");
    const h3 = rows.filter((r) => r.modelKey === "MiniMax-H3");
    expect(glm.length).toBe(12);
    expect(h3.length).toBe(1);
    expect(rows.some((r) => r.vendor === "词元所·智谱" && r.note.includes("原厂直供"))).toBe(true);
    // glm 详情翻了第 2 页(满页 10 → 续翻)
    const glmPage2 = snapshotMock.mock.calls.some(
      (c) => String(c[0]).includes("glm-5.3") && String(c[0]).includes("page=2"),
    );
    expect(glmPage2).toBe(true);
  });

  it("零行 → 源失败(上抛)", async () => {
    snapshotMock.mockImplementation(async (url: string) => {
      if (url.endsWith("/providers"))
        return { html: fx("cysuo-providers-dir.html"), httpStatus: 200 };
      throw new Error("boom");
    });
    await expect(fetchCiyuansuo(CYSUO_MARKET_URL, undefined, NOW, { gapMs: 0 })).rejects.toThrow(
      /模型枚举为空|全量解析失败/,
    );
  });
});
