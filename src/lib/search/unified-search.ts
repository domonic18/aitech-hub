/**
 * 三域统一检索 service(K1,arch/04 §3.2):资讯(telegram)/ 教程(content_post)/
 * 项目(github_repo)一次并发检索,合并分组返回。给人搜索 = 给智能体检索:
 * 同层供 K2 答案卡、K2.5 agent 工具与 K3 站点内容 MCP「搜索」工具,同源不漂移。
 *
 * 检索取向(2026-10-06 定稿):ILIKE 词项计分起步——DB 侧逐词 contains insensitive
 * (OR)取候选(publishedAt/stars 预排,candidate 上限截断),JS 侧加权计分重排
 * (title 3 > 摘要 2 > 正文 1,search-view)。零迁移零扩展;消费方 /search 与
 * answer 路由均 force-dynamic,构建期不执行,故不包 prerenderSafe。
 */
import { prisma } from "../db";
import { PUBLISHED } from "../content/posts";
import { TELEGRAM_AI_TERMINAL } from "../telegram/constants";
import { tokenizeQuery } from "./tokenize";
import {
  postScoreFields,
  rankAndCut,
  repoScoreFields,
  telegramScoreFields,
  toPostHit,
  toRepoHit,
  toTelegramHit,
  type PostRow,
  type RepoRow,
  type SearchHit,
  type SearchGroup,
  type TelegramRow,
  type UnifiedSearchResult,
} from "./search-view";

/** 每域候选上限(DB take,预排后 JS 计分重排;万行级表取新 50 条足够) */
export const CANDIDATE_LIMIT = 50;

/** 每组展示限量(原型同页三组纵排,组头 total 为库内全命中数) */
export const GROUP_LIMITS = { telegram: 6, post: 4, repo: 4 } as const;

/** K2 引用 snippet 截断长度(loadCitationBodies 出口) */
export const CITATION_SNIPPET_MAX = 300;

/**
 * 词项 × 字段 → Prisma OR contains insensitive 数组(纯函数,单测锚点)。
 * 空词项返回 [](Prisma OR:[] 零行,调用方 searchAll 已提前短路,防御用)。
 */
export function buildTermOr(terms: string[], fields: readonly string[]): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  for (const t of terms) {
    for (const f of fields) out.push({ [f]: { contains: t, mode: "insensitive" as const } });
  }
  return out;
}

function emptyGroup(domain: SearchGroup["domain"], meta: GroupMeta): SearchGroup {
  return {
    domain,
    label: meta.label,
    tagKey: meta.tagKey,
    total: 0,
    items: [],
    moreHref: meta.moreHref,
    moreLabel: meta.moreLabel,
  };
}

interface GroupMeta {
  label: string;
  tagKey: string;
  moreHref: string;
  moreLabel: string;
}

const GROUP_META = {
  telegram: {
    label: "资讯",
    tagKey: "TELEGRAMS",
    moreHref: "/telegram/",
    moreLabel: "进入电报流 →",
  },
  post: { label: "教程", tagKey: "ARTICLES", moreHref: "/articles/", moreLabel: "全部文章 →" },
  repo: { label: "项目", tagKey: "REPOS", moreHref: "/projects/", moreLabel: "全部项目 →" },
} as const satisfies Record<SearchGroup["domain"], GroupMeta>;

function emptyResult(q: string, terms: string[]): UnifiedSearchResult {
  return {
    q,
    terms,
    total: 0,
    groups: {
      telegram: emptyGroup("telegram", GROUP_META.telegram),
      post: emptyGroup("post", GROUP_META.post),
      repo: emptyGroup("repo", GROUP_META.repo),
    },
  };
}

/**
 * 三域并发检索:terms 为空直接返回空结果(不查库);每域 findMany(候选)+
 * count(组头 total)同事务快照。snippet 优先 AI 解读(aiSummary),正文大列
 * (contentMd/readmeMd)只作检索条件不取——K2 引用正文经 loadCitationBodies 单点补取。
 */
