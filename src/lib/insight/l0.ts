/**
 * L0 准入过滤(M58 批④,data-expansion-plan §7):新社区源(community/*)入池前
 * 的确定性四道闸——过短(<8 字)、纯符号、纯营销/导流、批内归一化重复
 * (sha1)。纯函数,零 IO;只作用于新源,不改既有源行为。
 *
 * 口径:
 * - 长度按 Unicode 字符计(中文一字一计,英文一词多字符——英文标题天然更长);
 * - 剥掉 URL 后再判长度,「https://…」单独成条不算有效需求;
 * - 去重键 = 小写 + 去空白/标点/符号后 sha1(同义不同标点视为重复)。
 * 拦截率/误杀率按抽样人工复核(data-expansion-plan §7 验收)。
 */
import { createHash } from "node:crypto";

export const L0_MIN_TEXT_LEN = 8;

export type L0Reason = "too_short" | "symbol_only" | "marketing" | "duplicate";

export interface L0Rejected<T> {
  item: T;
  reason: L0Reason;
  digest: string;
}

export interface L0ScreenResult<T> {
  accepted: T[];
  rejected: L0Rejected<T>[];
}

/** 纯营销/导流话术(具体句式,避免「联系我」这类真实求助被误杀) */
const MARKETING_PATTERNS: readonly RegExp[] = [
  /加\s*(?:微信|weixin|vx|v信|qq|QQ\s*群)/i,
  /(?:微信|vx|qq|telegram)\s*[:：]/i,
  /(?:扫码|扫一扫|二维码|关注公众号|公众号[:：])/,
  /(?:私信|私聊)我/,
  /(?:进群|加群|入群)/,
  /(?:免费领|领取.{0,6}福利)/,
  /(?:优惠券|返现|刷单|代理加盟)/,
  /(?:月入|日赚)\s*\d/,
  /(?:点击|猛戳).{0,4}(?:链接|领取)/,
];

const URL_PATTERN = /https?:\/\/\S+|www\.\S+/gi;

/** 去重键:小写、剥空白/标点/符号(保留字母数字与 CJK) */
export function normalizeForDedupe(text: string): string {
  return text.toLowerCase().replace(/[\s\p{P}\p{S}]+/gu, "");
}

export function l0Digest(text: string): string {
  return createHash("sha1").update(normalizeForDedupe(text)).digest("hex");
}

function visible(text: string): string {
  return text.trim().replace(URL_PATTERN, " ").trim();
}

function isMarketing(text: string): boolean {
  return MARKETING_PATTERNS.some((re) => re.test(text));
}

/** 批内过滤:逐条判四闸,重复只保留首条(调用方按源内采集顺序稳定)。 */
export function l0Screen<T extends { text: string }>(items: readonly T[]): L0ScreenResult<T> {
  const seen = new Set<string>();
  const accepted: T[] = [];
  const rejected: L0Rejected<T>[] = [];
  for (const item of items) {
    const digest = l0Digest(item.text);
    let reason: L0Reason | null = null;
    if ([...visible(item.text)].length < L0_MIN_TEXT_LEN) reason = "too_short";
    else if (!/[\p{L}\p{N}]/u.test(item.text)) reason = "symbol_only";
    else if (isMarketing(item.text)) reason = "marketing";
    else if (seen.has(digest)) reason = "duplicate";
    if (reason === null) {
      seen.add(digest);
      accepted.push(item);
    } else {
      rejected.push({ item, reason, digest });
    }
  }
  return { accepted, rejected };
}
