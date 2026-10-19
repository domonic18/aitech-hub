/**
 * 自由 HTML 消毒(M31 批B 建;2026-10-18 宽容化修订):双模里的自由模入服务前
 * 唯一闸。安全红线不变——危险标签/事件属性/js URL/外链资源整体报错(agent 自纠);
 * 渲染宽容化:文档结构标签(html/head/body/meta/title/doctype)静默摘除不算违规
 * (写整份文档也能渲染),其余无害未知标签解包保文本;属性白名单放宽 id 与表格
 * colspan/rowspan。输出壳为深空基线(#0b1220 底 + 浅字 + Noto CJK)——模型没写
 * 样式也落全站统一深空;模型自带 body 样式时后置生效可整体覆盖(任意合法
 * HTML 都能按其本意渲染)。service 侧另有请求级硬闸兜底(纵深双层)。
 */
import * as cheerio from "cheerio";

import { FONT_STACK } from "./templates/shell";

export const CARD_HTML_MAX_CHARS = 400_000; // 与服务侧 HTML_MAX_CHARS 对齐
const IMG_MAX_COUNT = 8;
const DATA_URI_MAX_CHARS = 600_000; // ~440KB 二进制;自由模 zod 12k 硬顶下实际到不了

/** 允许保留的标签;img 走专属 src 校验,style 走内容滤洗 */
const ALLOWED_TAGS = new Set([
  "div",
  "section",
  "main",
  "article",
  "header",
  "footer",
  "aside",
  "span",
  "p",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "ul",
  "ol",
  "li",
  "blockquote",
  "table",
  "thead",
  "tbody",
  "tfoot",
  "tr",
  "th",
  "td",
  "caption",
  "figure",
  "figcaption",
  "br",
  "hr",
  "strong",
  "b",
  "em",
  "i",
  "u",
  "s",
  "del",
  "ins",
  "code",
  "pre",
  "small",
  "sub",
  "sup",
  "mark",
  "img",
  "style",
]);

/** 文档结构标签:静默摘除不算违规(meta/title 连内容丢,html/head/body 解包保
 *  内容,doctype 摘除)——模型写整份文档不再撞禁用标签整体报错 */
const STRUCT_REMOVE = new Set(["meta", "title"]);
const STRUCT_UNWRAP = new Set(["html", "head", "body"]);

/** 危险标签:整体移除(含子树);其余不在白名单的标签解包保文本 */
const DROP_TAGS = new Set([
  "script",
  "iframe",
  "object",
  "embed",
  "link",
  "base",
  "form",
  "input",
  "button",
  "textarea",
  "select",
  "option",
  "svg",
  "math",
  "audio",
  "video",
  "source",
  "track",
  "canvas",
  "noscript",
]);

/** img src 白名单:data-URI 与站内媒体路径(无 ..、无反斜杠、无编码字符) */
const IMG_SRC_SITE = /^\/wp-content\/uploads\/[A-Za-z0-9/._-]+$/;
const IMG_SRC_DATA = /^data:image\/(?:png|jpe?g|webp|gif);base64,[A-Za-z0-9+/=]+$/;
/** CSS 外联 url():除 data: 与站内路径外全部命中(粗粒度即可,服务侧硬闸兜底) */
const CSS_EXTERNAL_URL = /url\(\s*['"]?(?!data:|\/wp-content\/uploads\/)[^)'"\s]*['"]?\s*\)/gi;

export type SanitizeResult = { ok: true; html: string } | { ok: false; error: string };

/** domhandler Element 的结构化子集(不引 cheerio 内部命名空间类型) */
type DomEl = { tagName?: string; attribs?: Record<string, string> };

