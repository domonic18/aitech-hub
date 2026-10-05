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
  DEFAULT_POST_COUNT,
  DEFAULT_REPO_COUNT,
  DEFAULT_SITE_TITLE,
  SITE_CONFIG_KEYS,
  getBandItemCount,
  getHeroMd,
  getPostCount,
  getRepoCount,
  getSiteSettings,
  getSiteTitle,
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
    ]);
    expect(await getSiteSettings()).toEqual({
      bandItemCount: 20,
      repoCount: 6,
      postCount: 10,
      siteTitle: "17AI",
      heroMd: "# 配置文案",
      aboutMd: "# 自定义关于",
      icp: "京ICP备2022035466号-2",
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
    expect(ops).toHaveLength(5);
  });

  it("越界/空标题/超长文案 → Zod 拒绝且不落库;空对象 → 零写入", async () => {
    await expect(setSiteConfig({ repoCount: 0 })).rejects.toThrow();
    await expect(setSiteConfig({ postCount: 13 })).rejects.toThrow();
    await expect(setSiteConfig({ bandItemCount: 51 })).rejects.toThrow();
    await expect(setSiteConfig({ siteTitle: "   " })).rejects.toThrow();
    await expect(setSiteConfig({ heroMd: "x".repeat(2001) })).rejects.toThrow();
    await expect(setSiteConfig({ aboutMd: "x".repeat(8001) })).rejects.toThrow();
    await expect(setSiteConfig({ icp: "x".repeat(61) })).rejects.toThrow();
    await setSiteConfig({});
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
  });
});
