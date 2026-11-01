/**
 * 公众号正文 HTML 生成(M17 批②;M31 批① 样式引擎重构):
 * markdown-it(doocs/md 同引擎)渲染,全内联样式(公众号编辑器滤 <style>/
 * class,只有 style 属性保真)。
 *
 * 体积纪律(2026-10-15 立项,「美观且码点不膨胀」):外层全局 <section> 一次性
 * 声明可继承属性(font-size/color/line-height),元素级样式只写与全局的**差异**
 * ——码点大头从「每段重复全套」降为「每段一行 margin」;观感靠结构性声明
 * (标题左竖条/引用卡/暗底代码块)保证,不靠声明堆叠。嵌套列表展平为
 * section+文字标记(微信编辑器对 ul/ol 直接嵌套会重复出 bullet,文颜同款
 * 规避)。校验口径不变:全文码点(wechat-budget/wechat-sync-run)。
 *
 * 外链在公众号正文不可点击(<a> 被剥):链接文字染色 + [n] 角标,文末
 * References 列出链接(≤20 条,同 href 去重;超出只染色不编号)。
 * 纯函数零 IO;图片 URL 已由 sync 管线在 md 文本层替换为 mmbiz(此处只渲染)。
 */
import hljs from "highlight.js/lib/common";
import MarkdownIt from "markdown-it";

import { WECHAT_REFERENCE_MAX } from "./channels";
import { getWechatTheme, type WechatTheme } from "./wechat-themes";

// ── 代码语法高亮(M51 P1):hljs token → 内联色(公众号滤 class;GitHub Dark 取色,
// 暗底代码块统一不随主题)。未知语言回退转义纯文本。

/** 段落排版选项(M51 P2,镜像 doocs isUseIndent/isUseJustify):
 * default | indent(首行缩进两字)| justify(两端对齐)| indent_justify */
export const WECHAT_PARA_STYLES = ["default", "indent", "justify", "indent_justify"] as const;
export type WechatParaStyle = (typeof WECHAT_PARA_STYLES)[number];

/** 由主题调色板实例化的内联样式表:global 可继承项只在此处;元素级只写差异 */
function stylesFor(t: WechatTheme, paraStyle: WechatParaStyle) {
  const pExtra =
    (paraStyle.includes("indent") ? "text-indent:2em;" : "") +
    (paraStyle.includes("justify") ? "text-align:justify;" : "");
  return {
    global: "font-size:15px;color:#3f3f46;line-height:1.75;",
    p: `margin:12px 0;${pExtra}`,
    // h1/h2 带主题色左竖条(视觉锚点);h3/h4 阶梯字号
    h: [
      `margin:28px 0 14px;font-size:18px;font-weight:600;color:${t.heading};line-height:1.4;border-left:3px solid ${t.heading};padding-left:10px;`,
      `margin:24px 0 12px;font-size:17px;font-weight:600;color:${t.heading};line-height:1.4;border-left:3px solid ${t.heading};padding-left:10px;`,
      `margin:20px 0 10px;font-size:15px;font-weight:600;color:${t.heading};line-height:1.4;`,
      `margin:18px 0 8px;font-size:15px;font-weight:600;color:${t.heading};line-height:1.4;`,
    ],
    /** h5/h6 降级为加粗段(公众号层级过深显示无意义;字号继承全局 15px) */
    hDeep: `margin:16px 0 8px;font-weight:600;color:${t.heading};`,
    strong: `font-weight:600;color:${t.strong};`,
    em: "font-style:italic;",
    del: "text-decoration:line-through;color:#71717a;",
    inlineCode: `background-color:rgba(0,0,0,.06);color:${t.inlineCode};padding:1px 4px;border-radius:3px;font-family:Menlo,monospace;font-size:13px;`,
    // 代码块统一暗底不随主题(长代码对比度;主题只染强调元素)
    preSection:
      "background-color:#0d1117;border-radius:6px;padding:12px;overflow-x:auto;margin:12px 0;",
    pre: "margin:0;",
    code: "color:#e6edf3;font-family:Menlo,monospace;font-size:13px;line-height:1.6;word-break:break-word;",
    blockquote: `border-left:3px solid ${t.quoteBorder};background-color:${t.quoteBg};padding:8px 12px;margin:12px 0;color:${t.quoteText};`,
    ul: "margin:12px 0;padding-left:24px;",
    ol: "margin:12px 0;padding-left:24px;",
    li: "margin:4px 0;",
    img: "max-width:100%;border-radius:4px;margin:8px auto;display:block;",
    hr: "border:none;border-top:1px solid #d0d7de;margin:20px 0;",
    table: "border-collapse:collapse;margin:12px 0;width:100%;font-size:13px;",
    th: "padding:6px 10px;text-align:left;border:1px solid #ddd;background-color:#f6f8fa;",
    td: "padding:6px 10px;border:1px solid #ddd;",
    link: `color:${t.link};`,
    refSup: `color:${t.link};font-size:11px;`,
    refsSection: "border-top:1px solid #d0d7de;margin-top:20px;padding-top:12px;",
    refsTitle: "margin:0 0 8px;font-size:13px;font-weight:600;color:#57606a;",
    refItem: "margin:4px 0;font-size:12px;color:#71717a;word-break:break-all;",
  };
}

