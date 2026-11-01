/**
 * 公众号答案的纯函数层(M66):模型输出契约解析 + 出站文本组装。
 * 从 answer.ts 拆出的理由与 reply.ts 同:这两个函数没有 IO,却决定
 * 「答案准不准、会不会超 2048 字节被微信静默吞掉」,必须能脱离
 * prisma/redis/队列单测。
 */
import type { ParsedTask } from "@/lib/ai/chat-json-task";
import { env } from "@/lib/env";

import { WECHAT_MP_MAX_CITATIONS, WECHAT_MP_REPLY_MAX_BYTES } from "./constants";

/** 超限截断提示 */
export const WECHAT_MP_TRUNCATE_SUFFIX = "\n…(完整内容见站内文章)";

export interface AnswerPayload {
  canAnswer: boolean;
  answer: string;
  citeIds: number[];
}

/** 契约解析:容忍 ```json 围栏与前后废话,只取首个 `{` 到末个 `}` */
export function parseAnswerPayload(raw: string): ParsedTask<AnswerPayload> {
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start < 0 || end <= start) return { ok: false, error: "输出不是 JSON 对象" };
  let obj: unknown;
  try {
    obj = JSON.parse(raw.slice(start, end + 1));
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "JSON 解析失败" };
  }
  if (typeof obj !== "object" || obj === null) return { ok: false, error: "输出不是对象" };
  const o = obj as Record<string, unknown>;
  if (typeof o.canAnswer !== "boolean") return { ok: false, error: "缺 canAnswer 布尔字段" };
  if (typeof o.answer !== "string") return { ok: false, error: "缺 answer 字符串字段" };
  const ids = Array.isArray(o.citeIds) ? o.citeIds : [];
  const citeIds = ids
    .filter((n): n is number => typeof n === "number" && Number.isInteger(n) && n > 0)
    .slice(0, 8);
  return { ok: true, data: { canAnswer: o.canAnswer, answer: o.answer.trim(), citeIds } };
}

function absoluteUrl(href: string): string {
  return /^https?:\/\//i.test(href) ? href : new URL(href, env.NEXT_PUBLIC_SITE_URL).toString();
}

/** 组装出站文本:先保结论,超限按「砍引用 → 截正文」顺序让位 */
export function composeReplyText(
  answer: string,
  cites: ReadonlyArray<{ title: string; href: string }>,
): { text: string; truncated: boolean } {
  const budget = WECHAT_MP_REPLY_MAX_BYTES;
  const tail = (picked: ReadonlyArray<{ title: string; href: string }>): string =>
    picked.length === 0
      ? ""
      : `\n\n参考:\n${picked.map((c) => `《${c.title}》\n${absoluteUrl(c.href)}`).join("\n")}`;

  const counts = [Math.min(cites.length, WECHAT_MP_MAX_CITATIONS), 1, 0];
  for (const n of counts) {
    if (n > cites.length) continue;
    const text = `${answer}${tail(cites.slice(0, n))}`;
    if (Buffer.byteLength(text, "utf8") <= budget) return { text, truncated: false };
  }

  const room = budget - Buffer.byteLength(WECHAT_MP_TRUNCATE_SUFFIX, "utf8");
  let cut = "";
  let bytes = 0;
  for (const ch of answer) {
    const b = Buffer.byteLength(ch, "utf8");
    if (bytes + b > room) break;
    cut += ch;
    bytes += b;
  }
  return { text: `${cut}${WECHAT_MP_TRUNCATE_SUFFIX}`, truncated: true };
}
