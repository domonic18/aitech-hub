/**
 * 站点配置 kv 单测(M10 批② band 条数;M12 批② 键族):读侧回落/clamp、
 * getSiteSettings 全量兜底、setSiteConfig 多键事务 upsert 与 Zod 拒绝。
 */
import { describe, expect, it, vi } from "vitest";

const prismaMock = vi.hoisted(() => ({
  siteConfig: {
    findUnique: vi.fn<(args?: unknown) => Promise<unknown>>(),
    findMany: vi.fn<(args?: unknown) => Promise<unknown[]>>(),
    upsert: vi.fn<(args: unknown) => Promise<unknown>>(),
  },
  $transaction: vi.fn<(arg: unknown) => Promise<unknown>>(),
}));
vi.mock("../db", () => ({ prisma: prismaMock }));

import { DEFAULT_BAND_ITEM_COUNT } from "../telegram/constants";
import {
  DEFAULT_HOME_SEARCH_TERMS_CONFIG,
  DEFAULT_POST_COPYRIGHT_MD,
  DEFAULT_POST_COUNT,
  DEFAULT_REPO_COUNT,
  DEFAULT_SITE_TITLE,
  SITE_CONFIG_KEYS,
  clampSearchTermsCount,
  getBandItemCount,
  getHeroMd,
  getPostCopyrightMd,
  getPostCount,
  getRepoCount,
  getSiteSettings,
  getSiteTitle,
  normalizeSearchTermsWords,
  parseHomeSearchTerms,
  setSiteConfig,
} from "./site-config";

describe("getBandItemCount(M10 后台可配)", () => {
  it("行有合法值 → 该值", async () => {
    prismaMock.siteConfig.findUnique.mockResolvedValueOnce({ value: "25" });
    expect(await getBandItemCount()).toBe(25);
    expect(prismaMock.siteConfig.findUnique).toHaveBeenCalledWith({
      where: { key: SITE_CONFIG_KEYS.bandItemCount },
      select: { value: true },
    });
  });

  it("行缺/非数值/非正数 → 默认 12(损坏值按缺行处理);越界正数 → clamp 1..50", async () => {
    prismaMock.siteConfig.findUnique.mockResolvedValueOnce(null);
    expect(await getBandItemCount()).toBe(DEFAULT_BAND_ITEM_COUNT);
    prismaMock.siteConfig.findUnique.mockResolvedValueOnce({ value: "abc" });
    expect(await getBandItemCount()).toBe(DEFAULT_BAND_ITEM_COUNT);
    prismaMock.siteConfig.findUnique.mockResolvedValueOnce({ value: "0" });
    expect(await getBandItemCount()).toBe(DEFAULT_BAND_ITEM_COUNT);
    prismaMock.siteConfig.findUnique.mockResolvedValueOnce({ value: "99" });
    expect(await getBandItemCount()).toBe(50);
  });
});

describe("首页 rail 条数(M12 键族)", () => {
  it("getRepoCount:默认 3;合法值直取;低于下限回落默认;超上限 clamp 12", async () => {
    prismaMock.siteConfig.findUnique.mockResolvedValueOnce(null);
    expect(await getRepoCount()).toBe(DEFAULT_REPO_COUNT);
    prismaMock.siteConfig.findUnique.mockResolvedValueOnce({ value: "7" });
    expect(await getRepoCount()).toBe(7);
    prismaMock.siteConfig.findUnique.mockResolvedValueOnce({ value: "0" });
    expect(await getRepoCount()).toBe(DEFAULT_REPO_COUNT);
    prismaMock.siteConfig.findUnique.mockResolvedValueOnce({ value: "99" });
    expect(await getRepoCount()).toBe(12);
  });

  it("getPostCount:默认 5;非整数回落默认", async () => {
    prismaMock.siteConfig.findUnique.mockResolvedValueOnce(null);
    expect(await getPostCount()).toBe(DEFAULT_POST_COUNT);
    prismaMock.siteConfig.findUnique.mockResolvedValueOnce({ value: "9.5" });
    expect(await getPostCount()).toBe(DEFAULT_POST_COUNT);
    prismaMock.siteConfig.findUnique.mockResolvedValueOnce({ value: "8" });
    expect(await getPostCount()).toBe(8);
  });
});