type WechatStyles = ReturnType<typeof stylesFor>;

const md: MarkdownIt = new MarkdownIt({ html: true, linkify: false, typographer: false });
// M51 P1/P2:脚注 [^1] 语法(自研规则——markdown-it-footnote v4 无类型声明,
// 其 CJS 解析路径下 ambient 声明不生效致 CI TS7016 两次实收)+ GFM 提示块
// (> [!NOTE] 等,class 化输出经 postprocessAlerts 转内联样式,微信滤 class)
import githubAlerts from "markdown-it-github-alerts";
md.use(githubAlerts);

const HLJS_COLORS: Record<string, string> = {
  keyword: "#ff7b72",
  built_in: "#79c0ff",
  type: "#ffa657",
  class: "#ffa657",
  string: "#a5d6ff",
  number: "#79c0ff",
  literal: "#79c0ff",
  comment: "#8b949e",
  title: "#d2a8ff",
  function: "#d2a8ff",
  params: "#e6edf3",
  attr: "#79c0ff",
  attribute: "#79c0ff",
  variable: "#ffa657",
  property: "#e6edf3",
  symbol: "#e6edf3",
  tag: "#7ee787",
  name: "#7ee787",
  selector_tag: "#7ee787",
  meta: "#8b949e",
  meta_keyword: "#ff7b72",
  operator: "#ff7b72",
  punctuation: "#e6edf3",
  regexp: "#a5d6ff",
  section: "#1f6feb",
  addition: "#aff5b4",
  deletion: "#ffdcd7",
};

/** 高亮整块代码 → 逐行内联样式 HTML(<br> 行间,文本空格全量 &nbsp;)。
 * 跨行 token(块注释/多行字符串)在换行处闭栈重开,span 恒配平;
 * 未知语言/高亮异常回退转义纯文本(同管线,永不抛)。 */
function highlightToWechatLines(code: string, lang: string): string {
  let highlighted: string;
  try {
    highlighted = hljs.getLanguage(lang)
      ? hljs.highlight(code, { language: lang, ignoreIllegals: true }).value
      : md.utils.escapeHtml(code);
  } catch {
    highlighted = md.utils.escapeHtml(code);
  }
  const openSpan = (cls: string): string => `<span style="color:${HLJS_COLORS[cls] ?? "inherit"}">`;
  const out: string[] = [];
  const stack: string[] = [];
  let i = 0;
  while (i < highlighted.length) {
    if (highlighted[i] === "<") {
      const close = highlighted.indexOf(">", i);
      if (close < 0) {
        out.push(highlighted.slice(i));
        break;
      }
      const tag = highlighted.slice(i, close + 1);
      const cls = /class="hljs-([\w-]+)/.exec(tag)?.[1]; // 首类即可(hljs 多子类 title function_)
      if (tag.startsWith("</")) {
        if (stack.length > 0) {
          stack.pop();
          out.push("</span>");
        }
      } else if (cls) {
        stack.push(cls);
        out.push(openSpan(cls));
      } else {
        out.push(tag); // 非 hljs span(防御,现行输出无)
      }
      i = close + 1;
      continue;
    }
    const nextTag = highlighted.indexOf("<", i);
    const seg = highlighted.slice(i, nextTag < 0 ? highlighted.length : nextTag);
    const reopen = stack.map(openSpan).join("");
    const closes = "</span>".repeat(stack.length);
    out.push(
      seg
        .split("\n")
        .map((line) => line.replaceAll(" ", "&nbsp;"))
        .join(`${closes}<br>${reopen}`),
    );
    i = nextTag < 0 ? highlighted.length : nextTag;
  }
  return out.join("");
}

