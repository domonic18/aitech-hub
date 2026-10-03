/**
 * 采集适配器分发(M7):按 crawl_source.type 路由到具体实现。
 * 未实现的类型显式抛错(而非静默空结果)——来源侧连续失败计数会把它推进
 * error 状态,后台台账可观测;首批只交付 rss(量子位),机器之心 api 待
 * 官方端点细节补齐后接入。
 */
import { CRAWL_SOURCE_TYPE_RSS } from "../constants";

import { fetchRssItems, type AdapterItem } from "./rss";

export type { AdapterItem } from "./rss";

export async function fetchSourceItems(type: string, url: string): Promise<AdapterItem[]> {
  if (type === CRAWL_SOURCE_TYPE_RSS) return fetchRssItems(url);
  throw new Error(`采集适配器未实现(type=${type})`);
}
