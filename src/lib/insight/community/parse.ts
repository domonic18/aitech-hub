/**
 * 社区需求语料解析(M58 批④,纯函数可单测):四类公开接口 → 统一入池条目。
 * - Hacker News:Algolia `search_by_date` JSON(hits[]);
 * - V2EX:`/api/topics/show.json` 节点主题数组;
 * - 百度下拉:`suggestion.baidu.com/su` 的 JSONP(GB18030 已由取数层解码);
 * - GitHub Issues:公开 REST 数组(PR 混在 issues 接口里,须剔除)。
 * 只做格式转换与源内筛(窗口/类别);L0 准入在 ../l0,入池在 ../ingest。
 * 解析出 0 条视为契约漂移,由编排层计源失败(不静默空跑)。
 */
import { createHash } from "node:crypto";

import { COMMUNITY_OSS_BODY_MAX, COMMUNITY_OSS_WINDOW_DAYS } from "./constants";

export interface CommunityItem {
  /** 源内幂等锚(hn:<objectID> / v2ex:<id> / bd:<sha1> / <repo>#<n>) */
  refId: string;
  /** 入池文本(归一/截断由 ingest 统一收口) */
  text: string;
  url: string;
  /** 信号发生时间(接口给不出时为 null,编排层落采集时刻) */
  signalAt: Date | null;
  /** 逐条语言覆盖(混合源用;缺省取源级声明) */
  lang?: "zh" | "en";
  meta: Record<string, unknown>;
}

