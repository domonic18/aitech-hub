/**
 * IP 归属地标注(2026-11-25 方案②):ip2region v4 内存查表(上游 XDB 快照
 * 2026-10 构建,数据随 npm 包发布,国内到市级),统计页最近访问/在线用户
 * 两个 RSC 渲染时逐行调用,零网络零新表。families 只配 v4:生产 7 天 2763
 * 访问 0 IPv6,v6 库 37MB 不值得常驻;Node 反代下的 ::ffff: 映射形态由库
 * 选项 mappedIPv6 归一到 v4 仍可解析,真 IPv6 抛 UNSUPPORTED_FAMILY。
 * 尽力而为口径:非法 IP / 内网 Reserved(结构化字段为空) / 未命中一律
 * null,不拖垮页面渲染;构造失败(standalone 打包漏数据文件属此类)warn
 * 一次并按进程缓存,静默降级要能被日志发现。
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

/** IP → 归属地短标签;空串/非法/未支持地址族/未命中 → null(统计尽力而为) */
export function ipRegionLabel(ip: string): string | null {
  const c = client();
  if (c === null || ip === "") return null;
  try {
    return regionLabel(c.lookup(ip));
  } catch {
    return null;
  }
}