/** 渲染 env(引用收集 + link 配对栈 + 本次渲染的主题样式表 + 脚注簿) */
interface WechatEnv {
  refs: { href: string; title: string }[];
  linkNums: number[];
  styles: WechatStyles;
  /** 脚注簿:正文角标按首引顺序编号(nums);定义正文按 label 存放(defs)。
   * 卡片按 nums 排序渲染,未被引用的定义不显示(GFM 语义) */
  footnoteNums: Map<string, number>;
  footnoteDefs: Map<string, string>;
}

function envOf(env: unknown): WechatEnv {
  return env as WechatEnv;
}

// ── 脚注 [^label](M51 自研规则,替代 markdown-it-footnote 依赖)──────────────

const FOOTNOTE_DEF_RE = /^\[\^([^\]]+)\]:\s*/;
const FOOTNOTE_REF_LABEL = "[^";

/** markdown-it 规则最小结构(State*):只用到 pos/src/getLines/line/env */
interface MdInlineState {
  src: string;
  pos: number;
  env: unknown;
  push(type: string, tag: string, nesting: number): { content: string };
}
interface MdBlockState {
  env: unknown;
  line: number;
  getLines(begin: number, end?: number): string;
}

/** 行内角标规则:[^label] → 内联样式 sup [n](未定义的 label 按字面文本渲染) */
function footnoteRefRule(state: MdInlineState, silent: boolean): boolean {
  const src = state.src;
  if (state.pos + 2 > src.length || !src.startsWith(FOOTNOTE_REF_LABEL, state.pos)) return false;
  const labelMatch = /^\[\^([^\]\s]+)\]/.exec(src.slice(state.pos));
  if (!labelMatch) return false;
  const label = labelMatch[1];
  if (!silent) {
    const env = envOf(state.env);
    let n = env.footnoteNums.get(label);
    if (n === undefined) {
      n = env.footnoteNums.size + 1;
      env.footnoteNums.set(label, n);
    }
    const token = state.push("html_inline", "", 0);
    token.content = `<sup style="${env.styles.refSup}">[${n}]</sup>`;
  }
  state.pos += labelMatch[0].length;
  return true;
}

/** 块级定义规则:[^label]: 正文(续行以空白缩进并入,空行即止) */
function footnoteDefRule(
  state: MdBlockState,
  startLine: number,
  endLine: number,
  silent: boolean,
): boolean {
  const startLineText = state.getLines(startLine, startLine + 1);
  const def = FOOTNOTE_DEF_RE.exec(startLineText);
  if (!def) return false;
  if (silent) return true;
  const env = envOf(state.env);
  const label = def[1];
  const lines: string[] = [startLineText.slice(def[0].length).trim()];
  let line = startLine + 1;
  while (line < endLine) {
    const text = state.getLines(line, line + 1);
    if (!/^\s+\S/.test(text)) break; // 非缩进续行即定义结束
    lines.push(text.trim());
    line += 1;
  }
  // 定义正文过完整 inline 渲染(粗体/行内码等带样式);同 label 重定义后到先得
  if (!env.footnoteDefs.has(label)) {
    env.footnoteDefs.set(label, md.renderInline(lines.join(" "), env));
  }
  state.line = line;
  return true;
}

