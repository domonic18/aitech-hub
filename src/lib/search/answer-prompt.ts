/**
 * 答案 prompt 组装(K2,纯函数):引用选取(三域拉链交错保多样性)、
 * 编号资料块、系统 prompt(有资料/无资料两变体——0 命中仍生成是需求红线,
 * requirement §4「AI 直接作答」)。
 */
import type { SearchHit, UnifiedSearchResult } from "./search-view";
import type { AnswerCiteKind } from "./answer-protocol";

/** 输出预算(答案 ≤300 字 + 3 追问,富余) */
export const ANSWER_MAX_TOKENS = 800;

/** 引用上限(三域交错选取) */
export const CITE_LIMIT = 8;

/** 引用片段截断(与 loadCitationBodies 出口同口径,snippet 回落时再截一次) */
const CITE_SNIPPET_MAX = 300;

/** 三域拉链交错截前 CITE_LIMIT(同分数下资讯/教程/项目均衡呈现) */
export function pickCitations(groups: UnifiedSearchResult["groups"]): SearchHit[] {
  const queues: SearchHit[][] = [groups.telegram.items, groups.post.items, groups.repo.items].map(
    (a) => [...a],
  );
  const out: SearchHit[] = [];
  while (out.length < CITE_LIMIT && queues.some((q) => q.length > 0)) {
    for (const q of queues) {
      const item = q.shift();
      if (item && out.length < CITE_LIMIT) out.push(item);
    }
  }
  return out;
}

export function citeKindOf(hit: SearchHit): AnswerCiteKind {
  if (hit.domain === "telegram") return hit.mediaType === "video" ? "feed-video" : "feed-text";
  if (hit.domain === "post") return "post";
  return "repo";
}

/** 编号资料块([n] 与 meta.cites 序号对齐;正文首段优先回落展示摘要) */
export function buildCiteBlocks(
  picks: readonly SearchHit[],
  bodies: ReadonlyMap<string, string>,
): string {
  return picks
    .map((p, i) => {
      const n = i + 1;
      const body = (bodies.get(`${p.domain}:${p.id}`) ?? p.snippet).slice(0, CITE_SNIPPET_MAX);
      return `[${n}] (${citeKindOf(p)}) ${p.title}\n链接: ${p.href}\n${body}`;
    })
    .join("\n\n");
}

/** 系统 prompt(noHits=true 为无资料变体:凭模型知识直接作答、不用 [n]) */
export function buildAnswerSystemPrompt(noHits: boolean): string {
  const followSpec = [
    "正文写完后,另起一行输出哨兵标记 ###FOLLOW###(原样输出,不要放进代码块),",
    "其后恰好输出 3 行追问建议,每行以 - 开头、不超过 20 个字,是与本问题相关的具体追问。",
  ].join("");
  if (noHits) {
    return [
      "你是 AI 信息站的搜索助手。站内没有检索到相关内容,请凭你自己的知识直接回答用户问题,",
      "开头一句话说明「站内无相关内容,以下为通用回答」。不使用 [n] 引用标注;不确定的内容明说,禁止编造。",
      "排版:可用 **加粗**、`行内代码`、以「- 」开头的列表条目;不用 Markdown 标题/表格/链接。不超过 300 字。",
      followSpec,
    ].join("");
  }
  return [
    "你是 AI 信息站的搜索助手,只依据用户问题下方给出的编号资料回答,禁止使用资料之外的事实。",
    "关键事实句末尾标注来源编号,如 [1] 或 [1][2];资料不足的部分明确说明「站内资料未覆盖」,禁止编造。",
    "排版:可用 **加粗**、`行内代码`、以「- 」开头的列表条目;不用 Markdown 标题/表格/链接。不超过 300 字。",
    followSpec,
  ].join("");
}

export function buildAnswerUserPrompt(q: string, citeBlocks: string): string {
  if (citeBlocks === "") return `用户问题:${q}`;
  return `编号资料:\n${citeBlocks}\n\n用户问题:${q}\n请依据编号资料回答。`;
}
