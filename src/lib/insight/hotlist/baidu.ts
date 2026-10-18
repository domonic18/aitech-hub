/**
 * 百度热搜 fetcher(M34 批③,真机探 2026-10-18):GET top.baidu.com/api/board
 * ?platform=wise&tab=realtime → data.cards[].content[] 两层嵌套,叶子 content[]
 * 项形如 {word, index, url, isTop, hotTag…}(hotScore 字段实测无,热度只在
 * hotTag 文案里,不入 meta)。isTop=true 为置顶运营位非自然榜,剔除;rank 按
 * 过滤后数组序 1 起。refId=word,rawText=word。
 */
import { z } from "zod";

import { HOTLIST_MAX_ITEMS } from "../constants";

import { BROWSER_UA, getJson } from "./http";
import type { HotFetcher, HotItem } from "./types";
import { HotlistError } from "./types";

const ENDPOINT = "https://top.baidu.com/api/board?platform=wise&tab=realtime";

const baiduItemSchema = z
  .object({
    word: z.string(),
    /** index 仅自然条目携带(置顶运营位只有 isTop/url/word,反正会被剔) */
    index: z.union([z.number(), z.string()]).optional(),
    url: z.string().optional(),
    isTop: z.boolean().optional(),
  })
  .passthrough();

const baiduSchema = z.object({
  data: z
    .object({
      cards: z.array(
        z
          .object({
            content: z
              .array(
                z
                  .object({ content: z.array(baiduItemSchema).optional() })
                  .passthrough()
                  .optional(),
              )
              .optional(),
          })
          .passthrough(),
      ),
    })
    .passthrough()
    .optional(),
});

/** 纯解析(golden 样本单测锚点):两层 content 嵌套摊平,剔置顶,refId 去空 */
export function parseBaiduHotlist(payload: unknown): HotItem[] {
  const parsed = baiduSchema.safeParse(payload);
  if (!parsed.success) throw new HotlistError("baidu 热搜响应形态偏离契约");
  const items: HotItem[] = [];
  for (const card of parsed.data.data?.cards ?? []) {
    for (const group of card.content ?? []) {
      for (const it of group?.content ?? []) {
        if (it.isTop === true) continue; // 置顶运营位,非自然热度
        const word = it.word.trim();
        if (word === "") continue;
        items.push({
          refId: word,
          title: word,
          rank: items.length + 1,
          url: it.url === undefined ? undefined : it.url.trim(),
        });
      }
    }
  }
  return items.slice(0, HOTLIST_MAX_ITEMS);
}

export const baiduHotFetcher: HotFetcher = {
  source: "hot-baidu",
  async fetchItems() {
    return parseBaiduHotlist(
      await getJson(ENDPOINT, { "User-Agent": BROWSER_UA, Referer: "https://top.baidu.com/board" }),
    );
  },
};