md.inline.ruler.before("link", "wechat_footnote_ref", footnoteRefRule);
md.block.ruler.before(
  // 必须先于 reference 规则——`[^1]: 文本` 会被链接引用定义吃掉(实收:
  // markdown-it-footnote 同款注册位)
  "reference",
  "wechat_footnote_def",
  // RuleBlock 联合重载与 4 参签名互斥,never 断言(实参形状由本文件接口约束)
  footnoteDefRule as never,
  {
    alt: ["paragraph", "reference", "blockquote", "list"],
  },
);

const escape = (s: string): string => md.utils.escapeHtml(s);

// ── 渲染器覆写(全内联样式;样式表经 env 注入,规则只在注册期绑定一次)───────

// 紧列表的段落 token 带 hidden=true(默认规则跳过标签)——无视它会给列表项
// 硬塞 <p>(M17 潜在缺陷:列表项多出段落边距+每项 ~38 码点)
md.renderer.rules.paragraph_open = (tokens, idx, _o, env) =>
  tokens[idx].hidden ? "" : `<p style="${envOf(env).styles.p}">`;
md.renderer.rules.paragraph_close = (tokens, idx) => (tokens[idx].hidden ? "" : "</p>");

md.renderer.rules.heading_open = (tokens, idx, _o, env) => {
  const level = Number(tokens[idx].tag.slice(1)); // h1..h6
  const s = envOf(env).styles;
  const style = level >= 1 && level <= 4 ? s.h[level - 1] : s.hDeep;
  return `<${level >= 5 ? "p" : tokens[idx].tag} style="${style}">`;
};
md.renderer.rules.heading_close = (tokens, idx) => {
  const level = Number(tokens[idx].tag.slice(1));
  return level >= 5 ? "</p>" : `</${tokens[idx].tag}>`;
};

md.renderer.rules.strong_open = (_t, _i, _o, env) => `<strong style="${envOf(env).styles.strong}">`;
md.renderer.rules.strong_close = () => "</strong>";
md.renderer.rules.em_open = (_t, _i, _o, env) => `<em style="${envOf(env).styles.em}">`;
md.renderer.rules.em_close = () => "</em>";
md.renderer.rules.s_open = (_t, _i, _o, env) => `<del style="${envOf(env).styles.del}">`;
md.renderer.rules.s_close = () => "</del>";

md.renderer.rules.code_inline = (tokens, idx, _o, env) =>
  `<code style="${envOf(env).styles.inlineCode}">${md.utils.escapeHtml(tokens[idx].content)}</code>`;

md.renderer.rules.fence = (tokens, idx, _o, env) => {
  const s = envOf(env).styles;
  // 微信粘贴管线不保真 white-space(M50 修复):行间 <br> + 空格 &nbsp; 由
  // highlightToWechatLines 承担(M51 起叠加语法高亮)
  const lang = (tokens[idx].info || "").trim().split(/\s+/)[0];
  const body = highlightToWechatLines(tokens[idx].content.replace(/\n$/, ""), lang);
  return `<section style="${s.preSection}"><section style="${s.pre}${s.code}">${body}</section></section>`;
};

md.renderer.rules.blockquote_open = (_t, _i, _o, env) =>
  `<blockquote style="${envOf(env).styles.blockquote}">`;
md.renderer.rules.blockquote_close = () => "</blockquote>";

md.renderer.rules.bullet_list_open = (_t, _i, _o, env) => `<ul style="${envOf(env).styles.ul}">`;
md.renderer.rules.bullet_list_close = () => "</ul>";
md.renderer.rules.ordered_list_open = (tokens, idx, _o, env) => {
  const start = tokens[idx].attrGet("start");
  return `<ol style="${envOf(env).styles.ol}"${start ? ` start="${start}"` : ""}>`;
};
md.renderer.rules.ordered_list_close = () => "</ol>";
md.renderer.rules.list_item_open = (_t, _i, _o, env) => `<li style="${envOf(env).styles.li}">`;
md.renderer.rules.list_item_close = () => "</li>";

md.renderer.rules.hr = (_t, _i, _o, env) => `<section style="${envOf(env).styles.hr}"></section>`;