function parseJson(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function asString(v: unknown): string {
  return typeof v === "string" ? v : "";
}

function asNumber(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

interface HnHit {
  objectID?: unknown;
  title?: unknown;
  url?: unknown;
  author?: unknown;
  created_at_i?: unknown;
  points?: unknown;
  num_comments?: unknown;
}

/** Hacker News(Algolia):标题 + 讨论链接(Ask HN 无外链时回退讨论页) */
export function parseHackerNews(raw: string): CommunityItem[] {
  const data = parseJson(raw);
  const hits = (data as { hits?: unknown } | null)?.hits;
  if (!Array.isArray(hits)) return [];
  const items: CommunityItem[] = [];
  for (const hit of hits as HnHit[]) {
    const objectID = asString(hit.objectID);
    const title = asString(hit.title).trim();
    if (objectID === "" || title === "") continue;
    const created = asNumber(hit.created_at_i);
    items.push({
      refId: `hn:${objectID}`,
      text: title,
      url:
        asString(hit.url) !== ""
          ? asString(hit.url)
          : `https://news.ycombinator.com/item?id=${objectID}`,
      signalAt: created === null ? null : new Date(created * 1000),
      lang: "en",
      meta: {
        points: asNumber(hit.points),
        comments: asNumber(hit.num_comments),
        author: asString(hit.author),
      },
    });
  }
  return items;
}

interface V2exTopic {
  id?: unknown;
  title?: unknown;
  created?: unknown;
  replies?: unknown;
  node?: { name?: unknown; title?: unknown } | null;
}

/** V2EX 节点主题:标题即需求原话,回复数作热度参考 */
export function parseV2ex(raw: string): CommunityItem[] {
  const data = parseJson(raw);
  if (!Array.isArray(data)) return [];
  const items: CommunityItem[] = [];
  for (const topic of data as V2exTopic[]) {
    const id = asNumber(topic.id);
    const title = asString(topic.title).trim();
    if (id === null || title === "") continue;
    const created = asNumber(topic.created);
    const nodeName = asString(topic.node?.name);
    items.push({
      refId: `v2ex:${id}`,
      text: title,
      url: `https://www.v2ex.com/t/${id}`,
      signalAt: created === null ? null : new Date(created * 1000),
      lang: "zh",
      meta: {
        replies: asNumber(topic.replies),
        node: nodeName,
        nodeTitle: asString(topic.node?.title),
      },
    });
  }
  return items;
}

/** 百度下拉载荷不是合法 JSON(键未加引号,实测 `cb({q:"…",p:true,s:[…]})`),
 * 故不做整体 JSON.parse:从 `s:` 处起做括号配对扫描,只对词条数组本身按
 * JSON 解析(字符串数组是合法 JSON)。字符串内的括号/转义不参与配对。 */
function extractSuggestWords(body: string): unknown[] | null {
  const key = /["']?s["']?\s*:\s*\[/.exec(body);
  if (key === null) return null;
  const start = body.indexOf("[", key.index);
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = start; i < body.length; i += 1) {
    const ch = body[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === "\\") esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') inStr = true;
    else if (ch === "[") depth += 1;
    else if (ch === "]") {
      depth -= 1;
      if (depth === 0) {
        const parsed = parseJson(body.slice(start, i + 1));
        return Array.isArray(parsed) ? parsed : null;
      }
    }
  }
  return null;
}

/** 百度下拉:JSONP 包裹的 {q,s:string[]};refId=bd:<sha1(seed\0word)>(方案 §7) */
export function parseBaiduSuggest(raw: string, seed: string): CommunityItem[] {
  const open = raw.indexOf("(");
  const close = raw.lastIndexOf(")");
  const body = open >= 0 && close > open ? raw.slice(open + 1, close) : raw;
  const words = extractSuggestWords(body);
  if (words === null) return [];
  const seen = new Set<string>();
  const items: CommunityItem[] = [];
  for (const w of words) {
    const word = asString(w).trim();
    if (word === "" || seen.has(word)) continue;
    seen.add(word);
    const digest = createHash("sha1").update(`${seed}\u0000${word}`).digest("hex");
    items.push({
      refId: `bd:${digest}`,
      text: word,
      url: `https://www.baidu.com/s?ie=utf-8&wd=${encodeURIComponent(word)}`,
      signalAt: null,
      lang: "zh",
      meta: { seed },
    });
  }
  return items;
}

/** 需求类 issue 判定:标签命中 bug/feature/enhancement,或标题前缀标注
 * (实测两仓约六成 issue 未打标,只认标签会漏掉真实需求) */
const OSS_LABELS = new Set(["bug", "feature", "enhancement", "feat", "feature request"]);
const OSS_TITLE_PREFIX = /^\s*[\[【(]?\s*(?:bug|feature|feat|enhancement|建议|缺陷|功能|优化)/i;

/** 中英混排语言判定:中文占比达英文 1/3 即 zh(标题中文 + 正文夹英文术语常见) */
export function detectLang(text: string): "zh" | "en" {
  const cjk = (text.match(/[一-鿿]/g) ?? []).length;
  const latin = (text.match(/[A-Za-z]/g) ?? []).length;
  return cjk >= 4 && cjk * 3 >= latin ? "zh" : "en";
}

interface GhIssue {
  number?: unknown;
  title?: unknown;
  body?: unknown;
  html_url?: unknown;
  created_at?: unknown;
  labels?: Array<{ name?: unknown }>;
  pull_request?: unknown;
}

function isDemandIssue(issue: GhIssue): boolean {
  const labels = (issue.labels ?? []).map((l) => asString(l.name).toLowerCase());
  if (labels.some((l) => OSS_LABELS.has(l))) return true;
  return OSS_TITLE_PREFIX.test(asString(issue.title));
}

/** GitHub Issues:剔除 PR、只收窗口内 open 的 bug/feature/enhancement,
 * 正文截断 COMMUNITY_OSS_BODY_MAX */
export function parseGithubIssues(raw: string, repo: string, now: Date): CommunityItem[] {
  const data = parseJson(raw);
  if (!Array.isArray(data)) return [];
  const floor = now.getTime() - COMMUNITY_OSS_WINDOW_DAYS * 86_400_000;
  const items: CommunityItem[] = [];
  for (const issue of data as GhIssue[]) {
    if (issue.pull_request !== undefined) continue;
    const number = asNumber(issue.number);
    const title = asString(issue.title).trim();
    if (number === null || title === "") continue;
    const createdAt = new Date(asString(issue.created_at));
    if (Number.isNaN(createdAt.getTime()) || createdAt.getTime() < floor) continue;
    if (!isDemandIssue(issue)) continue;
    const body = asString(issue.body).trim().slice(0, COMMUNITY_OSS_BODY_MAX);
    const text = body === "" ? title : `${title}\n\n${body}`;
    items.push({
      refId: `${repo}#${number}`,
      text,
      url:
        asString(issue.html_url) !== ""
          ? asString(issue.html_url)
          : `https://github.com/${repo}/issues/${number}`,
      signalAt: createdAt,
      // 语言按标题判:issue 正文常带模板化英文(### Self Checks / I have read
      // the FAQ),混进去会把中文诉求误判为 en(真机 cc-switch#9051 实例)
      lang: detectLang(title),
      meta: {
        repo,
        labels: (issue.labels ?? []).map((l) => asString(l.name)).filter((n) => n !== ""),
      },
    });
  }
  return items;
}
