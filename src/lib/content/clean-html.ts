/**
 * WP 正文 HTML 清洗(标签/属性白名单规则的唯一实现,单测钉死)。
 *
 * 迁移脚本(scripts/migrate-wp)与运行时(后台粘贴 HTML, M5)共用,
 * 保证"迁移后的旧文"与"新贴的富文本"走同一套净化口径:
 * 标签/属性白名单、Gutenberg 注释清理、iframe 域白名单、内链相对化。
 * 单测:src/lib/content/clean-html.test.ts(真实 WP 内容切片 fixtures)。
 */
import * as cheerio from "cheerio";
import type { Comment, Element, ParentNode } from "domhandler";

/** 旧站域名(内链/媒体相对化);dev 是 wp_options siteurl 的实际值 */
export const WP_ORIGINS = ["17aitech.com", "www.17aitech.com", "dev.17aitech.com"] as const;

/** 保留播放器的 iframe 域白名单(03 §4;其余 iframe 删除并记报告) */
const IFRAME_SRC_ALLOW = /^https?:\/\/(player\.bilibili\.com|www\.youtube\.com)\//;

/** 标签白名单(03 §4;b/i/s/strike 先语义改名再入白名单;iframe 仅域白名单内保留) */
const ALLOWED_TAGS = new Set([
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "p",
  "a",
  "img",
  "ul",
  "ol",
  "li",
  "blockquote",
  "pre",
  "code",
  "table",
  "thead",
  "tbody",
  "tr",
  "th",
  "td",
  "figure",
  "figcaption",
  "strong",
  "em",
  "del",
  "hr",
  "br",
  "span",
  "iframe",
]);

/** b/i/s/strike → 语义等价标签(保留加粗/斜体/删除线,避免剥壳丢语义) */
const TAG_RENAME: Record<string, string> = {
  b: "strong",
  i: "em",
  s: "del",
  strike: "del",
};

/** 属性白名单;未列出的标签剥离全部属性 */
const ALLOWED_ATTRS: Record<string, ReadonlySet<string>> = {
  a: new Set(["href", "title"]),
  img: new Set(["src", "alt", "width", "height"]),
  code: new Set(["class"]),
  span: new Set(["style"]),
  iframe: new Set(["src", "width", "height", "allowfullscreen", "scrolling"]),
  // 结构保真:跨行/跨列表格不保留会错位(纯布局属性,无安全面)
  th: new Set(["colspan", "rowspan"]),
  td: new Set(["colspan", "rowspan"]),
};

const CODE_CLASS_RE = /^language-[\w-]+$/;

/** span.style 只保留文字对齐/加粗类声明(03 §4) */
const SPAN_STYLE_ALLOW = /(^\s*)(text-align|font-weight)\s*:/;

export interface CleanHtmlReport {
  gutenbergCommentsRemoved: number;
  otherCommentsRemoved: number;
  moreMarkerKept: boolean;
  scriptsRemoved: number;
  stylesRemoved: number;
  iframesRemoved: Array<{ src: string; approxBytes: number }>;
  iframesKept: number;
  shortcodesConverted: string[];
  shortcodesRemoved: Array<{ code: string; innerLength: number }>;
  tagsRenamed: Record<string, number>;
  tagsUnwrapped: Record<string, number>;
  attributesStripped: number;
  internalLinksRelativized: number;
  /** 清洗后仍疑似残留的 WP 短码(记报告,不自动删——避免误伤中文方括号文本) */
  suspiciousResidue: string[];
  warnings: string[];
}

function emptyReport(): CleanHtmlReport {
  return {
    gutenbergCommentsRemoved: 0,
    otherCommentsRemoved: 0,
    moreMarkerKept: false,
    scriptsRemoved: 0,
    stylesRemoved: 0,
    iframesRemoved: [],
    iframesKept: 0,
    shortcodesConverted: [],
    shortcodesRemoved: [],
    tagsRenamed: {},
    tagsUnwrapped: {},
    attributesStripped: 0,
    internalLinksRelativized: 0,
    suspiciousResidue: [],
    warnings: [],
  };
}

function bump(rec: Record<string, number>, key: string): void {
  rec[key] = (rec[key] ?? 0) + 1;
}