export function sanitizeCardHtml(input: string): SanitizeResult {
  if (input.length > CARD_HTML_MAX_CHARS) {
    return { ok: false, error: `HTML 超过 ${CARD_HTML_MAX_CHARS} 字符上限` };
  }
  const violations: string[] = [];
  const $ = cheerio.load(input, null, false); // fragment 模式;输出经 $.html() 还原

  // 注释节点全摘(信息面收敛;根级注释由 serialize 时自然丢弃,这里摘子树内);
  // doctype 指令一并摘(输出壳自带)
  $("*")
    .contents()
    .filter((_i, n) => n.type === "comment" || n.type === "directive")
    .remove();
  $.root()
    .contents()
    .filter((_i, n) => n.type === "comment" || n.type === "directive")
    .remove();

  // 第一遍:标签定性 + 违规收集(只报不改,整体失败让 agent 自纠)
  let imgCount = 0;
  $("*").each((_i, node) => {
    const tag = (node as DomEl).tagName?.toLowerCase();
    const el = $(node);
    if (!tag) return;
    if (STRUCT_REMOVE.has(tag)) {
      el.remove();
      return;
    }
    if (STRUCT_UNWRAP.has(tag)) {
      el.replaceWith(el.contents()); // 文档壳标签解包保内容,不算违规
      return;
    }
    if (DROP_TAGS.has(tag)) {
      violations.push(`禁用标签 <${tag}>(整体移除)`);
      return;
    }
    if (!ALLOWED_TAGS.has(tag)) {
      el.replaceWith(el.contents()); // 无害未知标签解包保文本,不算违规
      return;
    }
    if (tag === "style") {
      const css = el.text();
      if (/@import/i.test(css)) violations.push("<style> 内禁止 @import");
      const blocked = css.match(CSS_EXTERNAL_URL);
      if (blocked) {
        violations.push(`<style> 内 url() 仅允许 data: 与站内路径(命中 ${blocked.length} 处外联)`);
      }
      return;
    }
    if (tag === "img") {
      imgCount += 1;
      const src = (el.attr("src") ?? "").trim();
      const okShape = IMG_SRC_DATA.test(src) || IMG_SRC_SITE.test(src);
      if (!okShape) {
        violations.push("img src 仅允许 data:image/* 与 /wp-content/uploads/ 站内路径");
      } else if (src.startsWith("/") && src.includes("..")) {
        violations.push("img src 站内路径禁止 ..(路径遍历)");
      } else if (src.startsWith("data:") && src.length > DATA_URI_MAX_CHARS) {
        violations.push("单张 data-URI 图片超过约 440KB 上限");
      }
      return;
    }
    for (const [name, value] of Object.entries((node as DomEl).attribs ?? {})) {
      if (/^on/i.test(name)) violations.push(`禁用事件属性 ${name}`);
      else if (/javascript:/i.test(value ?? "")) violations.push(`属性 ${name} 含 javascript: URL`);
    }
  });
  if (imgCount > IMG_MAX_COUNT) violations.push(`img 超过 ${IMG_MAX_COUNT} 张上限`);

  if (violations.length > 0) {
    const uniq = [...new Set(violations)].slice(0, 5);
    const more = violations.length > 5 ? `;…等共 ${violations.length} 处` : "";
    return { ok: false, error: `HTML 消毒未通过(请修正后重新调用):${uniq.join(";")}${more}` };
  }

  // 第二遍:统一裁属性 + <style> 内容滤洗(能走到这里说明已无违规)。
  // 属性白名单:class/style(+id 锚点;th/td 另留 colspan/rowspan 表格语义;
  // img 另留 src/alt/宽高)——均无脚本面。
  $("*").each((_i, node) => {
    const raw = node as DomEl;
    if (!raw.tagName || !raw.attribs) return;
    const el = $(node);
    const tag = raw.tagName.toLowerCase();
    const keep = new Set(
      tag === "img"
        ? ["class", "style", "src", "alt", "width", "height"]
        : tag === "th" || tag === "td"
          ? ["class", "style", "id", "colspan", "rowspan"]
          : ["class", "style", "id"],
    );
    for (const name of Object.keys(raw.attribs)) {
      if (!keep.has(name)) el.removeAttr(name);
    }
    if (tag === "style") {
      el.text(
        el
          .text()
          .replace(/@import[^;]+;?/gi, "")
          .replace(CSS_EXTERNAL_URL, "none"),
      );
    }
  });

  // 深空基线壳:没写样式的片段也落全站统一深空;模型自带 <style> 在文档序上
  // 后置,同名规则可整体覆盖基线(白底等自定义照常生效)。
  return {
    ok: true,
    html:
      `<!DOCTYPE html><html><head><meta charset="utf-8"><style>` +
      `html,body{margin:0;padding:0;min-height:600px;background:#0b1220;` +
      `color:#f1f5f9;font-family:${FONT_STACK};line-height:1.6}` +
      `</style></head><body>${$.html()}</body></html>`,
  };
}
