/**
 * 热榜拉取插件契约(M34 批③ 渠道拓宽,方案 §3):HotFetcher 每源一个,产出
 * 归一 HotItem 列表(run 层负责入池)。新增渠道=实现接口+注册表登记,入池闸门
 * (INSIGHT_SOURCES_ENABLED)与 kind/medium 映射见 ingest/constants。
 * 契约红线:各源解析器只按真机探得的响应形态写(2026-10-18 探针样本,见各
 * 文件注),形状偏离抛 HotlistParseError 单源失败,不拖垮整轮。
 */
import type { InsightSource } from "../ingest";

/** 归一后的榜单条目(rank 1 起;heat/url 缺省可无,meta 透传入池) */
export interface HotItem {
  /** 稳定业务标识(去重锚:(source, refId) 唯一;如百度=词、知乎=问题 id) */
  refId: string;
  /** 展示与聚类文本(榜单词/问题标题) */
  title: string;
  rank: number;
  url?: string;
  /** 原生热度值(各平台口径不一,只作展示排序参考,不跨源可比) */
  heat?: number;
}

export interface HotFetcher {
  /** 对应 insight 源标识(hot-*) */
  source: InsightSource;
  fetchItems(): Promise<HotItem[]>;
}

/** 响应形态偏离真机探契约 / 上游非 2xx / 非 JSON(单源失败隔离用) */
export class HotlistError extends Error {}
