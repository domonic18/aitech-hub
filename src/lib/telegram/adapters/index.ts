/**
 * 采集适配器分发(M7):按 crawl_source.type 路由到具体实现。
 * 未实现的类型显式抛错(而非静默空结果)——来源侧连续失败计数会把它推进
 * error 状态,后台台账可观测。首批渠道均 rss:量子位匿名 feed;
 * 机器之心 token 鉴权 feed(凭证由 source.config 注入,不经环境变量)。
 */
import { CRAWL_SOURCE_TYPE_RSS } from "../constants";

import { fetchRssItems, type AdapterItem } from "./rss";

export { RateLimitedError } from "./rss";
export type { AdapterItem } from "./rss";

export async function fetchSourceItems(
  type: string,
  url: string,
  config?: unknown,
): Promise<AdapterItem[]> {
  if (type === CRAWL_SOURCE_TYPE_RSS) {
    const token = (config as { token?: unknown } | null | undefined)?.token;
    return fetchRssItems(url, typeof token === "string" && token ? { token } : {});
  }
  throw new Error(`采集适配器未实现(type=${type})`);
}
