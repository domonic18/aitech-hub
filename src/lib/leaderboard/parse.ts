/**
 * 榜单解析(M58 批③,纯函数可单测):四类取数形态 → 统一入榜条目。
 * - Artificial Analysis:Next.js RSC flight 载荷里的 `initialModels` 数组
 *   (真机 2026-10-30 实测,静态 HTML 即可取,无需 headless);
 * - Hugging Face:公开 JSON API(sort=trendingScore);
 * - arXiv:Atom feed(export.arxiv.org 查询接口);
 * - GitHub Trending:服务端渲染 HTML 的 article.Box-row 卡片。
 * 只做格式转换——排序/截断/落库在 crawl.ts。解析出 0 条视为契约漂移,
 * 由上游计源失败(不静默空跑);原文已落快照可回溯。
 */
import { canonicalUrl, decodeHtmlEntities, stripHtml } from "../telegram/normalize";
import type { LeaderboardEntityType } from "./constants";
import type { LeaderboardItemMeta } from "./meta";

export interface LeaderboardItem {
  /** 稳定实体键(模型 id / arXiv id / owner-repo 形),跨日名次比较的锚 */
  entityKey: string;
  entityName: string;
  entityType: LeaderboardEntityType;
  /** 厂商/作者(展示用;未知为 null) */
  vendor: string | null;
  /** 榜单分值(名次榜可为 null) */
  score: number | null;
  scoreUnit: string | null;
  url: string;
  /** 展示用附加字段(M63):价格/上下文/摘要/作者/描述等,全部可选——
   * 上游载荷改版只丢展示,不空榜;落库经 meta.ts 白名单清洗 */
  extra?: LeaderboardItemMeta;
}

function absolute(base: string, href: string): string {
  try {
    return canonicalUrl(new URL(href, base).toString());
  } catch {
    return "";
  }
}

/** 去空键/去重(同键保留首条:榜内重复无意义,后者通常是变体) */
export function normalizeLeaderboardItems(items: LeaderboardItem[]): LeaderboardItem[] {
  const seen = new Set<string>();
  const out: LeaderboardItem[] = [];
  for (const it of items) {
    if (it.entityKey === "" || it.url === "" || seen.has(it.entityKey)) continue;
    seen.add(it.entityKey);
    out.push(it);
  }
  return out;
}

/** 合并 Next.js flight 分片:每片是 push([1,"<json 字符串>"]) 的字符串字面量,
 * 逐片 JSON.parse 还原后拼接,得到可检索的数据载荷文本 */