/** 用子节点原地替换该元素(domhandler 层操作,等价"剥壳留文本") */
function unwrapNode(el: Element): void {
  const parent = el.parent;
  if (!parent) return;
  const idx = parent.children.indexOf(el);
  if (idx < 0) return;
  const kids = [...el.children];
  parent.children.splice(idx, 1, ...kids);
  for (const kid of kids) kid.parent = parent;
  el.children = [];
  el.parent = null;
}

// ── 短码预处理(实库 0 例,防御性保留)──────────────────────────────

/** [caption] → figure/figcaption;su_* 剥壳留内;其余成对短码删除并记报告 */
function convertShortcodes(html: string, report: CleanHtmlReport): string {
  // 已知可转换:caption → figure(inner = img + 说明文字)
  html = html.replace(/\[caption[^\]]*\]([\s\S]*?)\[\/caption\]/gi, (_m, inner: string) => {
    report.shortcodesConverted.push("caption");
    const imgMatch = inner.match(/<img[^>]*>/i);
    if (!imgMatch) {
      report.warnings.push(`caption 短码内无 <img>,整块删除(${inner.length} 字符)`);
      return "";
    }
    const text = inner.replace(imgMatch[0], "").trim();
    return `<figure>${imgMatch[0]}<figcaption>${text}</figcaption></figure>`;
  });
  // su_* 短码:剥壳留内(实库无;防御)
  html = html.replace(
    /\[(su_[a-z_]+)[^\]]*\]([\s\S]*?)\[\/\1\]/gi,
    (_m, code: string, inner: string) => {
      report.shortcodesConverted.push(code);
      return inner;
    },
  );
  // 其余成对短码:删除并记报告(疑似内容丢失时告警)
  html = html.replace(
    /\[([a-z_][a-z0-9_-]{2,})[^\]]*\]([\s\S]*?)\[\/\1\]/gi,
    (m, code: string, inner: string) => {
      if (inner.trim().length > 50) {
        report.warnings.push(`未知短码 [${code}] 含 ${inner.trim().length} 字符内容被删除`);
      }
      report.shortcodesRemoved.push({ code, innerLength: inner.length });
      return "";
    },
  );
  // 自闭合已知杂项短码(gallery/video 等):删除
  html = html.replace(
    /\[(gallery|video|audio|playlist|embed|contact-form)[^\]]*\]/gi,
    (m, code: string) => {
      report.shortcodesRemoved.push({ code, innerLength: 0 });
      return "";
    },
  );
  return html;
}

// ── data: URI 图片(49 篇实库存在,base64 解码落盘策略,2026-09-29 用户确认)──

export interface Base64Image {
  mime: string;
  /** 原始 base64 载荷(不含 data: 前缀) */
  base64: string;
  ext: string;
}

const DATA_URI_RE = /data:image\/(png|jpe?g|gif|webp|avif);base64,([A-Za-z0-9+/=]+)/g;

const MIME_EXT: Record<string, string> = {
  png: "png",
  jpeg: "jpg",
  jpg: "jpg",
  gif: "gif",
  webp: "webp",
  avif: "avif",
};

/**
 * 把 data: URI 图片替换为 replacer 返回的 URL(迁移:落盘为新 URL;
 * 运行时 M5:进上传管线)。返回改写后 HTML 与提取到的图片清单。
 */
export function rewriteBase64Images(
  html: string,
  replacer: (img: Base64Image, index: number) => string,
): { html: string; images: Base64Image[] } {
  const images: Base64Image[] = [];
  const out = html.replace(DATA_URI_RE, (_m, mime: string, base64: string) => {
    const img: Base64Image = { mime, base64, ext: MIME_EXT[mime] ?? "png" };
    images.push(img);
    return replacer(img, images.length - 1);
  });
  return { html: out, images };
}

// ── 主清洗流程 ────────────────────────────────────────────────────

function isInternalUrl(u: string): boolean {
  return (
    /^https?:\/\//i.test(u) &&
    WP_ORIGINS.some((o) => {
      try {
        return new URL(u).hostname === o;
      } catch {
        return false;
      }
    })
  );
}

function toRelative(u: string): string {
  try {
    const parsed = new URL(u);
    return `${parsed.pathname}${parsed.search}`;
  } catch {
    return u;
  }
}

/** 清洗后的短码残留检测(只报不删:中文正文合法使用 [] 极常见) */
function findResidue(html: string): string[] {
  const residue = new Set<string>();
  const re = /\[(gallery|video|audio|playlist|embed|contact-form|su_[a-z_]+)[^\]]*\]/gi;
  for (const m of html.matchAll(re)) residue.add(m[0]);
  return [...residue];
}