export async function searchAll(q: string): Promise<UnifiedSearchResult> {
  const terms = tokenizeQuery(q);
  if (terms.length === 0) return emptyResult(q, terms);

  const telegramWhere = {
    status: "visible",
    // 与公开读侧同口径:仅 AI 解读终态行可见(pending/failed 不上屏)
    aiStatus: { in: [...TELEGRAM_AI_TERMINAL] },
    OR: buildTermOr(terms, ["title", "summary", "aiSummary", "aiTopic"]),
  };
  const postWhere = { ...PUBLISHED, OR: buildTermOr(terms, ["title", "excerpt", "contentMd"]) };
  const repoWhere = {
    display: true,
    OR: buildTermOr(terms, ["fullName", "description", "readmeMd"]),
  };

  const [tgRes, postRes, repoRes] = await Promise.all([
    prisma.$transaction([
      prisma.telegram.findMany({
        where: telegramWhere,
        select: {
          id: true,
          title: true,
          summary: true,
          url: true,
          publishedAt: true,
          createdAt: true,
          mediaType: true,
          videoPlatform: true,
          videoBlogger: true,
          videoCoverUrl: true,
          videoDuration: true,
          videoEngagement: true,
          aiTopic: true,
          aiSummary: true,
          aiKeywords: true,
          source: { select: { name: true, type: true } },
        },
        orderBy: [{ publishedAt: { sort: "desc", nulls: "last" } }, { id: "desc" }],
        take: CANDIDATE_LIMIT,
      }),
      prisma.telegram.count({ where: telegramWhere }),
    ]),
    prisma.$transaction([
      prisma.post.findMany({
        where: postWhere,
        select: {
          id: true,
          slug: true,
          title: true,
          excerpt: true,
          viewsCount: true,
          publishedAt: true,
          tags: { select: { tag: { select: { name: true } } } },
        },
        orderBy: [{ publishedAt: "desc" }, { id: "desc" }],
        take: CANDIDATE_LIMIT,
      }),
      prisma.post.count({ where: postWhere }),
    ]),
    prisma.$transaction([
      prisma.githubRepo.findMany({
        where: repoWhere,
        select: {
          id: true,
          fullName: true,
          description: true,
          stars: true,
          language: true,
          topics: true,
          htmlUrl: true,
          updatedAt: true,
          _count: { select: { posts: true } },
        },
        orderBy: [{ updatedAt: "desc" }, { id: "asc" }],
        take: CANDIDATE_LIMIT,
      }),
      prisma.githubRepo.count({ where: repoWhere }),
    ]),
  ]);

  const telegramItems = rankAndCut<TelegramRow>(tgRes[0], terms, GROUP_LIMITS.telegram, (r) => ({
    ...telegramScoreFields(r),
    id: r.id.toString(),
    dateIso: (r.publishedAt ?? r.createdAt).toISOString(),
  })).map(toTelegramHit);
  const postItems = rankAndCut<PostRow>(postRes[0], terms, GROUP_LIMITS.post, (r) => ({
    ...postScoreFields(r),
    id: r.id.toString(),
    dateIso: r.publishedAt ? r.publishedAt.toISOString() : null,
  })).map(toPostHit);
  const repoItems = rankAndCut<RepoRow>(repoRes[0], terms, GROUP_LIMITS.repo, (r) => ({
    ...repoScoreFields(r),
    id: String(r.id),
    dateIso: r.updatedAt.toISOString(),
  })).map(toRepoHit);

  const groups = {
    telegram: {
      ...emptyGroup("telegram", GROUP_META.telegram),
      total: tgRes[1],
      items: telegramItems,
    },
    post: { ...emptyGroup("post", GROUP_META.post), total: postRes[1], items: postItems },
    repo: { ...emptyGroup("repo", GROUP_META.repo), total: repoRes[1], items: repoItems },
  };
  return { q, terms, total: tgRes[1] + postRes[1] + repoRes[1], groups };
}

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
 * K2 引用正文补取:仅对选中引用(picks)补取 contentMd/readmeMd 大字段,
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
