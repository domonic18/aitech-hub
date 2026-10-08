/**
 * 三域统一检索 service(K1/M20,arch/04 §3.2):资讯(telegram)/ 教程(content_post)/
 * 项目(github_repo)一次并发检索,合并分组返回。给人搜索 = 给智能体检索:
 * 同层供 K2 答案卡、K2.5 agent 工具与 K3 站点内容 MCP「搜索」工具,同源不漂移。
 *
 * 检索取向(M20 混合检索,2026-10-08 定稿):词项层 DB 逐词 contains insensitive
 * (OR)取候选 + JS 加权计分重排(title 3 > 摘要 2 > 正文 1,search-view);
 * 语义层查询向量化(query-embedding)→ pgvector 余弦召回(HNSW 分部索引);
 * 两榜 RRF 融合(k=60,词法证据 tiebreak,fuseDomain)。embedding 未绑定或调用
 * 失败 → 语义层整体降级,结果与单榜逐字节一致。消费方 /search 与 answer 路由均
 * force-dynamic,构建期不执行,故不包 prerenderSafe。
 */
import { prisma } from "../db";
import { PUBLISHED } from "../content/posts";
import { TELEGRAM_AI_TERMINAL } from "../telegram/constants";
import { topVectorMatches, type VectorMatch } from "./embedding-repo";
import { embedQueryForSearch } from "./query-embedding";
import { tokenizeQuery } from "./tokenize";
import {
  fuseCompare,
  postScoreFields,
  rankAndCut,
  repoScoreFields,
  telegramScoreFields,
  toPostHit,
  toRepoHit,
  toTelegramHit,
  VECTOR_RECALL_LIMIT,
  scoreTerms,
  type PostRow,
  type RepoRow,
  type RankedFields,
  type ScoreFields,
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

/**
 * 单域双榜融合(M20,fetchSemanticRows 注入便于单测):词项候选 rankAndCut 全量
 * 排名(CANDIDATE_LIMIT)→ 向量榜剔除词项命中后,纯语义 id 按"同可见性条件"
 * 补取源行 → RRF 融合重排(fuseCompare)→ 截组限量。降级(vectorTop=null)时候选
 * 仅词项榜且 RRF 严格随排名递减,序与单榜一致(行为不回归)。extraTotal = 语义
 * 补召仍可见条数(并入组头 total;上限向量榜 VECTOR_RECALL_LIMIT 内)。
 */
export async function fuseDomain<Row, Hit extends { id: string; semanticOnly?: boolean }>(args: {
  keywordRows: Row[];
  vectorTop: VectorMatch[] | null;
  terms: string[];
  limit: number;
  fieldOf: (r: Row) => ScoreFields & RankedFields;
  toHit: (r: Row & { hitPct: number }) => Hit;
  fetchSemanticRows: (ids: bigint[]) => Promise<Row[]>;
}): Promise<{ items: Hit[]; extraTotal: number }> {
  const { keywordRows, vectorTop, terms, limit, fieldOf, toHit, fetchSemanticRows } = args;
  const ranked = rankAndCut(keywordRows, terms, CANDIDATE_LIMIT, fieldOf);
  const vecRankById = new Map((vectorTop ?? []).map((m, i) => [m.entityId.toString(), i] as const));
  const scored = ranked.map((row, kwRank) => {
    const f = fieldOf(row);
    return {
      row,
      hitPct: row.hitPct,
      id: f.id,
      kwRank,
      vecRank: vecRankById.get(f.id) ?? null,
      kwScore: scoreTerms(terms, f).score,
      date: f.dateIso ? Date.parse(f.dateIso) : 0,
    };
  });

  // 纯语义 id(向量榜有、词项榜无;保距降序)→ 补取源行(已下架/隐藏自然缺位)
  const kwIdSet = new Set(scored.map((c) => c.id));
  const semanticIds = (vectorTop ?? [])
    .filter((m) => !kwIdSet.has(m.entityId.toString()))
    .map((m) => m.entityId);
  const semanticRows = semanticIds.length > 0 ? await fetchSemanticRows(semanticIds) : [];
  const semantic = semanticRows.map((row) => {
    const f = fieldOf(row);
    return {
      row,
      hitPct: 0, // 语义命中不显百分比(UI 以「语义匹配」标替代)
      id: f.id,
      kwRank: null,
      vecRank: vecRankById.get(f.id) ?? null,
      kwScore: scoreTerms(terms, f).score, // 仅作词法证据 tiebreak
      date: f.dateIso ? Date.parse(f.dateIso) : 0,
    };
  });

  const candidates = [...scored, ...semantic];
  candidates.sort((a, b) => fuseCompare(a, b));
  return {
    items: candidates.slice(0, limit).map((c) => {
      const hit = toHit({ ...c.row, hitPct: c.hitPct });
      if (c.kwRank === null) hit.semanticOnly = true;
      return hit;
    }),
    extraTotal: semanticRows.length,
  };
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
 * 三域并发检索:terms 为空直接返回空结果(不查库);词项层每域 findMany(候选)+
 * count(库内命中数)同事务快照,语义层查询向量化后三域向量榜并发同取。
 * snippet 优先 AI 解读(aiSummary),正文大列(contentMd/readmeMd)只作检索条件
 * 不取——K2 引用正文经 loadCitationBodies 单点补取。组头 total = 库内词项命中数
 * + 语义补召可见数。
 */
export async function searchAll(q: string): Promise<UnifiedSearchResult> {
  const terms = tokenizeQuery(q);
  if (terms.length === 0) return emptyResult(q, terms);

  // 语义层先决:查询向量化(未绑定/失败 → null,双榜退化单榜,行为不回归)
  const vector = await embedQueryForSearch(q);

  // 可见性条件与词项条件分离:词项 findMany 带 OR,纯语义 id 补取只带可见性
  const telegramVisible = {
    status: "visible",
    // 与公开读侧同口径:仅 AI 解读终态行可见(pending/failed 不上屏)
    aiStatus: { in: [...TELEGRAM_AI_TERMINAL] },
  };
  const telegramWhere = {
    ...telegramVisible,
    OR: buildTermOr(terms, ["title", "summary", "aiSummary", "aiTopic"]),
  };
  const postWhere = { ...PUBLISHED, OR: buildTermOr(terms, ["title", "excerpt", "contentMd"]) };
  const repoWhere = {
    display: true,
    OR: buildTermOr(terms, ["fullName", "description", "readmeMd"]),
  };

  const tgSelect = {
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
  } as const;
  const postSelect = {
    id: true,
    slug: true,
    title: true,
    excerpt: true,
    viewsCount: true,
    publishedAt: true,
    tags: { select: { tag: { select: { name: true } } } },
  } as const;
  const repoSelect = {
    id: true,
    fullName: true,
    description: true,
    stars: true,
    language: true,
    topics: true,
    htmlUrl: true,
    updatedAt: true,
    _count: { select: { posts: true } },
  } as const;

  const [tgRes, postRes, repoRes, tgVec, postVec, repoVec] = await Promise.all([
    prisma.$transaction([
      prisma.telegram.findMany({
        where: telegramWhere,
        select: tgSelect,
        orderBy: [{ publishedAt: { sort: "desc", nulls: "last" } }, { id: "desc" }],
        take: CANDIDATE_LIMIT,
      }),
      prisma.telegram.count({ where: telegramWhere }),
    ]),
    prisma.$transaction([
      prisma.post.findMany({
        where: postWhere,
        select: postSelect,
        orderBy: [{ publishedAt: "desc" }, { id: "desc" }],
        take: CANDIDATE_LIMIT,
      }),
      prisma.post.count({ where: postWhere }),
    ]),
    prisma.$transaction([
      prisma.githubRepo.findMany({
        where: repoWhere,
        select: repoSelect,
        orderBy: [{ updatedAt: "desc" }, { id: "asc" }],
        take: CANDIDATE_LIMIT,
      }),
      prisma.githubRepo.count({ where: repoWhere }),
    ]),
    vector ? topVectorMatches("telegram", vector, VECTOR_RECALL_LIMIT) : Promise.resolve(null),
    vector ? topVectorMatches("post", vector, VECTOR_RECALL_LIMIT) : Promise.resolve(null),
    vector ? topVectorMatches("repo", vector, VECTOR_RECALL_LIMIT) : Promise.resolve(null),
  ]);

  const [tgFuse, postFuse, repoFuse] = await Promise.all([
    fuseDomain<TelegramRow, Awaited<ReturnType<typeof toTelegramHit>>>({
      keywordRows: tgRes[0],
      vectorTop: tgVec,
      terms,
      limit: GROUP_LIMITS.telegram,
      fieldOf: (r) => ({
        ...telegramScoreFields(r),
        id: r.id.toString(),
        dateIso: (r.publishedAt ?? r.createdAt).toISOString(),
      }),
      toHit: toTelegramHit,
      fetchSemanticRows: (ids) =>
        prisma.telegram.findMany({
          where: { ...telegramVisible, id: { in: ids } },
          select: tgSelect,
        }),
    }),
    fuseDomain<PostRow, Awaited<ReturnType<typeof toPostHit>>>({
      keywordRows: postRes[0],
      vectorTop: postVec,
      terms,
      limit: GROUP_LIMITS.post,
      fieldOf: (r) => ({
        ...postScoreFields(r),
        id: r.id.toString(),
        dateIso: r.publishedAt ? r.publishedAt.toISOString() : null,
      }),
      toHit: toPostHit,
      fetchSemanticRows: (ids) =>
        prisma.post.findMany({
          where: { ...PUBLISHED, id: { in: ids } },
          select: postSelect,
        }),
    }),
    fuseDomain<RepoRow, Awaited<ReturnType<typeof toRepoHit>>>({
      keywordRows: repoRes[0],
      vectorTop: repoVec,
      terms,
      limit: GROUP_LIMITS.repo,
      fieldOf: (r) => ({
        ...repoScoreFields(r),
        id: String(r.id),
        dateIso: r.updatedAt.toISOString(),
      }),
      toHit: toRepoHit,
      fetchSemanticRows: (ids) =>
        prisma.githubRepo.findMany({
          // repo.id Int,向量表侧 entity_id bigint
          where: { display: true, id: { in: ids.map(Number) } },
          select: repoSelect,
        }),
    }),
  ]);

  const groups = {
    telegram: {
      ...emptyGroup("telegram", GROUP_META.telegram),
      total: tgRes[1] + tgFuse.extraTotal,
      items: tgFuse.items,
    },
    post: {
      ...emptyGroup("post", GROUP_META.post),
      total: postRes[1] + postFuse.extraTotal,
      items: postFuse.items,
    },
    repo: {
      ...emptyGroup("repo", GROUP_META.repo),
      total: repoRes[1] + repoFuse.extraTotal,
      items: repoFuse.items,
    },
  };
  return {
    q,
    terms,
    total:
      tgRes[1] +
      postRes[1] +
      repoRes[1] +
      tgFuse.extraTotal +
      postFuse.extraTotal +
      repoFuse.extraTotal,
    groups,
  };
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