describe("站点标题与 hub 文案(M12 键族)", () => {
  it("getSiteTitle:缺省/空白 → 「一起AI」;配置值 trim 后直取", async () => {
    prismaMock.siteConfig.findUnique.mockResolvedValueOnce(null);
    expect(await getSiteTitle()).toBe(DEFAULT_SITE_TITLE);
    prismaMock.siteConfig.findUnique.mockResolvedValueOnce({ value: "   " });
    expect(await getSiteTitle()).toBe(DEFAULT_SITE_TITLE);
    prismaMock.siteConfig.findUnique.mockResolvedValueOnce({ value: "  我的站  " });
    expect(await getSiteTitle()).toBe("我的站");
  });

  it("getHeroMd:缺省/空白 → 空串(前台回退内置文案);配置值原样透传", async () => {
    prismaMock.siteConfig.findUnique.mockResolvedValueOnce(null);
    expect(await getHeroMd()).toBe("");
    prismaMock.siteConfig.findUnique.mockResolvedValueOnce({ value: " \n " });
    expect(await getHeroMd()).toBe("");
    prismaMock.siteConfig.findUnique.mockResolvedValueOnce({ value: " # **Hub** 与 `AI`" });
    expect(await getHeroMd()).toBe("# **Hub** 与 `AI`");
  });

  it("getPostCopyrightMd:缺行 → 内置默认;显式空串 → 空(关闭区块);配置值 trim", async () => {
    prismaMock.siteConfig.findUnique.mockResolvedValueOnce(null);
    expect(await getPostCopyrightMd()).toBe(DEFAULT_POST_COPYRIGHT_MD);
    prismaMock.siteConfig.findUnique.mockResolvedValueOnce({ value: "" });
    expect(await getPostCopyrightMd()).toBe("");
    prismaMock.siteConfig.findUnique.mockResolvedValueOnce({ value: "  第一行\n第二行  " });
    expect(await getPostCopyrightMd()).toBe("第一行\n第二行");
  });
});

describe("getSiteSettings(admin 页与 GET API 全量读)", () => {
  it("findMany 单次取全键并逐键解析;空表 → 全默认", async () => {
    prismaMock.siteConfig.findMany.mockResolvedValueOnce([
      { key: SITE_CONFIG_KEYS.bandItemCount, value: "20" },
      { key: SITE_CONFIG_KEYS.repoCount, value: "6" },
      { key: SITE_CONFIG_KEYS.postCount, value: "10" },
      { key: SITE_CONFIG_KEYS.siteTitle, value: "17AI" },
      { key: SITE_CONFIG_KEYS.heroMd, value: "# 配置文案" },
      { key: SITE_CONFIG_KEYS.aboutMd, value: "# 自定义关于" },
      { key: SITE_CONFIG_KEYS.icp, value: " 京ICP备2022035466号-2 " },
      { key: SITE_CONFIG_KEYS.postCopyrightMd, value: " 版权所有 © 2026 " },
      {
        key: SITE_CONFIG_KEYS.homeSearchTerms,
        value: JSON.stringify({ words: ["Claude Code", "MCP"], count: 4 }),
      },
    ]);
    expect(await getSiteSettings()).toEqual({
      bandItemCount: 20,
      repoCount: 6,
      postCount: 10,
      siteTitle: "17AI",
      heroMd: "# 配置文案",
      aboutMd: "# 自定义关于",
      icp: "京ICP备2022035466号-2",
      postCopyrightMd: "版权所有 © 2026",
      homeSearchTerms: { words: ["Claude Code", "MCP"], count: 4 },
    });
    prismaMock.siteConfig.findMany.mockResolvedValueOnce([]);
    expect(await getSiteSettings()).toEqual({
      bandItemCount: DEFAULT_BAND_ITEM_COUNT,
      repoCount: DEFAULT_REPO_COUNT,
      postCount: DEFAULT_POST_COUNT,
      siteTitle: DEFAULT_SITE_TITLE,
      heroMd: "",
      aboutMd: "",
      icp: "",
      postCopyrightMd: DEFAULT_POST_COPYRIGHT_MD,
      homeSearchTerms: DEFAULT_HOME_SEARCH_TERMS_CONFIG,
    });
  });
});