md.renderer.rules.image = (tokens, idx, options, env, self) => {
  const t = tokens[idx];
  // 默认 image 规则的 alt 来自 children 渲染,覆写后需手动补回(无障碍/裂图提示)
  if (t.children) t.attrSet("alt", self.renderInlineAsText(t.children, options, env));
  t.attrSet("style", envOf(env).styles.img);
  return self.renderToken(tokens, idx, options);
};

md.renderer.rules.table_open = (_t, _i, _o, env) => `<table style="${envOf(env).styles.table}">`;
md.renderer.rules.table_close = () => "</table>";
md.renderer.rules.th_open = (_t, _i, _o, env) => `<th style="${envOf(env).styles.th}">`;
md.renderer.rules.th_close = () => "</th>";
md.renderer.rules.td_open = (_t, _i, _o, env) => `<td style="${envOf(env).styles.td}">`;
md.renderer.rules.td_close = () => "</td>";

md.renderer.rules.link_open = (tokens, idx, _options, _env) => {
  const e = envOf(_env);
  const href = (tokens[idx].attrGet("href") ?? "").trim();
  let n = 0;
  if (/^https?:\/\//i.test(href)) {
    const found = e.refs.findIndex((r) => r.href === href); // 同 href 去重同号
    if (found >= 0) {
      n = found + 1;
    } else if (e.refs.length < WECHAT_REFERENCE_MAX) {
      // 相邻 text token 即链接文字(嵌套结构无文字则记空,References 回退 URL)
      const next = tokens[idx + 1];
      e.refs.push({ href, title: next?.type === "text" ? next.content.trim().slice(0, 80) : "" });
      n = e.refs.length;
    } // 超上限:只染色不编号
  }
  e.linkNums.push(n);
  return `<span style="${e.styles.link}">`;
};

md.renderer.rules.link_close = (_tokens, _idx, _options, _env) => {
  const e = envOf(_env);
  const n = e.linkNums.pop() ?? 0;
  return n ? `<sup style="${e.styles.refSup}">[${n}]</sup></span>` : "</span>";
};

// ── 列表一律展平(微信兼容):ul/ol 在微信编辑器里嵌套会重复出 bullet,顶层
// 也会在带样式行内元素处断行(2026-10-27 生产实收)——统一转 section+文字标记
// (文颜 wechatPostRender 同款规避;视觉层次保留)

const LIST_TAG_RE = /<(\/?)(ul|ol)\b[^>]*>/g;

/** 自 from(指向 <tag 开标签)起做标签深度计数,返回配对闭标签之后的下标 */
function listBlockEnd(html: string, from: number): number {
  const m = /^<(ul|ol)\b/.exec(html.slice(from));
  if (!m) return -1;
  const tag = m[1];
  const re = new RegExp(`<(/?)${tag}\\b[^>]*>`, "g");
  re.lastIndex = from;
  let depth = 0;
  for (let hit = re.exec(html); hit; hit = re.exec(html)) {
    depth += hit[1] === "/" ? -1 : 1;
    if (depth === 0) return hit.index + hit[0].length;
  }
  return html.length; // 防御:不平衡则吃到文末(我们的渲染器输出恒平衡)
}

