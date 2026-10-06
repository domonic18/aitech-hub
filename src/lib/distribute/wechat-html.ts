/**
 * 公众号正文 HTML 生成(M17 批②;主题扩展:仿 md.openwrite.cn 多主题):
 * markdown-it(doocs/md 同引擎)渲染,全内联样式(公众号编辑器滤 <style>/
 * class,只有 style 属性保真)。强调元素(标题/加粗/引用框/行内码/链接角标)
 * 随主题变色(wechat-themes.ts 注册表),正文段落保持深灰;代码块统一暗底。
 * 外链在公众号正文不可点击(<a> 被剥):链接文字染色 + [n] 角标,文末
 * References 列出链接(≤20 条,同 href 去重;超出只染色不编号)。
 * 纯函数零 IO;图片 URL 已由 sync 管线在 md 文本层替换为 mmbiz(此处只渲染)。
 */
import MarkdownIt from "markdown-it";

import { WECHAT_REFERENCE_MAX } from "./channels";
import { getWechatTheme, type WechatTheme } from "./wechat-themes";

/** 由主题调色板实例化的内联样式表(零 class;中性色不随主题) */
function stylesFor(t: WechatTheme) {
  return {
    p: "margin:12px 0;font-size:15px;color:#3f3f46;line-height:1.75;",
    h: [
      `margin:24px 0 12px;font-size:17px;font-weight:600;color:${t.heading};line-height:1.4;`,
      `margin:22px 0 10px;font-size:16px;font-weight:600;color:${t.heading};line-height:1.4;`,
      `margin:20px 0 10px;font-size:15px;font-weight:600;color:${t.heading};line-height:1.4;`,
      `margin:18px 0 8px;font-size:15px;font-weight:600;color:${t.heading};line-height:1.4;`,
    ],
    /** h5/h6 降级为加粗段(公众号层级过深显示无意义) */
    hDeep: `margin:16px 0 8px;font-size:14px;font-weight:600;color:${t.heading};`,
    strong: `font-weight:600;color:${t.strong};`,
    em: "font-style:italic;",
    del: "text-decoration:line-through;color:#71717a;",
    inlineCode: `background-color:rgba(0,0,0,.06);color:${t.inlineCode};padding:1px 4px;border-radius:3px;font-family:Consolas,Menlo,monospace;font-size:13px;`,
    // 代码块统一暗底不随主题(长代码对比度;主题只染强调元素)
    preSection:
      "background-color:#0d1117;border-radius:6px;padding:12px;overflow-x:auto;margin:12px 0;",
    pre: "margin:0;background:transparent;",
    code: "color:#e6edf3;font-family:Consolas,Menlo,monospace;font-size:13px;line-height:1.6;white-space:pre-wrap;word-break:break-word;",
    blockquote: `border-left:3px solid ${t.quoteBorder};background-color:${t.quoteBg};padding:8px 12px;margin:12px 0;color:${t.quoteText};`,
    ul: "margin:12px 0;padding-left:24px;",
    ol: "margin:12px 0;padding-left:24px;",
    li: "margin:4px 0;font-size:15px;color:#3f3f46;line-height:1.75;",
    img: "max-width:100%;border-radius:4px;margin:8px auto;display:block;",
    hr: "border:none;border-top:1px solid #d0d7de;margin:20px 0;",
    table: "border-collapse:collapse;margin:12px 0;width:100%;font-size:13px;",
    th: "border:1px solid #d0d7de;background-color:#f6f8fa;padding:6px 10px;text-align:left;font-weight:600;color:#1f2328;",
    td: "border:1px solid #d0d7de;padding:6px 10px;color:#3f3f46;",
    link: `color:${t.link};`,
    refSup: `color:${t.link};font-size:11px;`,
    refsSection: "border-top:1px solid #d0d7de;margin-top:20px;padding-top:12px;",
    refsTitle: "margin:0 0 8px;font-size:13px;font-weight:600;color:#57606a;",
    refItem: "margin:4px 0;font-size:12px;color:#71717a;word-break:break-all;",
  };
}

type WechatStyles = ReturnType<typeof stylesFor>;

const md: MarkdownIt = new MarkdownIt({ html: true, linkify: false, typographer: false });

/** 渲染 env(引用收集 + link 配对栈 + 本次渲染的主题样式表) */
interface WechatEnv {
  refs: { href: string; title: string }[];
  linkNums: number[];
  styles: WechatStyles;
}

function envOf(env: unknown): WechatEnv {
  return env as WechatEnv;
}

const escape = (s: string): string => md.utils.escapeHtml(s);

// ── 渲染器覆写(全内联样式;样式表经 env 注入,规则只在注册期绑定一次)───────

md.renderer.rules.paragraph_open = (_t, _i, _o, env) => `<p style="${envOf(env).styles.p}">`;
md.renderer.rules.paragraph_close = () => "</p>";

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
  `<code style="${envOf(env).styles.inlineCode}">${escape(tokens[idx].content)}</code>`;

md.renderer.rules.fence = (tokens, idx, _o, env) => {
  const s = envOf(env).styles;
  return `<section style="${s.preSection}"><pre style="${s.pre}"><code style="${s.code}">${escape(
    tokens[idx].content.replace(/\n$/, ""),
  )}</code></pre></section>`;
};

md.renderer.rules.blockquote_open = (_t, _i, _o, env) =>
  `<blockquote style="${envOf(env).styles.blockquote}">`;
md.renderer.rules.blockquote_close = () => "</blockquote>";

md.renderer.rules.bullet_list_open = (_t, _i, _o, env) => `<ul style="${envOf(env).styles.ul}">`;
md.renderer.rules.bullet_list_close = () => "</ul>";
md.renderer.rules.ordered_list_open = (_t, _i, _o, env) => `<ol style="${envOf(env).styles.ol}">`;
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

export interface WechatHtmlResult {
  /** 全内联样式正文 HTML(含文末 References 节,无外链则无该节) */
  html: string;
  /** 外链引用(编号从 1 起,与正文 [n] 对应;已按 href 去重) */
  refs: string[];
}

/** markdown → 公众号内联样式 HTML(纯函数;env 每次新建防串渲染。
 * themeId 未知/缺省回退默认主题,渲染永不抛) */
export function renderWechatHtml(mdText: string, themeId?: string | null): WechatHtmlResult {
  const theme = getWechatTheme(themeId);
  const env: WechatEnv = { refs: [], linkNums: [], styles: stylesFor(theme) };
  const body = md.render(mdText, env);
  const refs = env.refs.map((r) => r.href);
  const refsHtml =
    env.refs.length === 0
      ? ""
      : `<section style="${env.styles.refsSection}"><p style="${env.styles.refsTitle}">References</p>${env.refs
          .map((r, i) => {
            const label = r.title ? `${escape(r.title)}(${escape(r.href)})` : escape(r.href);
            return `<p style="${env.styles.refItem}">[${i + 1}] ${label}</p>`;
          })
          .join("")}</section>`;
  return { html: body + refsHtml, refs };
}
