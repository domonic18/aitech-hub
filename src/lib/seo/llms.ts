/**
 * GEO 内容面构造(requirement §3.2 智能体可见性):
 *  - buildLlmsIndex:站点结构的 AI 目录(llms.txt,标题 + 链接 + 一句话摘要,分节同 sitemap);
 *  - buildLlmsFullParts:全量文章 Markdown 拼合,按字符上限分页(llms-full-N.txt,arch/07-frontend §3)。
 * 纯构造,Route Handler(ISR 1h)调用;md 来源:content_md 优先,旧文由清洗后 HTML 转换。
 */
import { getSiteTitle } from "@/lib/config/site-config";
import { htmlToMarkdown } from "@/lib/content/html-to-md";
import { excerptOf } from "@/lib/content/format";
import { listAllPostsForSeo } from "@/lib/content/posts";
import { postPath } from "@/lib/content/post-path";
import { listShowcaseRepos } from "@/lib/github/public";
import { projectPath } from "@/lib/github/project-path";
import { formatCnDate } from "@/lib/datetime";
import { absoluteUrl } from "@/lib/seo/site";

const PART_MAX_CHARS = 400_000;

function postMarkdown(p: {
  id: bigint;
  slug: string | null;
  title: string;
  contentMd: string | null;
  contentHtml: string | null;
  publishedAt: Date | null;
}): string {
  const body = p.contentMd ?? (p.contentHtml ? htmlToMarkdown(p.contentHtml) : "");
  const meta = [
    `URL: ${absoluteUrl(postPath(p.id, p.slug))}`,
    p.publishedAt ? `发布: ${formatCnDate(p.publishedAt)}` : null,
  ]
    .filter(Boolean)
    .join(" | ");
  return `# ${p.title}\n\n${meta}\n\n${body.trim()}`;
}

export async function buildLlmsIndex(): Promise<string> {
  const [posts, categories, tags, repos] = await Promise.all([
    listAllPostsForSeo(),
    import("@/lib/content/taxonomy").then((m) => m.listCategories()),
    import("@/lib/content/taxonomy").then((m) => m.listTagsWithCount()),
    listShowcaseRepos(),
  ]);

  const siteTitle = await getSiteTitle();
  const lines: string[] = [
    `# ${siteTitle}(17aitech.com)`,
    "",
    "> domonic18 的 AI 工程实战原创博客:第一人称、可复现(含失败案例)的人机协同实战记录,主题覆盖 Claude Code / MCP / LLM 训练与评测。文章同时为人与智能体而写:每篇均可在 URL 后加 .md 获取 Markdown 原文;全量内容见 /llms-full.txt(超长分页 llms-full-2.txt 起)。",
    "",
    "## 站点",
    "",
    `- [首页](${absoluteUrl("/")})`,
    `- [全部文章](${absoluteUrl("/articles/")})`,
    `- [开源项目](${absoluteUrl("/projects/")})`,
    `- [归档](${absoluteUrl("/archive/")})`,
    `- [关于](${absoluteUrl("/about/")})`,
    `- [用户协议](${absoluteUrl("/agreement/")})`,
    `- [隐私政策](${absoluteUrl("/privacy/")})`,
    "",
    "## 分类",
    "",
    ...categories.map((c) => `- [${c.name}](${absoluteUrl(`/category/${c.slug}/`)})`),
    "",
    "## 标签",
    "",
    ...tags.map((t) => `- [${t.name}](${absoluteUrl(`/tag/${t.slug}/`)})`),
    "",
    "## 开源项目",
    "",
    ...repos.map((r) => {
      const summary = r.description ? `: ${r.description.replace(/\s+/g, " ").slice(0, 80)}` : "";
      return `- [${r.fullName}](${absoluteUrl(projectPath(r.slug))})${summary}`;
    }),
    "",
    "## 文章",
    "",
  ];
  for (const p of posts) {
    const summary = excerptOf(p).replace(/\s+/g, " ").slice(0, 80);
    lines.push(
      `- [${p.title}](${absoluteUrl(postPath(p.id, p.slug))})${summary ? `: ${summary}` : ""}`,
    );
  }
  return lines.join("\n") + "\n";
}

export async function buildLlmsFullParts(): Promise<string[]> {
  const [posts, siteTitle] = await Promise.all([listAllPostsForSeo(), getSiteTitle()]);
  const sections = posts.map(postMarkdown);
  const parts: string[] = [];
  let current: string[] = [];
  let size = 0;
  for (const section of sections) {
    const len = section.length + 4; // "\n\n---\n\n" 分隔
    if (current.length > 0 && size + len > PART_MAX_CHARS) {
      parts.push(current.join("\n\n---\n\n"));
      current = [];
      size = 0;
    }
    current.push(section);
    size += len;
  }
  if (current.length > 0) parts.push(current.join("\n\n---\n\n"));
  const moreList = Array.from(
    { length: Math.max(0, parts.length - 1) },
    (_, i) => `/llms-full-${i + 2}.txt`,
  ).join("、");
  return parts.map((body, i) => {
    const head =
      i === 0
        ? `# ${siteTitle} · 全量文章内容(第 1/${parts.length} 部分)\n${moreList ? `后续部分:${moreList}\n` : "\n"}\n`
        : `# ${siteTitle} · 全量文章内容(第 ${i + 1}/${parts.length} 部分)\n\n`;
    return head + body + "\n";
  });
}
