/**
 * 电报流归一纯函数(M7):URL 规范化、content_hash、HTML 剥离与规则截断摘要。
 * hash 是全库去重锚(telegram.content_hash unique),规则变更只影响新条目。
 */
import { createHash } from "node:crypto";

/** 摘要截断上限(1-3 句量级,arch/02 §2 summary VarChar(1000) 内) */
export const TELEGRAM_SUMMARY_MAX = 160;

const TRACKING_PARAMS = new Set([
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "utm_content",
  "utm_term",
  "spm",
  "from",
  "share_token",
]);

/** URL 规范化:去 tracking 参数、host 小写、去尾斜杠(根路径除外);非法输入原样返回 */
export function canonicalUrl(raw: string): string {
  const trimmed = raw.trim();
  let u: URL;
  try {
    u = new URL(trimmed);
  } catch {
    return trimmed;
  }
  u.hostname = u.hostname.toLowerCase();
  for (const key of [...u.searchParams.keys()]) {
    if (TRACKING_PARAMS.has(key.toLowerCase())) u.searchParams.delete(key);
  }
  const path =
    u.pathname.length > 1 && u.pathname.endsWith("/") ? u.pathname.slice(0, -1) : u.pathname;
  return `${u.protocol}//${u.host}${path}${u.search}${u.hash}`;
}

/** 去重锚:sha1(标题小写 + 规范化 URL);40 位与 @db.Char(40) 对齐 */
export function contentHash(title: string, url: string): string {
  return createHash("sha1")
    .update(`${title.trim().toLowerCase()}\n${canonicalUrl(url)}`)
    .digest("hex");
}

const ENTITIES: Record<string, string> = {
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&#39;": "'",
  "&apos;": "'",
  "&nbsp;": " ",
};

/**
 * HTML 实体解码(2026-10-09 验收反馈问题3):feed 双重转义(fast-xml-parser
 * 解一层后标题仍残留 &#8217; 等数字实体)→ 入库前归一。命名实体取常用集,
 * 数字(&#nnn;)/十六进制(&#xhhh;)全收;替换链式递进,「&amp;#8217;」这类
 * 二次编码随之落到意图字符(’),正文里合法的「&amp;」文本不受影响。
 */
export function decodeHtmlEntities(text: string): string {
  if (!text.includes("&")) return text;
  return text
    .replace(/&(amp|lt|gt|quot|apos|nbsp);/g, (m) => ENTITIES[m] ?? m)
    .replace(/&#x?([0-9a-fA-F]+);/gi, (m, h: string) => {
      // 数字(缺省十进制)/十六进制码点;越界码点(非法实体)原样保留
      const n = /^&#x/i.test(m) ? Number.parseInt(h, 16) : Number(h);
      return n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : m;
    });
}

/** HTML 剥离 + 实体解码 + 空白折叠(摘要候选清洗) */
export function stripHtml(html: string): string {
  return html
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&(amp|lt|gt|quot|#39|apos|nbsp);/g, (m) => ENTITIES[m] ?? m)
    .replace(/\s+/g, " ")
    .trim();
}

/** 规则截断(LLM 摘要前的一期口径):优先在句末标点断句,超长硬切加省略号 */
export function truncateSummary(text: string, max = TELEGRAM_SUMMARY_MAX): string {
  const clean = stripHtml(text);
  if (clean.length <= max) return clean;
  const window = clean.slice(0, max);
  const m = window.match(/^(.*[。!?;；])[^.!?;；]*$/);
  const cut = m ? m[1] : `${window.slice(0, max - 1).trimEnd()}…`;
  return cut.trim();
}

/** 编码异常启发:替换符/控制字符占比 >5% 视为乱码(arch/02 §3.1 过滤维度之一) */
export function looksGarbled(text: string): boolean {
  if (text.length === 0) return false;
  let bad = 0;
  for (const ch of text) {
    const code = ch.codePointAt(0) ?? 0;
    if (ch === "�" || (code < 32 && ch !== "\n" && ch !== "\t")) bad += 1;
  }
  return bad / [...text].length > 0.05;
}
