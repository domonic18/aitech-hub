/**
 * AI 智能指数:新闻事件打分器
 *
 * 三层结构:
 * 1) 相关性闸(relevance):非 AI 资讯直接丢弃,不打分、不入池
 * 2) 打分(impact 0-100 + direction + confidence):优先用 Jev(System One),
 *    未绑定/失败时回落规则打分
 * 3) 带符号贡献(signedImpact):impact × 方向 × 置信度 × 相关性权重
 */
import { decideQuestions, type JevQuestion } from "@/lib/ai/decisions-client";
import { resolveInsightModel } from "@/lib/insight/model";
import { AI_PURPOSE_INSIGHT_JUDGE } from "@/lib/ai/constants";

export interface NewsItem {
  id: string;
  title: string;
  summary: string;
  url: string;
  publishedAt: string; // ISO
  sourceName?: string;
}

/** core=直接推进 AI 能力与格局;adjacent=AI 外围(商业/政策/生态);other=与 AI 无关 */
export type NewsRelevance = "core" | "adjacent" | "other";

/** positive=能力或生态推进;negative=能力回退/事故/收紧;neutral=常规动态 */
export type NewsDirection = "positive" | "negative" | "neutral";

export interface ScoredNewsItem extends NewsItem {
  impactScore: number;
  confidence: number;
  dimension: string;
  relevance: NewsRelevance;
  direction: NewsDirection;
  scorer: "jev" | "rule";
}

const CORE_KEYWORDS = [
  "gpt",
  "claude",
  "gemini",
  "llama",
  "qwen",
  "deepseek",
  "kimi",
  "grok",
  "mistral",
  "doubao",
  "豆包",
  "文心",
  "通义",
  "智谱",
  "阶跃",
  "minimax",
  "零一万物",
  "sora",
  "runway",
  "luma",
  "kling",
  "seed-tts",
  "cohere",
  "command r",
  "perplexity",
  "openai",
  "anthropic",
  "meta ai",
  "xai",
  "hugging face",
  "大模型",
  "语言模型",
  "多模态",
  "智能体",
  "agent",
  "推理模型",
  "扩散模型",
  "diffusion",
  "transformer",
  "benchmark",
  "sota",
  "开源模型",
  "上下文窗口",
  "token",
  "微调",
  "fine-tun",
  "具身",
  "机器人",
  "人工智能",
  " ai ",
];

/** AI 外围:与 AI 相关但主要落在商业/政策/基建,权重打折 */
const ADJACENT_KEYWORDS = [
  "融资",
  "收购",
  "ipo",
  "估值",
  "投资",
  "上市",
  "政策",
  "监管",
  "法案",
  "禁令",
  "合规",
  "算力",
  "gpu",
  "芯片",
  "数据中心",
  "智算",
  "大会",
  "峰会",
  "论坛",
  "招聘",
  "课程",
  "白皮书",
  "报告",
];

const NEGATIVE_KEYWORDS = [
  "事故",
  "泄露",
  "处罚",
  "罚款",
  "禁令",
  "收紧",
  "诉讼",
  "起诉",
  "禁止",
  "封禁",
  "下架",
  "撤回",
  "回退",
  "退化",
  "失败",
  "漏洞",
  "事故调查",
  "争议",
  "反对",
  "停用",
  "限制",
  "裁员",
  "破产",
  "衰退",
  "放缓",
  "下调",
  "延期",
  "搁置",
  "halt",
  "ban",
  "lawsuit",
  "recall",
  "outage",
  "leak",
];

const POSITIVE_KEYWORDS = [
  "发布",
  "上线",
  "开源",
  "突破",
  "提升",
  "领先",
  "超越",
  "刷新",
  "首次",
  "里程碑",
  "扩大",
  "增长",
  "上新",
  "升级",
  "改进",
  "更快",
  "更强",
  "更低",
  "新高",
  "登顶",
  "领先",
  "release",
  "launch",
  "open source",
  "breakthrough",
  "state of the art",
];

const CORE_HIT = (text: string): boolean => CORE_KEYWORDS.some((kw) => text.includes(kw));