export function cleanPostHtml(html: string): { html: string; report: CleanHtmlReport } {
  const report = emptyReport();
  let input = convertShortcodes(html, report);

  // data: URI 若未被上游改写,剥 src 防止巨大字符串入库(记警告)
  if (/data:image\//i.test(input)) {
    const { html: stripped, images } = rewriteBase64Images(input, () => "");
    if (images.length > 0) {
      report.warnings.push(`${images.length} 处 data:URI 图片未落盘,已剥离 src`);
      input = stripped;
    }
  }

  const $ = cheerio.load(input);

  // 1) 注释:wp:* 删;<!--more--> → 标准分隔;其余删
  const walk = (node: ParentNode): void => {
    for (const child of [...node.children]) {
      if (child.type === "comment") {
        const data = (child as Comment).data ?? "";
        if (/^\s*(wp:|\/wp:)/.test(data)) {
          $(child).remove();
          report.gutenbergCommentsRemoved++;
        } else if (/^\s*more(\s[\s\S]*)?$/.test(data)) {
          $(child).replaceWith("<!-- more -->");
          report.moreMarkerKept = true;
        } else {
          $(child).remove();
          report.otherCommentsRemoved++;
        }
      } else if (child.type === "tag") {
        walk(child as Element);
      }
    }
  };
  walk($.root()[0]);

  // 2) script/style 删除;iframe 域白名单(属性过滤交给第 3 步统一白名单)
  report.scriptsRemoved = $("script").remove().length;
  report.stylesRemoved = $("style").remove().length;
  $("iframe").each((_i, el) => {
    const src = el.attribs.src ?? "";
    if (IFRAME_SRC_ALLOW.test(src)) {
      report.iframesKept++;
    } else {
      const outer = $.html(el);
      report.iframesRemoved.push({ src, approxBytes: outer.length });
      $(el).remove();
    }
  });

  // 3) 标签白名单 + 4) 属性白名单(单次遍历)
  $("*").each((_i, node) => {
    const el = node as Element;
    const tag = el.tagName.toLowerCase();
    if (!(el.tagName === tag)) el.tagName = tag; // 统一小写,便于后续渲染与选择器稳定

    if (TAG_RENAME[tag]) {
      const renamed = TAG_RENAME[tag];
      bump(report.tagsRenamed, `${tag}→${renamed}`);
      el.tagName = renamed;
      return;
    }
    if (!ALLOWED_TAGS.has(el.tagName)) {
      // video/audio/source 等:剥壳前记录 src(媒体闭包从原文提取,这里只留痕)
      const src = el.attribs.src ?? el.attribs.href;
      if (src && /\/wp-content\/uploads\//.test(src)) {
        report.warnings.push(`<${tag}> 携带 uploads 资源被剥壳:${src}`);
      }
      bump(report.tagsUnwrapped, el.tagName);
      unwrapNode(el);
      return;
    }

    const allow = ALLOWED_ATTRS[el.tagName];
    for (const attr of el.attribs ? Object.keys(el.attribs) : []) {
      const keep =
        allow?.has(attr) && (attr !== "class" || CODE_CLASS_RE.test(el.attribs.class ?? ""));
      if (!keep) {
        delete el.attribs[attr];
        report.attributesStripped++;
      }
    }
    if (el.tagName === "img") {
      const src = el.attribs.src ?? "";
      if (isInternalUrl(src)) {
        el.attribs.src = toRelative(src);
        report.internalLinksRelativized++;
      }
      if (!el.attribs.loading) el.attribs.loading = "lazy"; // 03 §4:统一补 lazy
    }
    if (el.tagName === "a") {
      const href = el.attribs.href ?? "";
      if (isInternalUrl(href)) {
        el.attribs.href = toRelative(href);
        report.internalLinksRelativized++;
      }
    }
    if (el.tagName === "span" && el.attribs.style) {
      const kept = el.attribs.style
        .split(";")
        .filter((decl) => SPAN_STYLE_ALLOW.test(decl))
        .join(";");
      if (kept) el.attribs.style = kept;
      else delete el.attribs.style;
    }
  });

  const out = $.html();
  report.suspiciousResidue = findResidue(out);
  if (report.suspiciousResidue.length > 0) {
    report.warnings.push(`疑似短码残留 ${report.suspiciousResidue.length} 处`);
  }
  return { html: out, report };
}
