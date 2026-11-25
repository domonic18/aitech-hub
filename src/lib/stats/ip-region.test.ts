/**
 * IP 归属地标注单测:regionLabel 拼接口径(纯函数)+ ipRegionLabel 降级面
 * (非法 IP 抛错/未命中/内网 Reserved → null、::ffff: 透传库侧归一、lazy
 * 单例、构造失败 warn 一次并按进程缓存)。库侧 mock(ip2region/node),
 * 实例为模块级缓存,每例 resetModules 隔离(同电报流 band 缓存单测手法)。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const { IP2Region, logWarn } = vi.hoisted(() => ({
  IP2Region: vi.fn(),
  logWarn: vi.fn(),
}));

vi.mock("ip2region/node", () => ({ IP2Region }));
vi.mock("@/lib/logger", () => ({ logWarn }));

type RegionModule = typeof import("./ip-region");

async function loadModule(): Promise<RegionModule> {
  vi.resetModules();
  return await import("./ip-region");
}

/** mock 客户端:lookup 行为按例注入(实现须为普通函数,箭头函数不可 new) */
function mockLookup(lookup: (ip: string) => unknown): void {
  IP2Region.mockImplementation(function () {
    return { lookup };
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockLookup(() => null);
});

describe("regionLabel(拼接口径)", () => {
  it("国内省市 → 省·市", async () => {
    const { regionLabel } = await loadModule();
    expect(
      regionLabel({
        country: { name: "中国", code: "CN" },
        subdivisions: [{ name: "广东省" }],
        city: { name: "深圳市" },
      }),
    ).toBe("广东省·深圳市");
  });

  it("直辖市省市同名 → 折叠单段", async () => {
    const { regionLabel } = await loadModule();
    expect(
      regionLabel({
        country: { name: "中国" },
        subdivisions: [{ name: "上海市" }],
        city: { name: "上海市" },
      }),
    ).toBe("上海市");
  });

  it("国内缺市 → 只出省", async () => {
    const { regionLabel } = await loadModule();
    expect(regionLabel({ country: { name: "中国" }, subdivisions: [{ name: "青海省" }] })).toBe(
      "青海省",
    );
  });

  it("国内缺省 → 退到国家名", async () => {
    const { regionLabel } = await loadModule();
    expect(regionLabel({ country: { name: "中国" } })).toBe("中国");
  });

  it("国外有州 → 国家·州", async () => {
    const { regionLabel } = await loadModule();
    expect(
      regionLabel({
        country: { name: "United States", code: "US" },
        subdivisions: [{ name: "California" }],
      }),
    ).toBe("United States·California");
  });

  it("国外无州 → 只出国家名", async () => {
    const { regionLabel } = await loadModule();
    expect(regionLabel({ country: { name: "Australia", code: "AU" } })).toBe("Australia");
  });

  it("内网 Reserved(结构化字段全缺)与未命中 → null", async () => {
    const { regionLabel } = await loadModule();
    expect(regionLabel({})).toBeNull();
    expect(regionLabel(null)).toBeNull();
    expect(regionLabel({ isp: "0" })).toBeNull();
  });
});

describe("regionPartsOf(聚合口径)", () => {
  it("国内取省(市级不入聚合)", async () => {
    const { regionPartsOf } = await import("./ip-region");
    expect(
      regionPartsOf({
        country: { name: "中国" },
        subdivisions: [{ name: "广东省" }],
        city: { name: "深圳市" },
      }),
    ).toEqual({ country: "中国", province: "广东省" });
  });

  it("国内缺省 → province null(入表「中国」未细化行)", async () => {
    const { regionPartsOf } = await import("./ip-region");
    expect(regionPartsOf({ country: { name: "中国" } })).toEqual({
      country: "中国",
      province: null,
    });
  });

  it("境外折叠国家级:subdivision 不进聚合", async () => {
    const { regionPartsOf } = await import("./ip-region");
    expect(
      regionPartsOf({
        country: { name: "United States" },
        subdivisions: [{ name: "California" }],
      }),
    ).toEqual({ country: "United States", province: null });
  });

  it("内网 Reserved / 未命中 → null", async () => {
    const { regionPartsOf } = await import("./ip-region");
    expect(regionPartsOf({})).toBeNull();
    expect(regionPartsOf(null)).toBeNull();
  });
});

describe("ipRegionLabel(降级面)", () => {
  it("命中 → 标签;ip 原样透传(含 ::ffff:,归一由库选项负责)", async () => {
    const lookup = vi.fn().mockReturnValue({
      country: { name: "中国" },
      subdivisions: [{ name: "广东省" }],
      city: { name: "深圳市" },
    });
    mockLookup(lookup);
    const { ipRegionLabel } = await loadModule();
    expect(ipRegionLabel("120.24.78.68")).toBe("广东省·深圳市");
    expect(ipRegionLabel("::ffff:120.24.78.68")).toBe("广东省·深圳市");
    expect(lookup).toHaveBeenNthCalledWith(1, "120.24.78.68");
    expect(lookup).toHaveBeenNthCalledWith(2, "::ffff:120.24.78.68");
  });

  it("lookup 抛错(INVALID_IP / UNSUPPORTED_FAMILY)→ null", async () => {
    mockLookup(() => {
      throw new Error("INVALID_IP");
    });
    const { ipRegionLabel } = await loadModule();
    expect(ipRegionLabel("abc")).toBeNull();
  });

  it("空 ip → null 且不触发查询", async () => {
    const lookup = vi.fn();
    mockLookup(lookup);
    const { ipRegionLabel } = await loadModule();
    expect(ipRegionLabel("")).toBeNull();
    expect(lookup).not.toHaveBeenCalled();
  });

  it("实例 lazy 构造一次,多次查询复用", async () => {
    mockLookup(() => ({ country: { name: "中国" }, subdivisions: [{ name: "北京市" }] }));
    const { ipRegionLabel } = await loadModule();
    ipRegionLabel("1.2.3.4");
    ipRegionLabel("5.6.7.8");
    expect(IP2Region).toHaveBeenCalledTimes(1);
  });

  it("ipRegionParts 与 ipRegionLabel 同一降级面(聚合口径出口)", async () => {
    const lookup = vi.fn().mockReturnValue({
      country: { name: "中国" },
      subdivisions: [{ name: "广东省" }],
      city: { name: "深圳市" },
    });
    mockLookup(lookup);
    const { ipRegionParts } = await loadModule();
    expect(ipRegionParts("120.24.78.68")).toEqual({ country: "中国", province: "广东省" });
    expect(ipRegionParts("")).toBeNull();
    lookup.mockImplementation(() => {
      throw new Error("INVALID_IP");
    });
    expect(ipRegionParts("abc")).toBeNull();
  });

  it("构造失败 → null 且 warn 一次,进程内不再重试", async () => {
    IP2Region.mockImplementation(function () {
      throw new Error("FILE_NOT_FOUND");
    });
    const { ipRegionLabel } = await loadModule();
    expect(ipRegionLabel("120.24.78.68")).toBeNull();
    expect(ipRegionLabel("120.24.78.68")).toBeNull();
    expect(IP2Region).toHaveBeenCalledTimes(1);
    expect(logWarn).toHaveBeenCalledTimes(1);
    expect(logWarn).toHaveBeenCalledWith("stats.ip_region.init_failed", {
      error: expect.any(Error),
    });
  });
});