function countHits(text: string, keywords: string[]): number {
  return keywords.reduce((n, kw) => (text.includes(kw) ? n + 1 : n), 0);
}

export function ruleRelevance(item: NewsItem): NewsRelevance {
  const text = ` ${`${item.title} ${item.summary}`.toLowerCase()} `;
  if (CORE_HIT(text)) return "core";
  if (ADJACENT_KEYWORDS.some((kw) => text.includes(kw))) return "adjacent";
  return "other";
}

export function ruleDirection(item: NewsItem): NewsDirection {
  const text = `${item.title} ${item.summary}`.toLowerCase();
  const neg = countHits(text, NEGATIVE_KEYWORDS);
  const pos = countHits(text, POSITIVE_KEYWORDS);
  if (neg > pos) return "negative";
  if (pos > neg) return "positive";
  return "neutral";
}

/** 相关性权重:核心事件全额计入,外围事件减半,无关事件为零 */
export function relevanceWeight(relevance: NewsRelevance): number {
  if (relevance === "core") return 1;
  if (relevance === "adjacent") return 0.5;
  return 0;
}

/** 方向符号:中性事件给 0.4,表示行业在推进但非突破 */
export function directionSign(direction: NewsDirection): number {
  if (direction === "positive") return 1;
  if (direction === "negative") return -1;
  return 0.4;
}

export function ruleBasedScore(item: NewsItem): {
  score: number;
  dimension: string;
  confidence: number;
  relevance: NewsRelevance;
  direction: NewsDirection;
} {
  const text = `${item.title} ${item.summary}`.toLowerCase();
  let score = 30; // 基础分
  let dimension = "general";

  const HIGH_IMPACT_KEYWORDS = [
    "gpt-5",
    "gpt-4",
    "claude 3.5",
    "claude 4",
    "gemini 2.5",
    "deepseek",
    "sota",
    "state of the art",
    "benchmark",
    "突破",
    "开源",
    "agent",
    "推理",
    "多模态",
    "文生视频",
    "图像生成",
    "ag",
    "通用人工智能",
    "融资",
    "收购",
    "发布",
    "模型",
  ];
  for (const kw of HIGH_IMPACT_KEYWORDS) {
    if (text.includes(kw)) score += 6;
  }

  const BREAKTHROUGH_KEYWORDS = [
    "sota",
    "state of the art",
    "超越人类",
    "超越 gpt",
    "首次",
    "里程碑",
    "breakthrough",
    "重大突破",
    "刷新纪录",
    "世界第一",
  ];
  score += countHits(text, BREAKTHROUGH_KEYWORDS) * 12;

  if (/model|模型|gpt|claude|gemini|deepseek/.test(text)) dimension = "model";
  if (/benchmark|sota|score|超越|刷新/.test(text)) dimension = "benchmark";
  if (/agent|智能体|auto|workflow/.test(text)) dimension = "agent";
  if (/video|视频|image|图像|multimodal|多模态/.test(text)) dimension = "multimodal";
  if (/funding|融资|收购|ipo|million|billion/.test(text)) dimension = "business";
  if (/policy|监管|法案|合规|治理/.test(text)) dimension = "policy";

  const trustedSources = ["openai", "anthropic", "google", "deepseek", "智谱", "月之暗面"];
  if (item.sourceName && trustedSources.some((s) => item.sourceName?.toLowerCase().includes(s))) {
    score += 8;
  }

  return {
    score: Math.min(100, score),
    dimension,
    confidence: 0.55,
    relevance: ruleRelevance(item),
    direction: ruleDirection(item),
  };
}

