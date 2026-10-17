/**
 * /render 请求体校验 + file:// 媒体卷白名单(纯函数,node:test 覆盖,零 playwright 依赖)。
 * 契约:POST /render {html, width?, scale?, maxHeight?, timeoutMs?}
 * 上限依据:html 含 data-URI 内嵌图(≤8 张 × ~375KB 二进制 ≈ 4MB base64),
 * 原始体再由 http 层钉 6MB;宽 320..1600 覆盖公众号 1080 与常规卡片;
 * maxHeight 防 Agent 产出超长图(超限应拆卡,不静默放行)。
 */
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * file:// 请求是否落在媒体卷内(index.js 请求硬闸的放行条件之二)。
 * fileURLToPath 会解码 %2e%2e 等编码字符,resolve 归一后再做路径包含校验,
 * `file://$root/../etc/passwd` 这类遍历一律拒绝;root 为空 = 功能关闭全拒。
 */
export function isInsideMediaRoot(mediaRoot, url) {
  if (!mediaRoot || !url.startsWith("file://")) return false;
  try {
    const p = path.resolve(fileURLToPath(url));
    const root = path.resolve(mediaRoot);
    return p === root || p.startsWith(root + path.sep);
  } catch {
    return false; // fileURLToPath 对畸形 URL 抛错 → 视为不放行
  }
}

export const HTML_MAX_CHARS = 400_000;
export const WIDTH_MIN = 320;
export const WIDTH_MAX = 1600;
export const SCALE_MIN = 1;
export const SCALE_MAX = 3;
export const MAX_HEIGHT_MIN = 400;
export const MAX_HEIGHT_MAX = 8000;
export const TIMEOUT_MIN_MS = 3000;
export const TIMEOUT_MAX_MS = 20_000;

const DEFAULTS = { width: 900, scale: 2, maxHeight: 4000, timeoutMs: 12_000 };

function intInRange(v, min, max, label, errors) {
  if (v === undefined) return undefined;
  if (!Number.isInteger(v) || v < min || v > max) {
    errors.push(`${label} 必须是 ${min}-${max} 的整数`);
    return undefined;
  }
  return v;
}

/**
 * @param {unknown} body 已 JSON.parse 的请求体
 * @returns {{ ok: true, value: {html: string, width: number, scale: number, maxHeight: number, timeoutMs: number } }
 *          | { ok: false, error: string, status: number }}
 */
export function parseRenderBody(body) {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return { ok: false, error: "请求体必须是 JSON 对象", status: 400 };
  }
  const errors = [];
  const html = typeof body.html === "string" ? body.html : "";
  if (!html.trim()) errors.push("html 不能为空");
  if (html.length > HTML_MAX_CHARS) {
    errors.push(`html 超过 ${HTML_MAX_CHARS} 字符上限(含 data-URI 内嵌图;请压缩或减少内嵌图)`);
  }
  const width = intInRange(body.width, WIDTH_MIN, WIDTH_MAX, "width", errors) ?? DEFAULTS.width;
  const scale = intInRange(body.scale, SCALE_MIN, SCALE_MAX, "scale", errors) ?? DEFAULTS.scale;
  const maxHeight =
    intInRange(body.maxHeight, MAX_HEIGHT_MIN, MAX_HEIGHT_MAX, "maxHeight", errors) ??
    DEFAULTS.maxHeight;
  const timeoutMs =
    intInRange(body.timeoutMs, TIMEOUT_MIN_MS, TIMEOUT_MAX_MS, "timeoutMs", errors) ??
    DEFAULTS.timeoutMs;
  if (errors.length > 0) return { ok: false, error: errors.join(";"), status: 400 };
  return { ok: true, value: { html, width, scale, maxHeight, timeoutMs } };
}

/** 原始请求体字节上限(http 层用;超限 413) */
export const RAW_BODY_MAX_BYTES = 6 * 1024 * 1024;
