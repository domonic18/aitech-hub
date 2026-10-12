/**
 * B站接口响应契约(M25;形态以原型 workspace/tmp/bili-discover.mjs 实证为准):
 * search/type 列表与 card 资料卡的 Zod 解析 + em 高亮清洗。
 * 容错分层:envelope 不符整页抛错(风控/不可达上层分流);列表条目逐条容错,
 * 坏条目丢弃计数,不弃整页。
 */
import { z } from "zod";

import { BiliApiUpstreamError, BiliRiskControlError } from "./errors";

/** 搜索结果条目(只取所需字段;缺失关键字段视为坏条目整条丢弃) */
export interface SearchItem {
  bvid: string;
  mid: number;
  author: string;
  title: string;
  play: number;
}

const searchItemSchema = z.object({
  bvid: z.string().min(1),
  mid: z.coerce.number().int().positive(),
  author: z.string(),
  title: z.string(),
  play: z.coerce.number().min(0),
});

export interface ParsedSearchPage {
  items: SearchItem[];
  /** 契约不符被丢弃的条数(观测) */
  dropped: number;
}

/** 业务码风控判定:-412 请求过频 / -352 风控拦截(数据中心出口实证) */
export function isRiskCode(code: number): boolean {
  return code === -412 || code === -352;
}

/**
 * envelope 前置判定(code≠0 收口在此):风控码抛 RiskControl(调用方退避重试),
 * 其余非零/形态不符抛 Upstream(按词失败留痕)。调用方在 parse* 之前先过此关。
 */
export function expectEnvelopeOk(payload: unknown): void {
  const env = z.object({ code: z.number(), message: z.string().optional() }).safeParse(payload);
  if (!env.success) {
    throw new BiliApiUpstreamError("响应 envelope 不符合契约");
  }
  if (isRiskCode(env.data.code)) {
    throw new BiliRiskControlError(`业务码 ${env.data.code}`, env.data.code);
  }
  if (env.data.code !== 0) {
    const msg = `业务码 ${env.data.code}${env.data.message ? ` ${env.data.message}` : ""}`;
    throw new BiliApiUpstreamError(msg);
  }
}

const searchDataSchema = z.object({
  data: z
    .object({ result: z.array(z.unknown()).optional() })
    .passthrough()
    .optional(),
});

/** B站搜索高亮等 HTML 标签清洗(实证 title/author 夹带 <em class="keyword">) */
export function stripBiliTags(raw: string): string {
  return raw.replace(/<[^>]*>/g, "").trim();
}

export function parseSearchPage(payload: unknown): ParsedSearchPage {
  const parsed = searchDataSchema.safeParse(payload);
  if (!parsed.success) {
    throw new BiliApiUpstreamError("search 响应 data 不符合契约");
  }
  const items: SearchItem[] = [];
  let dropped = 0;
  for (const raw of parsed.data.data?.result ?? []) {
    const item = searchItemSchema.safeParse(raw);
    if (!item.success) {
      dropped += 1;
      continue;
    }
    items.push({
      bvid: item.data.bvid,
      mid: item.data.mid,
      author: stripBiliTags(item.data.author),
      title: stripBiliTags(item.data.title),
      play: item.data.play,
    });
  }
  return { items, dropped };
}

/** 资料卡(code=0 后 data.card.name/fans/archive_count;实证形态) */
export interface CardInfo {
  name: string;
  fans: number;
  archives: number;
}

const cardSchema = z.object({
  data: z
    .object({
      card: z.object({
        name: z.string(),
        fans: z.coerce.number().min(0),
        archive_count: z.coerce.number().min(0),
      }),
    })
    .passthrough(),
});

export function parseCard(payload: unknown): CardInfo {
  const parsed = cardSchema.safeParse(payload);
  if (!parsed.success) {
    throw new BiliApiUpstreamError("card 响应不符合契约");
  }
  return {
    name: stripBiliTags(parsed.data.data.card.name),
    fans: parsed.data.data.card.fans,
    archives: parsed.data.data.card.archive_count,
  };
}
