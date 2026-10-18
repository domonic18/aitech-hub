/**
 * B站热搜 fetcher(M34 批③,真机探 2026-10-18):GET api.bilibili.com/x/
 * web-interface/search/square?limit=50(须 Referer: www.bilibili.com,否则
 * 拒)→ data.trending.list[] 项 {keyword, show_name, heat_score}。refId=
 * keyword(接口去重锚),title=show_name(带活动角标的展示名,缺省回退
 * keyword),heat=heat_score(原始分,口径站内自洽)。
 */
import { z } from "zod";

import { HOTLIST_MAX_ITEMS } from "../constants";

import { BROWSER_UA, getJson } from "./http";
import type { HotFetcher, HotItem } from "./types";
import { HotlistError } from "./types";

const ENDPOINT = "https://api.bilibili.com/x/web-interface/search/square?limit=50";

const bilibiliSchema = z.object({
  data: z
    .object({
      trending: z
        .object({
          list: z
            .array(
              z
                .object({
                  keyword: z.string(),
                  show_name: z.string().optional(),
                  heat_score: z.number().optional(),
                })
                .passthrough(),
            )
            .optional(),
        })
        .passthrough()
        .optional(),
    })
    .passthrough()
    .optional(),
});

/** 纯解析(golden 样本单测锚点) */
export function parseBilibiliHotlist(payload: unknown): HotItem[] {
  const parsed = bilibiliSchema.safeParse(payload);
  if (!parsed.success) throw new HotlistError("bilibili 热搜响应形态偏离契约");
  const items: HotItem[] = [];
  for (const row of parsed.data.data?.trending?.list ?? []) {
    const keyword = row.keyword.trim();
    if (keyword === "") continue;
    const showName = row.show_name?.trim() ?? "";
    items.push({
      refId: keyword,
      title: showName === "" ? keyword : showName,
      rank: items.length + 1,
      heat: row.heat_score,
    });
  }
  return items.slice(0, HOTLIST_MAX_ITEMS);
}

export const bilibiliHotFetcher: HotFetcher = {
  source: "hot-bilibili",
  async fetchItems() {
    return parseBilibiliHotlist(
      await getJson(ENDPOINT, { "User-Agent": BROWSER_UA, Referer: "https://www.bilibili.com/" }),
    );
  },
};