function joinFlightPayload(html: string): string {
  let out = "";
  for (const m of html.matchAll(/self\.__next_f\.push\(\[1,("(?:[^"\\]|\\.)*")\]\)/g)) {
    try {
      out += JSON.parse(m[1]) as string;
    } catch {
      // 单片损坏不影响其余(载荷本身是流式拼接,能取到多少算多少)
    }
  }
  return out;
}

/** 从载荷文本里截取 `"initialModels":[...]` 数组原文(方括号配平,字符串内的
 * 括号不计);取不到返回 null */
function sliceJsonArray(text: string, key: string): string | null {
  const marker = `"${key}":`;
  const at = text.indexOf(marker);
  if (at < 0) return null;
  const start = text.indexOf("[", at + marker.length);
  if (start < 0) return null;
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let p = start; p < text.length; p += 1) {
    const c = text[p];
    if (inStr) {
      if (esc) esc = false;
      else if (c === "\\") esc = true;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') inStr = true;
    else if (c === "[") depth += 1;
    else if (c === "]") {
      depth -= 1;
      if (depth === 0) return text.slice(start, p + 1);
    }
  }
  return null;
}

/** AA 榜单载荷的行字段(仅取用部分,多余字段忽略) */
interface AaModel {
  slug: string;
  name: string;
  modelCreatorName?: string | null;
  intelligenceIndex?: number | null;
  deprecated?: boolean;
  /** 以下为 M63 起取用的展示字段(真机实测存在,可为 null) */
  price1mInputTokens?: number | null;
  price1mOutputTokens?: number | null;
  contextWindowTokens?: number | null;
  isOpenWeights?: boolean | null;
  isReasoning?: boolean | null;
}

/** null/缺失统一折成 undefined(落库白名单只认已定义值) */
function opt<T>(v: T | null | undefined): T | undefined {
  return v === null || v === undefined ? undefined : v;
}

/** Artificial Analysis 智能指数榜:载荷里的 initialModels 按 intelligenceIndex
 * 倒序(未测评/已下线的模型跳过) */
export function parseArtificialAnalysis(html: string): LeaderboardItem[] {
  const raw = sliceJsonArray(joinFlightPayload(html), "initialModels");
  if (raw === null) return [];
  let models: unknown;
  try {
    models = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(models)) return [];
  const rows = (models as AaModel[])
    .filter(
      (m) =>
        typeof m.slug === "string" &&
        m.slug !== "" &&
        typeof m.name === "string" &&
        typeof m.intelligenceIndex === "number" &&
        Number.isFinite(m.intelligenceIndex) &&
        m.deprecated !== true,
    )
    .map((m) => ({ m, score: m.intelligenceIndex as number }))
    .sort((a, b) => b.score - a.score);
  return normalizeLeaderboardItems(
    rows.map(({ m, score }) => ({
      entityKey: m.slug,
      entityName: m.name,
      entityType: "model" as const,
      vendor: typeof m.modelCreatorName === "string" ? m.modelCreatorName : null,
      score,
      scoreUnit: "AAII",
      url: `https://artificialanalysis.ai/models/${m.slug}`,
      extra: {
        price1mInputTokens: opt(m.price1mInputTokens),
        price1mOutputTokens: opt(m.price1mOutputTokens),
        contextWindowTokens: opt(m.contextWindowTokens),
        isOpenWeights: opt(m.isOpenWeights),
        isReasoning: opt(m.isReasoning),
      },
    })),
  );
}

interface HfModel {
  id?: unknown;
  trendingScore?: unknown;
  downloads?: unknown;
  likes?: unknown;
  pipeline_tag?: unknown;
}

/** Hugging Face 趋势榜:公开 API JSON(sort=trendingScore 已按热度降序,
 * 仍本地重排防接口口径变动);厂商取仓库命名空间 */
export function parseHuggingFace(json: string): LeaderboardItem[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  const rows = (parsed as HfModel[])
    .map((m) => {
      const id = typeof m.id === "string" ? m.id : "";
      const score = typeof m.trendingScore === "number" ? m.trendingScore : null;
      return { m, id, score };
    })
    .filter((r) => r.id !== "" && r.score !== null)
    .sort((a, b) => (b.score as number) - (a.score as number));
  return normalizeLeaderboardItems(
    rows.map(({ m, id, score }) => ({
      entityKey: id,
      entityName: id,
      entityType: "model" as const,
      vendor: id.includes("/") ? id.slice(0, id.indexOf("/")) : null,
      score,
      scoreUnit: "trending",
      url: `https://huggingface.co/${id}`,
      extra: {
        downloads: typeof m.downloads === "number" ? m.downloads : undefined,
        likes: typeof m.likes === "number" ? m.likes : undefined,
        pipelineTag: typeof m.pipeline_tag === "string" ? m.pipeline_tag : undefined,
      },
    })),
  );
}

/** 文本清洗:去标签 → 解实体 → 折叠换行/多空格(Atom 的 summary 是硬换行成段) */
function collapse(raw: string): string {
  return decodeHtmlEntities(stripHtml(raw)).replace(/\s+/g, " ").trim();
}

/** arXiv Atom feed:按提交时间倒序的最新论文(无热度分值,名次即时间序)。
 * M63 起同取摘要/作者/提交日/分类(全部可选,缺了照常入榜) */
export function parseArxivFeed(xml: string, baseUrl: string): LeaderboardItem[] {
  const items: LeaderboardItem[] = [];
  for (const m of xml.matchAll(/<entry>([\s\S]*?)<\/entry>/g)) {
    const block = m[1];
    const idText = stripHtml(/<id>([\s\S]*?)<\/id>/.exec(block)?.[1] ?? "");
    const title = collapse(/<title>([\s\S]*?)<\/title>/.exec(block)?.[1] ?? "");
    const entityKey = idText.slice(idText.lastIndexOf("/") + 1);
    if (entityKey === "" || title === "") continue;
    const authors: string[] = [];
    for (const a of block.matchAll(/<author>([\s\S]*?)<\/author>/g)) {
      const name = collapse(/<name>([\s\S]*?)<\/name>/.exec(a[1])?.[1] ?? "");
      if (name !== "" && !authors.includes(name)) authors.push(name);
    }
    const categories: string[] = [];
    for (const c of block.matchAll(/<category[^>]*\bterm="([^"]+)"/g)) {
      if (c[1] !== undefined && !categories.includes(c[1])) categories.push(c[1]);
    }
    // <published> 是完整 ISO 时间串,只留日期语义(公开页按日展示)
    const published = collapse(/<published>([\s\S]*?)<\/published>/.exec(block)?.[1] ?? "");
    const summary = collapse(/<summary>([\s\S]*?)<\/summary>/.exec(block)?.[1] ?? "");
    items.push({
      entityKey,
      entityName: title,
      entityType: "paper",
      vendor: null,
      score: null,
      scoreUnit: null,
      // 入口 id 真机为 http://arxiv.org/abs/<id>v<n>(2026-10-30 实测):统一升
      // https,export.arxiv.org 变体一并归到用户可访问域
      url: absolute(
        baseUrl,
        idText
          .replace("export.arxiv.org", "arxiv.org")
          .replace(/^http:\/\/arxiv\.org\//, "https://arxiv.org/"),
      ),
      extra: {
        summary: summary === "" ? undefined : summary,
        authors: authors.length === 0 ? undefined : authors,
        publishedAt: /^\d{4}-\d{2}-\d{2}/.test(published) ? published.slice(0, 10) : undefined,
        categories: categories.length === 0 ? undefined : categories,
      },
    });
  }
  return normalizeLeaderboardItems(items);
}

/** 链接内数字(星标/分叉):去标签后取首个数字串,逗号千分位还原 */
function countOf(html: string | undefined): number | undefined {
  if (html === undefined) return undefined;
  const m = /([\d,]+)/.exec(stripHtml(html));
  if (m === null) return undefined;
  const n = Number(m[1].replace(/,/g, ""));
  return Number.isFinite(n) ? n : undefined;
}

/** GitHub Trending 日榜:article.Box-row 卡片,h2 链接取 owner/repo,
 * 「N stars today」作热度分;日榜顺序即名次。M63 起同取描述/语言/总星/分叉 */
export function parseGithubTrending(html: string, baseUrl: string): LeaderboardItem[] {
  const items: LeaderboardItem[] = [];
  for (const chunk of html.split('<article class="Box-row"').slice(1)) {
    const h2 = /<h2[^>]*>([\s\S]*?)<\/h2>/.exec(chunk)?.[1];
    if (h2 === undefined) continue;
    const href = /href="([^"]+)"/.exec(h2)?.[1];
    if (href === undefined) continue;
    const url = absolute(baseUrl, href);
    const key = url.replace(/^https?:\/\/github\.com\//, "").replace(/\/$/, "");
    if (key === "" || !key.includes("/")) continue;
    const starsText = /float-sm-right[^>]*>([\s\S]*?)<\/span>/.exec(chunk)?.[1] ?? "";
    const stars = /([\d,]+)\s+stars today/.exec(stripHtml(starsText))?.[1];
    // 注意 <p\b:裸 <p 会把 <path d="…"> 的 SVG 路径当成描述(真机 2026-10-31 踩过)
    const description = collapse(/<p\b[^>]*>([\s\S]*?)<\/p>/.exec(chunk)?.[1] ?? "");
    const language = collapse(
      /itemprop="programmingLanguage"[^>]*>([\s\S]*?)<\/span>/.exec(chunk)?.[1] ?? "",
    );
    items.push({
      entityKey: key,
      // h2 里的锚文本是「owner / repo」(带 <span> 包裹的斜杠),折叠回 owner/repo
      entityName: decodeHtmlEntities(stripHtml(h2)).replace(/\s*\/\s*/g, "/"),
      entityType: "repo",
      vendor: key.slice(0, key.indexOf("/")),
      score: stars === undefined ? null : Number(stars.replace(/,/g, "")),
      scoreUnit: stars === undefined ? null : "stars/日",
      url,
      extra: {
        description: description === "" ? undefined : description,
        language: language === "" ? undefined : language,
        stars: countOf(/href="[^"]*\/stargazers"[^>]*>([\s\S]*?)<\/a>/.exec(chunk)?.[1]),
        forks: countOf(/href="[^"]*\/forks"[^>]*>([\s\S]*?)<\/a>/.exec(chunk)?.[1]),
      },
    });
  }
  return normalizeLeaderboardItems(items);
}