describe("setSiteConfig(M12 多键 partial)", () => {
  it("合法 partial → 事务 upsert 落字符串;siteTitle 由 Zod trim", async () => {
    prismaMock.$transaction.mockResolvedValueOnce([]);
    await setSiteConfig({
      repoCount: 4,
      siteTitle: " 我的站 ",
      heroMd: "# hi",
      aboutMd: "# 关于",
      icp: " 京ICP备2022035466号-2 ",
      postCopyrightMd: " 第一行\n第二行 ",
      homeSearchTerms: { words: [" 甲组 ", "甲组", "乙组"], count: 4 },
    });
    expect(prismaMock.$transaction).toHaveBeenCalledTimes(1);
    const ops = prismaMock.siteConfig.upsert.mock.calls.map(
      (call) => call[0] as { where: { key: string }; create: { key: string; value: string } },
    );
    const byKey = new Map(ops.map((op) => [op.where.key, op.create.value]));
    expect(byKey.get(SITE_CONFIG_KEYS.repoCount)).toBe("4");
    expect(byKey.get(SITE_CONFIG_KEYS.siteTitle)).toBe("我的站");
    expect(byKey.get(SITE_CONFIG_KEYS.heroMd)).toBe("# hi");
    expect(byKey.get(SITE_CONFIG_KEYS.aboutMd)).toBe("# 关于");
    expect(byKey.get(SITE_CONFIG_KEYS.icp)).toBe("京ICP备2022035466号-2");
    expect(byKey.get(SITE_CONFIG_KEYS.postCopyrightMd)).toBe("第一行\n第二行");
    // Zod 先 trim,serialize 再去重/钳个数 → 落库为归一后的 JSON
    expect(byKey.get(SITE_CONFIG_KEYS.homeSearchTerms)).toBe('{"words":["甲组","乙组"],"count":4}');
    expect(ops).toHaveLength(7);
  });

  it("越界/空标题/超长文案 → Zod 拒绝且不落库;空对象 → 零写入", async () => {
    await expect(setSiteConfig({ repoCount: 0 })).rejects.toThrow();
    await expect(setSiteConfig({ postCount: 13 })).rejects.toThrow();
    await expect(setSiteConfig({ bandItemCount: 51 })).rejects.toThrow();
    await expect(setSiteConfig({ siteTitle: "   " })).rejects.toThrow();
    await expect(setSiteConfig({ heroMd: "x".repeat(2001) })).rejects.toThrow();
    await expect(setSiteConfig({ aboutMd: "x".repeat(8001) })).rejects.toThrow();
    await expect(setSiteConfig({ icp: "x".repeat(61) })).rejects.toThrow();
    await expect(setSiteConfig({ postCopyrightMd: "x".repeat(1001) })).rejects.toThrow();
    // 建议词:超 4 个 / 空词 / 超长词 / 个数越界 / 未知字段(strict)一律拒绝
    await expect(
      setSiteConfig({ homeSearchTerms: { words: ["aa", "bb", "cc", "dd", "ee"], count: 3 } }),
    ).rejects.toThrow();
    await expect(setSiteConfig({ homeSearchTerms: { words: ["  "], count: 3 } })).rejects.toThrow();
    await expect(setSiteConfig({ homeSearchTerms: { words: ["x"], count: 3 } })).rejects.toThrow();
    await expect(
      setSiteConfig({ homeSearchTerms: { words: ["x".repeat(25)], count: 3 } }),
    ).rejects.toThrow();
    await expect(setSiteConfig({ homeSearchTerms: { words: [], count: 2 } })).rejects.toThrow();
    await expect(setSiteConfig({ homeSearchTerms: { words: [], count: 5 } })).rejects.toThrow();
    await expect(
      setSiteConfig({
        homeSearchTerms: { words: [], count: 3, typo: 1 } as unknown as {
          words: string[];
          count: number;
        },
      }),
    ).rejects.toThrow();
    await setSiteConfig({});
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
  });
});

describe("首页搜索建议词存储解析(M70)", () => {
  it("parseHomeSearchTerms:缺行/坏 JSON/非对象 → 默认;合法 JSON 归一", () => {
    expect(parseHomeSearchTerms(null)).toEqual(DEFAULT_HOME_SEARCH_TERMS_CONFIG);
    expect(parseHomeSearchTerms("{")).toEqual(DEFAULT_HOME_SEARCH_TERMS_CONFIG);
    expect(parseHomeSearchTerms("[]")).toEqual(DEFAULT_HOME_SEARCH_TERMS_CONFIG);
    expect(parseHomeSearchTerms('"x"')).toEqual(DEFAULT_HOME_SEARCH_TERMS_CONFIG);
    // words 类型不符 → [];count 越界 → clamp 4(与其它整数键同口径)
    expect(parseHomeSearchTerms('{"words":"x","count":9}')).toEqual({ words: [], count: 4 });
    expect(parseHomeSearchTerms('{"words":[" 甲组 ","甲组", 3, ""],"count":4}')).toEqual({
      words: ["甲组"],
      count: 4,
    });
  });

  it("normalizeSearchTermsWords:trim/去空/去超长/大小写不敏感去重/截 4 个", () => {
    expect(
      normalizeSearchTermsWords([" MCP ", "mcp", "", "x".repeat(25), "甲组", "乙组", "丙组"]),
    ).toEqual(["MCP", "甲组", "乙组", "丙组"]);
    expect(normalizeSearchTermsWords("not-array")).toEqual([]);
  });

  it("clampSearchTermsCount:整数 3-4 直取;越界/非法钳回默认/上限", () => {
    expect(clampSearchTermsCount(3)).toBe(3);
    expect(clampSearchTermsCount(4)).toBe(4);
    expect(clampSearchTermsCount(9)).toBe(4);
    expect(clampSearchTermsCount(2)).toBe(DEFAULT_HOME_SEARCH_TERMS_CONFIG.count);
    expect(clampSearchTermsCount("abc")).toBe(DEFAULT_HOME_SEARCH_TERMS_CONFIG.count);
  });
});