async function jevScore(item: NewsItem): Promise<{
  score: number;
  dimension: string;
  confidence: number;
  relevance: NewsRelevance;
  direction: NewsDirection;
} | null> {
  const model = await resolveInsightModel(AI_PURPOSE_INSIGHT_JUDGE);
  if (model === null || model.protocol !== "systemone") return null;

  const questions: Record<string, JevQuestion> = {
    impact: {
      type: "score",
      instructions: "这条 AI 资讯对 AI 整体能力边界的推进影响有多大?",
      criteria: {
        "0-20": "普通行业动态、融资、人事、政策讨论,对能力边界几乎无直接影响",
        "21-40": "产品更新、小模型发布、应用层改进,有一定影响但非突破",
        "41-60": "重要模型发布、新能力亮相、benchmark 显著提升",
        "61-80": "重大范式转变,如推理模型、长上下文、多模态重大进展",
        "81-100": "里程碑式突破,可能重新定义能力边界或通向 AGI 的关键节点",
      },
    } as unknown as JevQuestion,
    dimension: {
      type: "choice",
      instructions: "该资讯主要属于哪个维度?",
      criteria: {
        model: "基础模型发布/架构/参数/训练方法",
        benchmark: "benchmark/SOTA/评测结果",
        agent: "Agent/工具使用/自动化任务",
        multimodal: "图像/视频/音频/多模态能力",
        business: "融资/并购/产品商业化",
        policy: "政策/安全/治理",
        other: "其他或难以归类",
      },
    },
    relevance: {
      type: "choice",
      instructions: "这条资讯与 AI 发展本身的相关程度如何?",
      criteria: {
        core: "直接推进 AI 能力或格局:新模型/新能力/基准突破/重要开源/重大安全事件",
        adjacent: "与 AI 有关但主要落在商业、政策、基建、资本的周边动态",
        other: "与 AI 能力发展无实质关联的资讯",
      },
    },
    direction: {
      type: "choice",
      instructions: "这条资讯对 AI 发展是推动还是拖累?",
      criteria: {
        positive: "能力提升、能力边界外扩、生态扩大、开放更多能力",
        negative: "能力回退或受限、重大事故、监管收紧、生态收缩",
        neutral: "常规动态、观点、统计,不改变能力或生态方向",
      },
    },
  };

  try {
    const res = await decideQuestions({
      baseUrl: model.baseUrl ?? "https://api.typesafe.ai",
      apiKey: model.apiKey,
      model: model.modelId,
      state: {
        title: item.title,
        summary: item.summary,
        publishedAt: item.publishedAt,
        source: item.sourceName ?? "unknown",
      },
      questions,
      timeoutMs: 15_000,
    });

    const impact = res.answers.impact;
    if (impact?.score === undefined) return null;

    const relevance = res.answers.relevance?.choice;
    const direction = res.answers.direction?.choice;

    return {
      score: Math.round(impact.score),
      dimension: res.answers.dimension?.choice ?? "general",
      confidence: impact.confidence ?? 0.7,
      relevance: relevance === "core" || relevance === "adjacent" ? relevance : ruleRelevance(item),
      direction:
        direction === "positive" || direction === "negative" || direction === "neutral"
          ? direction
          : ruleDirection(item),
    };
  } catch {
    return null;
  }
}

export async function scoreNewsItem(item: NewsItem): Promise<ScoredNewsItem> {
  const jev = await jevScore(item);
  if (jev) {
    return {
      ...item,
      impactScore: jev.score,
      dimension: jev.dimension,
      confidence: jev.confidence,
      relevance: jev.relevance,
      direction: jev.direction,
      scorer: "jev",
    };
  }
  const rule = ruleBasedScore(item);
  return {
    ...item,
    impactScore: rule.score,
    dimension: rule.dimension,
    confidence: rule.confidence,
    relevance: rule.relevance,
    direction: rule.direction,
    scorer: "rule",
  };
}

export async function scoreNewsItems(items: NewsItem[]): Promise<ScoredNewsItem[]> {
  return Promise.all(items.map(scoreNewsItem));
}

/** 相关性闸:只有 core/adjacent 进入指数池,other 直接丢弃 */
export function selectAiRelevant(items: ScoredNewsItem[]): ScoredNewsItem[] {
  return items.filter((i) => i.relevance !== "other");
}

/** 单条新闻对当日指数的带符号贡献 */
export function signedImpact(item: ScoredNewsItem): number {
  return (
    item.impactScore *
    directionSign(item.direction) *
    item.confidence *
    relevanceWeight(item.relevance)
  );
}
