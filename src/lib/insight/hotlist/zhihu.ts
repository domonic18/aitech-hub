/**
 * 知乎热榜 fetcher(M34 批③,真机探 2026-10-18):GET api.zhihu.com/topstory/
 * hot-list?limit=50 → data[] 项 {target:{id,title,url}, detail_text}。热度只在
 * detail_text 文案(如「543 万热度」),正则提取万位折算;提不出则缺省(入池
 * 不受阻)。target.url 为 api.zhihu.com/questions/<id> 形态,改写为前台
 * www.zhihu.com/question/<id> 供运营跳转。refId=target.id(稳定问题锚,次日
 * 在榜走 refreshMeta 刷新位次/热度)。
 */
import { z } from "zod";

import { HOTLIST_MAX_ITEMS } from "../constants";

import { BROWSER_UA, getJson } from "./http";
import type { HotFetcher, HotItem } from "./types";
import { HotlistError } from "./types";

const ENDPOINT = "https://api.zhihu.com/topstory/hot-list?limit=50";

const zhihuSchema = z.object({
  data: z
    .array(
      z
        .object({
          target: z
            .object({ id: z.union([z.number(), z.string()]), title: z.string(), url: z.string() })
            .passthrough(),
          detail_text: z.string().optional(),
        })
        .passthrough(),
    )
    .optional(),
});

/** detail_text「543 万热度」→ 5_430_000;非该形态返 undefined */
function extractHeat(detailText: string | undefined): number | undefined {
  if (detailText === undefined) return undefined;
  const m = /([\d.]+)\s*万/.exec(detailText);
  if (m === null) return undefined;
  const v = Number.parseFloat(m[1] ?? "");
  return Number.isFinite(v) ? Math.round(v * 10_000) : undefined;
}

/** api.zhihu.com/questions/<id> → www.zhihu.com/question/<id>(热榜目标恒为问题;
 * 其余形态原样保留,不猜前台路由) */
function toWebUrl(apiUrl: string): string {
  return apiUrl.replace(
    /^(https?:\/\/)api\.zhihu\.com\/questions\/(\d+)$/,
    "$1www.zhihu.com/question/$2",
  );
}

/** 纯解析(golden 样本单测锚点) */
export function parseZhihuHotlist(payload: unknown): HotItem[] {
  const parsed = zhihuSchema.safeParse(payload);
  if (!parsed.success) throw new HotlistError("zhihu 热榜响应形态偏离契约");
  const items: HotItem[] = [];
  for (const row of parsed.data.data ?? []) {
    const title = row.target.title.trim();
    if (title === "") continue;
    items.push({
      refId: String(row.target.id),
      title,
      rank: items.length + 1,
      url: toWebUrl(row.target.url),
      heat: extractHeat(row.detail_text),
    });
  }
  return items.slice(0, HOTLIST_MAX_ITEMS);
}

export const zhihuHotFetcher: HotFetcher = {
  source: "hot-zhihu",
  async fetchItems() {
    return parseZhihuHotlist(await getJson(ENDPOINT, { "User-Agent": BROWSER_UA }));
  },
};
