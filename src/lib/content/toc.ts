import type { Root, RootContent } from "hast";
import GithubSlugger from "github-slugger";
import rehypeRaw from "rehype-raw";
import rehypeSlug from "rehype-slug";
import remarkGfm from "remark-gfm";
import remarkParse from "remark-parse";
import remarkRehype from "remark-rehype";
import { unified } from "unified";
import { visit } from "unist-util-visit";

/**
 * 文章目录(TOC)取数:纯函数、零 IO,构建期与请求期都能跑。
 *
 * 两条渲染链对应两套锚点策略,且必须与 `ArticleBody` 实际产出的 heading id 一致:
 *  - content_md(新文):react-markdown 的 pipeline 是 remark-parse → remark-rehype
 *    (allowDangerousHtml)→ rehype-raw → highlight → sanitize → rehype-slug。这里复刻
 *    同一前缀(parse → rehype-raw → rehype-slug)后收集 id;highlight/sanitize 不改
 *    heading 文本与顺序,故 id 必然一致。注意 slug 必须排在 sanitize **之后**:
 *    hast-util-sanitize 的 clobber(id) + clobberPrefix 会把 id 改写成 `user-content-<slug>`。
 *  - content_html(154 篇迁移旧文):入库清洗已剥离 heading id,且不能重新序列化
 *    (旧文保真)。这里只在原始字符串的 <h2>/<h3> 开标签上注入 id,正文其余字节不动。
 *
 * 目录层级取 H2–H3(行业主流,见 docs/arch/07-frontend §1);H1 是文章大标题本身,
 * H4 起过碎。改层级只动 `TOC_MAX_LEVEL`。
 */

export const TOC_MIN_LEVEL = 2;
export const TOC_MAX_LEVEL = 3;

export interface TocItem {
  /** 与正文 heading 的 id 完全一致(可直接拼 `#` 锚点) */
  id: string;
  text: string;
  level: 2 | 3;
}

/** md 侧:与 ArticleBody 同款前缀 pipeline;slug 后置,id 不带 sanitize 前缀 */
const mdTocProcessor = unified()
  .use(remarkParse)
  .use(remarkGfm)
  .use(remarkRehype, { allowDangerousHtml: true })
  .use(rehypeRaw)
  .use(rehypeSlug);

/** hast 节点文本(标题里可能有行内代码/加粗/链接) */
function hastText(node: RootContent): string {
  if (node.type === "text") return node.value;
  if ("children" in node) return node.children.map(hastText).join("");
  return "";
}

function collectFromHast(tree: Root): TocItem[] {
  const items: TocItem[] = [];
  visit(tree, "element", (node) => {
    const level = Number(node.tagName.slice(1));
    if (!node.tagName.startsWith("h") || Number.isNaN(level)) return;
    if (level < TOC_MIN_LEVEL || level > TOC_MAX_LEVEL) return;
    const id = typeof node.properties?.id === "string" ? node.properties.id : "";
    const text = hastText(node).replace(/\s+/g, " ").trim();
    if (!id || !text) return;
    items.push({ id, text, level: level as 2 | 3 });
  });
  return items;
}

/** markdown 正文 → 目录(与 react-markdown 渲染出的 heading id 一致) */
export function buildTocFromMarkdown(md: string): TocItem[] {
  if (!md.trim()) return [];
  try {
    const tree = mdTocProcessor.runSync(mdTocProcessor.parse(md)) as Root;
    return collectFromHast(tree);
  } catch {
    // 目录是增强项:解析异常不得连累正文/整页渲染
    return [];
  }
}

const HEADING_RE = /<h([23])(\s[^>]*)?>([\s\S]*?)<\/h\1>/gi;
const ID_ATTR_RE = /\s+id\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/i;

/** 旧 HTML 的标题文本(去标签 + 解常见实体;slug 只关心可见文字) */
function headingText(inner: string): string {
  return inner
    .replace(/<[^>]*>/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&amp;/gi, "&")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * content_html → 注入 id 的 html + 目录(按文档顺序用同一个 slugger 去重,
 * 与 rehype-slug 的 `-1` 后缀口径一致)。重复调用结果幂等:已有 id 会被
 * 重新生成同样的 slug,不会叠加。
 */
export function injectHeadingIds(html: string): { html: string; toc: TocItem[] } {
  const slugger = new GithubSlugger();
  const toc: TocItem[] = [];
  const out = html.replace(
    HEADING_RE,
    (_match, level: string, attrs: string | undefined, inner: string) => {
      const text = headingText(inner);
      const slug = text ? slugger.slug(text) : "";
      const cleanAttrs = (attrs ?? "").replace(ID_ATTR_RE, "");
      if (slug && (level === "2" || level === "3")) {
        toc.push({ id: slug, text, level: level === "2" ? 2 : 3 });
        return `<h${level} id="${slug}"${cleanAttrs}>${inner}</h${level}>`;
      }
      return `<h${level}${cleanAttrs}>${inner}</h${level}>`;
    },
  );
  return { html: out, toc };
}

/**
 * 文章页唯一出口:优先 md(含门禁文的预览 md),否则旧 HTML。
 * 门禁文只能按用户实际可见的预览取目录——解锁后全文由 PayGateCard 客户端渲染,
 * 目录不随之后追加(已知取舍,与 M21 门禁口径一致)。
 * 返回的 contentHtml 仅供本页透传给 ArticleBody,库内原值不动。
 */
export function buildPostToc(input: {
  contentMd?: string | null;
  contentHtml?: string | null;
  /** 门禁文:传实际下发的截断预览 */
  previewMd?: string;
}): { toc: TocItem[]; contentHtml?: string } {
  if (input.previewMd !== undefined) return { toc: buildTocFromMarkdown(input.previewMd) };
  if (input.contentMd) return { toc: buildTocFromMarkdown(input.contentMd) };
  if (input.contentHtml) {
    const { html, toc } = injectHeadingIds(input.contentHtml);
    return { toc, contentHtml: html };
  }
  return { toc: [] };
}
