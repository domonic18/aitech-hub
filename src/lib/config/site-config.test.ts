/**
 * 站点配置 kv 单测(M10 批②):getBandItemCount 读侧(缺行/非数值回落 12,
 * 越界 clamp 1..50)+ setBandItemCount 写侧(Zod 校验 + upsert 字符串化)。
 */
import { describe, expect, it, vi } from "vitest";

const prismaMock = vi.hoisted(() => ({
  siteConfig: {
    findUnique: vi.fn<(args?: unknown) => Promise<unknown>>(),
    upsert: vi.fn<(args: unknown) => Promise<unknown>>(),
  },
}));
vi.mock("../db", () => ({ prisma: prismaMock }));

import { DEFAULT_BAND_ITEM_COUNT } from "../telegram/constants";
import { SITE_CONFIG_KEYS, getBandItemCount, setBandItemCount } from "./site-config";

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

describe("setBandItemCount", () => {
  it("合法值 → upsert 落字符串;越界 → Zod 拒绝且不落库", async () => {
    prismaMock.siteConfig.upsert.mockResolvedValueOnce({});
    await setBandItemCount(30);
    expect(prismaMock.siteConfig.upsert).toHaveBeenCalledWith({
      where: { key: SITE_CONFIG_KEYS.bandItemCount },
      update: { value: "30" },
      create: { key: SITE_CONFIG_KEYS.bandItemCount, value: "30" },
    });
    await expect(setBandItemCount(0)).rejects.toThrow();
    await expect(setBandItemCount(51)).rejects.toThrow();
    await expect(setBandItemCount(12.5)).rejects.toThrow();
    expect(prismaMock.siteConfig.upsert).toHaveBeenCalledTimes(1);
  });
});
