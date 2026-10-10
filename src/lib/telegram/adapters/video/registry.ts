/**
 * 平台适配器注册表(M24 批④自 ingest-video 平移共享):采集编排与解读
 * 直链重拉(fetchFreshPlayUrl)共用同一张表——放独立模块避免 ingest↔interpret
 * 循环依赖;新平台只加一行。
 */
import type { VideoPlatform } from "../../constants";

import { bilibiliAdapter } from "./bilibili";
import { douyinAdapter } from "./douyin";
import type { VideoAdapter } from "./index";

export const ADAPTERS: Partial<Record<VideoPlatform, VideoAdapter>> = {
  douyin: douyinAdapter,
  bilibili: bilibiliAdapter,
};
