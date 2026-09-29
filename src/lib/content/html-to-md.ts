/**
 * HTML → Markdown 转换(GEO,requirement §3.2:文章 .md 直出 + llms-full.txt)。
 * 输入是清洗后的 WP 正文(标签/属性白名单内,03 文档 §4),按已知标签集做结构映射;
 * 不做 markdown 特殊字符转义(技术正文 CJK 为主,转义噪声大于收益)。
 * 纯函数;单测见 html-to-md.test.ts。
 */
import * as cheerio from "cheerio";
import type { AnyNode, Element, Text } from "domhandler";

const HEADING_TAGS: Record<string, number> = { h1: 1, h2: 2, h3: 3, h4: 4, h5: 5, h6: 6 };

function children(el: Element): AnyNode[] {
  return el.children ?? [];
}

function isElem(node: AnyNode): node is Element {
  return node.type === "tag";
}

function textOf(node: AnyNode): string {
  if (node.type === "text") return (node as Text).data;
  if (isElem(node)) return children(node).map(textOf).join("");
  return "";
}

function collapse(s: string): string {
  return s.replace(/\s+/g, " ");
}

/** 行内上下文:拼接行内元素,块级内容降级为其文本 */
function inline(nodes: AnyNode[]): string {
  let out = "";
  for (const node of nodes) {
    if (node.type === "text") {
      out += collapse((node as Text).data);
      continue;
    }
    if (!isElem(node)) continue;
    const inner = () => inline(children(node));
    switch (node.tagName) {
      case "a": {
        const href = (node.attribs.href ?? "").trim();
        const text = inner().trim();
        out += href && text ? `[${text}](${href})` : text || href;
        break;
      }
      case "strong":
      case "b": {
        const text = inner().trim();
        out += text ? `**${text}**` : "";
        break;
      }
      case "em":
      case "i": {
        const text = inner().trim();
        out += text ? `*${text}*` : "";
        break;
      }
      case "del":
      case "s":
      case "strike": {
        const text = inner().trim();
        out += text ? `~~${text}~~` : "";
        break;
      }
      case "code":
        out += `\`${collapse(textOf(node)).trim()}\``;
        break;
      case "br":
        out += "\n";
        break;
      case "video": {
        const src = (node.attribs.src ?? "").trim();
        out += src ? `[视频](${src})` : "";
        break;
      }
      case "img": {
        const src = (node.attribs.src ?? "").trim();
        const alt = collapse(node.attribs.alt ?? "").trim();
        out += src ? `![${alt}](${src})` : alt;
        break;
      }
      case "span":
        out += inner();
        break;
      default:
        // 行内语境遇到块级:取其纯文本,避免结构丢失
        out += collapse(textOf(node));
    }
  }
  return out;
}

function renderList(el: Element, ordered: boolean, depth: number): string {
  const pad = "  ".repeat(depth);
  const lines: string[] = [];
  let index = 1;
  for (const li of children(el)) {
    if (!isElem(li) || li.tagName !== "li") continue;
    const nested: string[] = [];
    const parts: string[] = [];
    for (const child of children(li)) {
      if (isElem(child) && (child.tagName === "ul" || child.tagName === "ol")) {
        nested.push(renderList(child, child.tagName === "ol", depth + 1));
      } else if (isElem(child) && child.tagName === "p") {
        parts.push(inline(children(child)));
      } else {
        parts.push(inline([child]));
      }
    }
    const marker = ordered ? `${index}. ` : "- ";
    index++;
    lines.push(`${pad}${marker}${parts.filter(Boolean).join(" ").trim()}`);
    lines.push(...nested.filter(Boolean));
  }
  return lines.filter(Boolean).join("\n");
}

function collectRows(el: Element, out: Element[] = []): Element[] {
  for (const child of children(el)) {
    if (!isElem(child)) continue;
    if (child.tagName === "tr") out.push(child);
    else collectRows(child, out); // thead/tbody/tbody 递归下钻
  }
  return out;
}

function renderTable(el: Element): string {
  const rows: string[][] = [];
  for (const tr of collectRows(el)) {
    rows.push(
      [...tr.children]
        .filter((c): c is Element => isElem(c) && (c.tagName === "td" || c.tagName === "th"))
        .map((c) => inline(children(c)).trim().replace(/\|/g, "\\|")),
    );
  }
  if (rows.length === 0) return "";
  const width = Math.max(...rows.map((r) => r.length));
  const norm = rows.map((r) => [...r, ...Array<string>(width - r.length).fill("")]);
  const head = norm[0];
  const body = norm.slice(1);
  const line = (cells: string[]): string => `| ${cells.join(" | ")} |`;
  return [line(head), line(Array<string>(width).fill("---")), ...body.map(line)].join("\n");
}

/** 块级上下文:块间以空行分隔 */
function blocks(nodes: AnyNode[]): string[] {
  const out: string[] = [];
  for (const node of nodes) {
    if (node.type === "text") {
      const text = collapse((node as Text).data).trim();
      if (text) out.push(text);
      continue;
    }
    if (!isElem(node)) continue;
    switch (node.tagName) {
      case "p":
        out.push(inline(children(node)).trim());
        break;
      case "h1":
      case "h2":
      case "h3":
      case "h4":
      case "h5":
      case "h6":
        out.push(`${"#".repeat(HEADING_TAGS[node.tagName])} ${inline(children(node)).trim()}`);
        break;
      case "ul":
        out.push(renderList(node, false, 0));
        break;
      case "ol":
        out.push(renderList(node, true, 0));
        break;
      case "blockquote": {
        const innerBlocks = blocks(children(node)).join("\n\n");
        out.push(
          innerBlocks
            .split("\n")
            .map((l) => `> ${l}`.trimEnd())
            .join("\n"),
        );
        break;
      }
      case "pre": {
        const codeEl = children(node).find((c): c is Element => isElem(c) && c.tagName === "code");
        const cls = codeEl ? (codeEl.attribs.class ?? "") : "";
        const lang = /language-([\w-]+)/.exec(cls)?.[1] ?? "";
        out.push("```" + lang + "\n" + textOf(node).replace(/\n$/, "") + "\n```");
        break;
      }
      case "table":
        out.push(renderTable(node));
        break;
      case "figure":
      case "div":
      case "section":
      case "article":
        out.push(...blocks(children(node)));
        break;
      case "figcaption":
        out.push(`*${inline(children(node)).trim()}*`);
        break;
      case "hr":
        out.push("---");
        break;
      case "iframe": {
        const src = (node.attribs.src ?? "").trim();
        out.push(src ? `[嵌入视频](${src})` : "");
        break;
      }
      default: {
        // 其余标签(含行内标签出现在块级语境):降级为文本块
        const text = inline([node]).trim();
        if (text) out.push(text);
      }
    }
  }
  return out.filter((b) => b.trim().length > 0);
}

export function htmlToMarkdown(html: string): string {
  if (!html || !html.trim()) return "";
  // 正文是片段而非完整文档:isDocument=false,避免 parse5 补包 html/body 使根层只剩一个元素
  const $ = cheerio.load(html, undefined, false);
  const body = $.root().children().toArray() as Element[];
  return blocks(body).join("\n\n").trim() + "\n";
}
