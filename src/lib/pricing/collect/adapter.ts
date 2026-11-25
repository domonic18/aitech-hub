/**
 * 采集源 adapter 框架(牌价改造 P2 收尾):定义「接一家新源」的最小接口。
 *
 * 目标:新源接入从 8 步降到 5 步:
 * 1. provider-registry.ts 加一条 PROVIDER_SEEDS(或复用 providerKey)
 * 2. 写一个 collect adapter: fetch + parse → RawRecord[]
 * 3. source-registry.ts 加一条 SOURCE_DEFS(kind/target/周期)
 * 4. fixture HTML + 五项必测
 * 5. 确认采集周期(模型面默认日级)
 *
 * adapter 只负责「取数 + 解析成原始记录」;列语义/单位/基准价/组装由 collect
 * 层其他模块处理,避免每家源重复写归一逻辑。
 */
import type { ModelPrefillRow } from "../crawlers";

import type { RawPricingRecord } from "./assemble";
import { assembleModelPrefillRows, type AssembleOptions } from "./assemble";

/** 一个价格源 adapter 的最小契约 */
export interface PricingSourceAdapter<R extends RawPricingRecord = RawPricingRecord> {
  /** 源 human name(日志/报错用) */
  readonly name: string;
  /** 源 URL(溯源与墓碑口径) */
  readonly sourceUrl: string;
  /** 展示厂商名(写 vendor 字段) */
  readonly vendor: string;
  /** 币种 */
  readonly currency: "CNY" | "USD";
  /** 地域 */
  readonly region: "cn" | "intl";
  /** 已归一的计价单位 */
  readonly unit: string;
  /** 厂商规范键(写 providerKey) */
  readonly providerKey?: string;
  /** 模态显式标注 */
  readonly modality?: string | null;
  /** 行价基准策略 */
  readonly baseStrategy?: "token" | "resolution";

  /** 取回原始页面/HTML/JSON;失败直接抛错,由编排层捕获 */
  fetch(): Promise<R[]> | R[];
}

/** 需要自定义 parse → RawPricingRecord 的源(如 HTML 需先 cheerio 解析) */
export interface PricingHtmlAdapter<
  R extends RawPricingRecord = RawPricingRecord,
> extends PricingSourceAdapter<R> {
  fetchHtml(): Promise<string> | string;
  parseHtml(html: string): R[];
}

function isHtmlAdapter<R extends RawPricingRecord>(
  a: PricingSourceAdapter<R>,
): a is PricingHtmlAdapter<R> {
  return "fetchHtml" in a && "parseHtml" in a;
}

/** 运行 adapter,得到可直接落库的 ModelPrefillRow[] */
export async function runAdapter<R extends RawPricingRecord = RawPricingRecord>(
  adapter: PricingSourceAdapter<R>,
  now?: Date,
): Promise<ModelPrefillRow[]> {
  const records = isHtmlAdapter(adapter)
    ? adapter.parseHtml(await adapter.fetchHtml())
    : await adapter.fetch();
  const assembleOpts: AssembleOptions = {
    vendor: adapter.vendor,
    currency: adapter.currency,
    sourceUrl: adapter.sourceUrl,
    region: adapter.region,
    unit: adapter.unit,
    dataAsOf: now ?? new Date(),
    providerKey: adapter.providerKey,
    modality: adapter.modality,
    baseStrategy: adapter.baseStrategy,
  };
  return assembleModelPrefillRows(records, assembleOpts);
}

/** 把原始记录直接当 RawPricingRecord 用的便捷 runner */
export async function runRawAdapter(
  adapter: PricingSourceAdapter<RawPricingRecord>,
  now?: Date,
): Promise<ModelPrefillRow[]> {
  return runAdapter(adapter, now);
}
