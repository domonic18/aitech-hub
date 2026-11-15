/**
 * 牌价厂商字典种子(M74 批A,纯常量·零库依赖零 env)。
 *
 * 为什么要这张表:牌价行的 `vendor` 是各采集器写死的自由文本,同一厂商有多种
 * 写法(「月之暗面 Moonshot」与「月之暗面 Kimi」是同一家),既无法按厂商聚合,
 * 也无法按「一手厂商 / 聚合交易平台」区分——而后者正是「找全网最便宜提供方」
 * 的关键维度(R1/R4)。
 *
 * `key` 是规范键(跨源聚合用),`name` 是展示名,`sourceKind` 区分一手价与
 * 挂牌价(词元所/硅基流动是聚合平台,其报价是第三方供应方挂牌,不是厂商定价)。
 *
 * ⚠️ VENDOR_KEY_ALIASES 是**存量行回填的桥**:键与采集器写死的 vendor 字符串
 * 一一对应,采集侧改写 vendor 字符串时必须同步这里,否则新行归不上一家厂商。
 */

/** 厂商种子(零发版维护;worker 启动幂等种入) */
export interface ProviderSeed {
  /** 规范键(唯一) */
  key: string;
  /** 展示名 */
  name: string;
  /** 地域 */
  region: "cn" | "intl";
  /** 来源类型:official=厂商一手定价 | aggregator=聚合/交易平台挂牌报价 */
  sourceKind: "official" | "aggregator";
  /** 厂商入口/牌价页(零发版维护;前台外链用) */
  homepageUrl: string | null;
  /** 前台排序 */
  displayOrder: number;
}

export const PROVIDER_SEEDS: readonly ProviderSeed[] = [
  {
    key: "deepseek",
    name: "DeepSeek 深度求索",
    region: "cn",
    sourceKind: "official",
    homepageUrl: "https://api-docs.deepseek.com/zh-cn/quick_start/pricing",
    displayOrder: 10,
  },
  {
    key: "moonshot",
    name: "月之暗面 Kimi",
    region: "cn",
    sourceKind: "official",
    homepageUrl: "https://platform.moonshot.cn/docs/pricing/chat",
    displayOrder: 20,
  },
  {
    key: "aliyun-bailian",
    name: "阿里云百炼",
    region: "cn",
    sourceKind: "official",
    homepageUrl: "https://help.aliyun.com/zh/model-studio/token-plan-personal-overview",
    displayOrder: 30,
  },
  {
    key: "tencent-cloud",
    name: "腾讯云",
    region: "cn",
    sourceKind: "official",
    homepageUrl: "https://cloud.tencent.com/act/pro/tokenplan",
    displayOrder: 40,
  },
  {
    key: "volcengine-ark",
    name: "火山引擎方舟",
    region: "cn",
    sourceKind: "official",
    homepageUrl: "https://www.volcengine.com/docs/82379/1544106",
    displayOrder: 50,
  },
  {
    key: "siliconflow",
    name: "硅基流动 SiliconFlow",
    region: "cn",
    sourceKind: "aggregator",
    homepageUrl: "https://siliconflow.cn/pricing",
    displayOrder: 60,
  },
  {
    key: "baidu-ciyuansuo",
    name: "百度词元所",
    region: "cn",
    sourceKind: "aggregator",
    homepageUrl: "https://cysuo.com/",
    displayOrder: 70,
  },
  {
    key: "zhipu-bigmodel",
    name: "智谱 AI · BigModel",
    region: "cn",
    sourceKind: "official",
    homepageUrl: "https://bigmodel.cn/glm-coding",
    displayOrder: 80,
  },
  {
    key: "minimax",
    name: "MiniMax 稀宇科技",
    region: "cn",
    sourceKind: "official",
    homepageUrl: "https://www.minimax.cn/m-plan",
    displayOrder: 90,
  },
  {
    key: "xiaomi-mimo",
    name: "小米 MiMo",
    region: "cn",
    sourceKind: "official",
    homepageUrl: "https://platform.xiaomimimo.com/token-plan",
    displayOrder: 100,
  },
] as const;

/**
 * 采集器写死的 vendor 字符串 → 厂商规范键(存量回填的桥)。
 * 与 `src/lib/pricing/source-registry.ts` 的 `def.vendor` 逐字对应;
 * 采集侧改写 vendor 字符串时必须同步这里。
 */
export const VENDOR_KEY_ALIASES: Readonly<Record<string, string>> = {
  "DeepSeek 深度求索": "deepseek",
  "月之暗面 Moonshot": "moonshot",
  "月之暗面 Kimi": "moonshot",
  阿里云百炼: "aliyun-bailian",
  腾讯云: "tencent-cloud",
  "小米 MiMo": "xiaomi-mimo",
  "MiniMax 稀宇科技": "minimax",
  "智谱 AI · BigModel": "zhipu-bigmodel",
  "硅基流动 SiliconFlow": "siliconflow",
};

/** 松散比较用:去空白与标点、小写(「智谱 AI · BigModel」→ 「智谱aibigmodel」) */
function loose(s: string): string {
  return s.toLowerCase().replace(/[\s·・.,，()（）\-_/]/g, "");
}

/**
 * 厂商名(采集器写的 vendor 字符串)→ 规范键;认不出返回 null。
 * 认不出不是错误:存量回填时留 providerId=null 并在报告里点名,由人裁定——
 * 猜错厂商比不归一更糟。
 */
export function providerKeyForVendor(vendor: string): string | null {
  const direct = VENDOR_KEY_ALIASES[vendor];
  if (direct !== undefined) return direct;
  const target = loose(vendor);
  if (target === "") return null;
  for (const seed of PROVIDER_SEEDS) {
    if (loose(seed.name) === target) return seed.key;
  }
  return null;
}
