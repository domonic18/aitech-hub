/**
 * IP 归属地解析(2026-11-25 方案②+方案① 一期):ip2region v4 内存查表
 * (上游 XDB 快照 2026-10 构建,数据随 npm 包发布,国内到市级),零网络。
 * 两个出口口径:
 *  - 展示(ipRegionLabel/regionLabel):统计页最近访问/在线用户 IP 下短标签,
 *    国内到市级「广东省·深圳市」;
 *  - 聚合(ipRegionParts/regionPartsOf):ingest 侧日缓冲 → stats_region_daily,
 *    国内省级、境外国家级(方案① 一期口径)。
 * families 只配 v4:生产 7 天 2763 访问 0 IPv6,v6 库 37MB 不值得常驻;Node
 * 反代下的 ::ffff: 映射形态由库选项 mappedIPv6 归一到 v4 仍可解析,真 IPv6
 * 抛 UNSUPPORTED_FAMILY。尽力而为口径:非法 IP / 内网 Reserved(结构化字段
 * 为空) / 未命中一律 null,不拖垮页面渲染;构造失败(standalone 打包漏数据
 * 文件属此类)warn 一次并按进程缓存,静默降级要能被日志发现。
 */
import { IP2Region } from "ip2region/node";
import type { LookupResult } from "ip2region";

import { logWarn } from "@/lib/logger";

let instance: IP2Region | null | undefined;

function client(): IP2Region | null {
  if (instance !== undefined) return instance;
  try {
    instance = new IP2Region({ families: [4], mappedIPv6: "ipv4" });
  } catch (e) {
    instance = null;
    logWarn("stats.ip_region.init_failed", { error: e });
  }
  return instance;
}

/**
 * 查询结果 → 展示短标签:国内「广东省·深圳市」(直辖市省市同名折叠)、
 * 国外「United States·California」;无国家名(内网 Reserved/未命中)→ null。
 * 纯函数,单测直接钉拼接口径。
 */
export function regionLabel(result: LookupResult | null): string | null {
  const country = result?.country?.name;
  if (!country) return null;
  const province = result?.subdivisions?.[0]?.name;
  const city = result?.city?.name;
  if (country === "中国") {
    if (province && city && province !== city) return `${province}·${city}`;
    return province ?? country;
  }
  return province ? `${country}·${province}` : country;
}

/** 聚合口径的地区(方案① 一期):国内省级、境外国家级(市级只做展示标注) */
export interface RegionParts {
  country: string;
  /** 仅国内有值;境外折叠到国家级(入表时折成空串) */
  province: string | null;
}

/**
 * 查询结果 → 聚合地区(纯函数):国内取省(缺省落 null → 入表「中国」未细化行),
 * 境外折叠国家级;无国家名 → null。与 regionLabel 共用同一降级面但口径独立:
 * 聚合不吃市级,展示不吃折叠。
 */
export function regionPartsOf(result: LookupResult | null): RegionParts | null {
  const country = result?.country?.name;
  if (!country) return null;
  const province = result?.subdivisions?.[0]?.name ?? null;
  return { country, province: country === "中国" ? province : null };
}

/** 统一降级面:空串/非法/未支持地址族/未命中/库缺失 → null(统计尽力而为) */
function lookupOf(ip: string): LookupResult | null {
  const c = client();
  if (c === null || ip === "") return null;
  try {
    return c.lookup(ip);
  } catch {
    return null;
  }
}

/** IP → 聚合地区(降级面同 lookupOf) */
export function ipRegionParts(ip: string): RegionParts | null {
  return regionPartsOf(lookupOf(ip));
}

/** IP → 归属地短标签(降级面同 lookupOf) */
export function ipRegionLabel(ip: string): string | null {
  return regionLabel(lookupOf(ip));
}