/** 展平一个叶子 list 块(内部已无嵌套 list)为 section+文字标记序列 */
function flattenLeafList(html: string, openStart: number): string {
  const openTagEnd = html.indexOf(">", openStart) + 1;
  const blockEnd = listBlockEnd(html, openStart);
  if (openTagEnd === 0 || blockEnd < 0) return html;
  // 闭标签长度固定(</ul>/</ol> 5 字符),直接裁
  const body = html.slice(openTagEnd, blockEnd - 5);
  const ordered = html.slice(openStart, openTagEnd).startsWith("<ol");
  const startAttr = /\bstart="(\d+)"/.exec(html.slice(openStart, openTagEnd));
  let counter = startAttr ? Number(startAttr[1]) : 1;

  // 叶子块内 <li …>…</li> 即顶层条目(无嵌套 list,深度恒 0)
  const items: string[] = [];
  const liRe = /<li\b[^>]*>/g;
  for (let hit = liRe.exec(body); hit; hit = liRe.exec(body)) {
    const contentStart = hit.index + hit[0].length;
    const close = body.indexOf("</li>", contentStart);
    if (close < 0) break; // 防御
    items.push(body.slice(contentStart, close));
    liRe.lastIndex = close + 5;
  }
  if (items.length === 0) return html.slice(0, openStart) + html.slice(blockEnd);
  const marker = ordered ? () => `${counter++}. ` : () => "• ";
  // 宽松列表项以 <p> 开头:marker 注入段内,避免落单成独立行
  const wrap = (m: string, content: string): string => {
    const pm = /^<p style="[^">]*">/.exec(content);
    return `<section style="margin-left:1em;">${
      pm ? content.slice(0, pm[0].length) + m + content.slice(pm[0].length) : m + content
    }</section>`;
  };
  const flattened = items
    .map((content) => {
      // 任务列表(GFM - [ ] / - [x]):勾选框取代 marker(M51 P1;微信滤 input,
      // 以字形 ☑/☐ 呈现)
      const pm = /^<p style="[^">]*">/.exec(content);
      const bare = pm ? content.slice(pm[0].length) : content;
      const tm = /^\[([ xX])\] /.exec(bare);
      if (tm) {
        const glyph =
          tm[1] === " "
            ? '<span style="color:#8b949e;">☐</span>'
            : '<span style="color:#1a7f37;">☑</span>';
        const rest = bare.slice(tm[0].length);
        return `<section style="margin-left:1em;">${pm ? pm[0] : ""}${glyph} ${rest}</section>`;
      }
      return wrap(marker(), content);
    })
    .join("");
  return html.slice(0, openStart) + flattened + html.slice(blockEnd);
}

/** 递归展平全部 list:恒取「最右一个开标签」(其块内无更晚 list,必为叶子)
 * 先展,直到无 list 标签残留 */
function flattenNestedLists(html: string): string {
  for (;;) {
    LIST_TAG_RE.lastIndex = 0;
    // 单遍扫描记深度;记录最后一个深度 ≥2 的开标签(其块内不含更晚的 list,
    // 即叶子——更晚的开标签若在其块内深度只会更深,已被「最右」优先覆盖)
    let target = -1;
    const stack: string[] = [];
    for (
      let hit = LIST_TAG_RE.exec(html), guard = 0;
      hit && guard < 10_000;
      hit = LIST_TAG_RE.exec(html), guard++
    ) {
      if (hit[0].startsWith("</")) {
        stack.pop();
        continue;
      }
      target = hit.index; // 深度 ≥1:微信对顶层 list 同样断行(2026-10-27 实收),一律展平
      stack.push(hit[1]);
    }
    if (target < 0) return html;
    html = flattenLeafList(html, target);
  }
}

/** GFM 提示块配色(Note/Tip/Important/Warning/Caution → 左边框/底色/标题) */
const ALERT_STYLES: Record<string, { border: string; bg: string; label: string; glyph: string }> = {
  note: { border: "#0969da", bg: "#ddf4ff", label: "提示", glyph: "ℹ️" },
  tip: { border: "#1a7f37", bg: "#dafbe1", label: "建议", glyph: "💡" },
  important: { border: "#8250df", bg: "#fbefff", label: "重要", glyph: "❗" },
  warning: { border: "#9a6700", bg: "#fff8c5", label: "警告", glyph: "⚠️" },
  caution: { border: "#cf222e", bg: "#ffebe9", label: "注意", glyph: "🛑" },
};

/** GFM 提示块后处理:markdown-it-github-alerts 的 class div 转内联样式卡片
 * (微信滤 class;标题中文+字形,正文继承全局)。未知类型按 note 处理。 */
function postprocessAlerts(html: string): string {
  return html
    .replace(
      /<div class="markdown-alert markdown-alert-(\w+)">\s*<p class="markdown-alert-title">[\s\S]*?<\/p>/g,
      (_m, type: string) => {
        const cfg = ALERT_STYLES[type.toLowerCase()] ?? ALERT_STYLES.note;
        return `<section style="border-left:3px solid ${cfg.border};background-color:${cfg.bg};padding:8px 12px;margin:12px 0;"><p style="margin:0 0 4px;font-weight:600;color:${cfg.border};">${cfg.glyph} ${cfg.label}</p>`;
      },
    )
    .replaceAll("</div>", "</section>"); // 渲染器本体零 div,闭标签全属提示块
}

