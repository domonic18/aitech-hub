/**
 * 热榜源注册表(M34 批③):编排层只认本表,新增渠道=新 fetcher 文件+此处
 * 登记一行 + 源属性登记 insight/source-registry.ts 单表(闸门/kind/medium/
 * label,2026-10-29 P2-24 收口——此前散在 ingest/constants 两处,「一处登记」
 * 自本行起为真实)。顺序即入池顺序(互不相干,仅日志可读性);源内失败由 run 层隔离。
 */
import { bilibiliHotFetcher } from "./bilibili";
import { baiduHotFetcher } from "./baidu";
import { zhihuHotFetcher } from "./zhihu";
import type { HotFetcher } from "./types";

export const HOT_FETCHERS: readonly HotFetcher[] = [
  baiduHotFetcher,
  zhihuHotFetcher,
  bilibiliHotFetcher,
];
