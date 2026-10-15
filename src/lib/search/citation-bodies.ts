/**
 * K2 引用正文补取(技术债批⑤ 自 unified-search 拆出):答案卡选中引用的
 * contentMd/readmeMd 大字段单点补取与 snippet 截断。
 */
import { prisma } from "../db";
import { PUBLISHED } from "../content/posts";
import type { SearchHit } from "./search-view";

/** K2 引用 snippet 截断长度(出口,answer-prompt 回落 snippet 同口径再截) */
export const CITATION_SNIPPET_MAX = 300;

/** markdown 首段提取:剥 frontmatter/标题行/引用块,取首个非空段落 */
function firstMarkdownParagraph(md: string): string {
  const body = md.replace(/^---\n[\s\S]*?\n---\n/, "");
  for (const para of body.split(/\n{2,}/)) {
    const line = para
      .split("\n")
      .filter((l) => !/^(#{1,6}\s|>|\s*[-*+]\s|\s*\d+\.\s)/.test(l.trim()))
      .join(" ")
      .trim();
    if (line !== "") return line;
  }
  return "";
}

/**
 * 仅对选中引用(picks)补取 contentMd/readmeMd 大字段,
 * 截 CITATION_SNIPPET_MAX(首段优先,空回落 excerpt/description)。
 * 键 `${domain}:${id}` 与 SearchHit.id 对齐。
 */
export async function loadCitationBodies(
  picks: readonly SearchHit[],
): Promise<Map<string, string>> {
  const postIds = picks.filter((p) => p.domain === "post").map((p) => BigInt(p.id));
  const repoIds = picks.filter((p) => p.domain === "repo").map((p) => Number(p.id));
  const [posts, repos] = await Promise.all([
    postIds.length > 0
      ? prisma.post.findMany({
          where: { id: { in: postIds }, ...PUBLISHED },
          select: { id: true, excerpt: true, contentMd: true },
        })
      : Promise.resolve([]),
    repoIds.length > 0
      ? prisma.githubRepo.findMany({
          where: { id: { in: repoIds } },
          select: { id: true, description: true, readmeMd: true },
        })
      : Promise.resolve([]),
  ]);
  const map = new Map<string, string>();
  const put = (key: string, text: string | null): void => {
    const t = (text ?? "").trim();
    if (t !== "") map.set(key, t.slice(0, CITATION_SNIPPET_MAX));
  };
  for (const p of posts) {
    put(`post:${p.id.toString()}`, firstMarkdownParagraph(p.contentMd ?? "") || p.excerpt);
  }
  for (const r of repos) {
    put(`repo:${r.id}`, firstMarkdownParagraph(r.readmeMd ?? "") || r.description);
  }
  return map;
}