export interface WechatHtmlResult {
  /** 全内联样式正文 HTML(全局节包裹,含文末 References 节,无外链则无该节) */
  html: string;
  /** 外链引用(编号从 1 起,与正文 [n] 对应;已按 href 去重) */
  refs: string[];
}

export interface WechatRenderOptions {
  /** 段落排版(缺省 default=不缩进不对齐) */
  paraStyle?: WechatParaStyle | null;
  /** 文首阅读时间+目录卡(M51 P2;缺省关) */
  tocMeta?: boolean | null;
}

/** 阅读时长估算(中文口径:码点数 / 450 字每分,60s 内短文兜 1 分钟) */
function estimateReadingMinutes(mdText: string): { minutes: number; chars: number } {
  const text = mdText.replace(/```[\s\S]*?```/g, "").replace(/\s+/g, "");
  const chars = [...text].length;
  return { minutes: Math.max(1, Math.round(chars / 450)), chars };
}

/** 文首 meta 卡:阅读时间 + h2 目录(层级导航在微信不可锚,纯文字结构预告) */
function buildTocMeta(mdText: string): string {
  const { minutes, chars } = estimateReadingMinutes(mdText);
  const toc = [...mdText.matchAll(/^##\s+(?!#)(.+)$/gm)]
    .map((m) => m[1].trim())
    .filter((t) => t.length > 0);
  const tocLine =
    toc.length > 0
      ? `<p style="margin:0;font-size:12px;color:#71717a;">目录:${toc
          .map((t, i) => `${i + 1}. ${escape(t)}`)
          .join(" · ")}</p>`
      : "";
  return `<section style="border-left:3px solid #d0d7de;background-color:#f6f8fa;padding:8px 12px;margin:12px 0;"><p style="margin:0 0 4px;font-size:12px;color:#71717a;">预计阅读 ${minutes} 分钟 · 全文 ${chars} 字</p>${tocLine}</section>`;
}

/** markdown → 公众号内联样式 HTML(纯函数;env 每次新建防串渲染。
 * themeId 未知/缺省回退默认主题,渲染永不抛) */
export function renderWechatHtml(
  mdText: string,
  themeId?: string | null,
  opts?: WechatRenderOptions,
): WechatHtmlResult {
  const theme = getWechatTheme(themeId);
  const paraStyle = (opts?.paraStyle ?? "default") as WechatParaStyle;
  const env: WechatEnv = {
    refs: [],
    linkNums: [],
    styles: stylesFor(theme, paraStyle),
    footnoteNums: new Map(),
    footnoteDefs: new Map(),
  };
  // h2 目录在渲染前收集(渲染后无裸文本)
  const tocMetaHtml = opts?.tocMeta ? buildTocMeta(mdText) : "";
  const body = postprocessAlerts(md.render(mdText, env));
  const refs = env.refs.map((r) => r.href);
  const footnotesHtml =
    env.footnoteNums.size === 0
      ? ""
      : `<section style="${env.styles.refsSection}"><p style="${env.styles.refsTitle}">脚注</p>${[
          ...env.footnoteNums.entries(),
        ]
          .sort((a, b) => a[1] - b[1])
          .map(
            ([label, n]) =>
              `<p style="${env.styles.refItem}">[${n}] ${env.footnoteDefs.get(label) ?? ""}</p>`,
          )
          .join("")}</section>`;
  const refsHtml =
    env.refs.length === 0
      ? ""
      : `<section style="${env.styles.refsSection}"><p style="${env.styles.refsTitle}">References</p>${env.refs
          .map((r, i) => {
            const label = r.title ? `${escape(r.title)}(${escape(r.href)})` : escape(r.href);
            return `<p style="${env.styles.refItem}">[${i + 1}] ${label}</p>`;
          })
          .join("")}</section>`;
  return {
    html: `<section style="${env.styles.global}">${tocMetaHtml}${flattenNestedLists(
      body + refsHtml + footnotesHtml,
    )}</section>`,
    refs,
  };
}
