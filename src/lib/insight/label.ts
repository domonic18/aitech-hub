/**
 * 洞察 LLM 打标段(M34 批②,方案 §5.4;批③ 验收三轮·痛点扩围):簇命名/
 * 概括/关键词 + **kind 语义判定**(pain=有明确诉求/求助/抱怨,hot=公众话题,
 * 拿不准归 hot)——kind 不再按源定生死,聚类单池归簇(cluster.ts),本段日批
 * 按簇内容覆写源映射引导值;M46 验收批增 **sentiment 舆情倾向**四值打标
 * (词云四色数据源;存量簇经 findStaleClusters IS NULL 分支首轮补打)。
 * role=insight 走 AiTaskBinding 治理。
 * - 打标只对「成员数达标且较上次打标有新增」的簇(增量省调用;未绑定模型=
 *   日批打标跳过,机械段见 daily.ts 照跑);
 * - 契约解析失败只回错误串,chatJsonTask 据此重试;单簇失败自吞不殃及批内
 *   其余,下轮重扫自愈(embed-reconcile 同取向)。
 * 日批编排(配额/评分/快照/覆盖/fading)在 ./daily。
 */
import { AI_PURPOSE_INSIGHT, AI_PURPOSE_INSIGHT_JUDGE } from "../ai/constants";
import { decideQuestions } from "../ai/decisions-client";
import { resolveAiModel } from "../ai/resolver";
import { chatJsonTask, type ParsedTask } from "../ai/chat-json-task";
import { readExtraMaxTokens } from "../ai/extra-params";
import { prisma } from "../db";
import { logger } from "../logger";
import { unionMedia } from "./cluster";
import {
  JUDGE_MIN_CONFIDENCE,
  LABEL_MIN_MEMBERS,
  LABEL_SAMPLE_SIZE,
  LABEL_SAMPLE_TEXT_MAX,
  type InsightSentiment,
} from "./constants";

export interface InsightLabelContract {
  label: string;
  summary: string;
  keywords: string[];
  /** 簇别语义判定(批③ 验收三轮·痛点扩围):pain=含未满足需求/痛点/求助/
   * 抱怨语义;hot=公众话题/新闻事件。覆写建簇时的源映射引导值 */
  kind: "hot" | "pain";
  /** 舆情倾向(M46 验收批,F11 词云四色):簇内信号的整体情绪面 */
  sentiment: InsightSentiment;
}

/** 打标契约解析(解析失败只回错误串,chatJsonTask 据此重试;永不 throw) */
export function parseInsightLabel(raw: string): ParsedTask<InsightLabelContract> {
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return { ok: false, error: "输出不是合法 JSON" };
  }
  if (typeof data !== "object" || data === null) return { ok: false, error: "顶层不是对象" };
  const o = data as Record<string, unknown>;
  if (typeof o.label !== "string" || o.label.trim() === "") {
    return { ok: false, error: "label 缺失或为空" };
  }
  if (typeof o.summary !== "string" || o.summary.trim() === "") {
    return { ok: false, error: "summary 缺失或为空" };
  }
  if (o.kind !== "hot" && o.kind !== "pain") {
    return { ok: false, error: "kind 须为 hot 或 pain" };
  }
  const sentiment = (o as Record<string, unknown>).sentiment;
  if (
    sentiment !== "positive" &&
    sentiment !== "neutral" &&
    sentiment !== "negative" &&
    sentiment !== "mixed"
  ) {
    return {
      ok: false,
      error: "sentiment 须为 positive/neutral/negative/mixed 之一",
    };
  }
  const keywords = Array.isArray(o.keywords)
    ? o.keywords.filter((k): k is string => typeof k === "string" && k.trim() !== "")
    : [];
  if (keywords.length === 0) return { ok: false, error: "keywords 缺失或为空数组" };
  return {
    ok: true,
    data: {
      label: o.label.trim().slice(0, 200),
      summary: o.summary.trim().slice(0, 1000),
      keywords: keywords.slice(0, 8).map((k) => k.trim().slice(0, 40)),
      kind: o.kind,
      sentiment,
    },
  };
}

// ── 打标段 ────────────────────────────────────────────────────────────

const LABEL_SYSTEM = `你是内容运营洞察分析师。给定同一主题下聚合的一组用户信号原话(搜索词/提问/评论/热搜条目/资讯),为这组信号归纳一个可读的簇:
{"label":"簇名(≤20字,概括需求/话题本身的人话短语,勿罗列样本原词)","summary":"一句话概括(≤60字,这组信号反映的共性诉求或现象)","keywords":["关键词3-8个"],"kind":"hot 或 pain","sentiment":"positive 或 neutral 或 negative 或 mixed"}
kind 判定标准:pain=信号表达未满足的需求、痛点、求助或抱怨,有明确诉求对象,可转化为内容选题或产品改进;hot=公众关注度话题/新闻事件,只是被讨论而无明确诉求。拿不准时归 hot。
sentiment 判定标准(簇内信号的整体情绪面):positive=评价/反馈以认可、期待、推荐为主;negative=以抱怨、吐槽、担忧、负面评价为主;mixed=正负两极明显并存或争论激烈(争议);neutral=以中性讨论、资讯传播为主,无明显情绪。拿不准时归 neutral。
只输出一个 JSON 对象,不要任何解释。`;

interface StaleClusterRow {
  id: bigint;
  members: bigint;
}

/** 待打标簇(active、成员达标、未打标或有新增;最近活跃优先)。
 * 聚合条件全走 HAVING(WHERE 不容聚合;label 函数依赖分组主键,PG 允许)。
 * sentiment IS NULL 入选=存量簇一次性补打舆情位(M46 验收批:加列后首轮
 * 日批全量回填,走既有增量管线零脚本;打标覆写 label/keywords 属幂等重归纳) */
export async function findStaleClusters(limit: number): Promise<StaleClusterRow[]> {
  return prisma.$queryRaw<StaleClusterRow[]>`
    SELECT c.id, count(*) AS members
      FROM insight_cluster c
      JOIN insight_cluster_member m ON m.cluster_id = c.id
     WHERE c.status = 'active'
     GROUP BY c.id
    HAVING count(*) >= ${LABEL_MIN_MEMBERS}
       AND (c.label IS NULL OR count(*) > c.labeled_member_count OR c.sentiment IS NULL)
     ORDER BY max(c.last_seen_at) DESC
     LIMIT ${limit}`;
}

interface LabelSample {
  rawText: string;
  source: string;
}

/** 打标输入样本(最近成员优先;rawText 截断防 prompt 爆量) */
async function fetchLabelSamples(clusterId: bigint): Promise<LabelSample[]> {
  const rows = await prisma.insightSignal.findMany({
    where: { members: { some: { clusterId } } },
    orderBy: { signalAt: "desc" },
    take: LABEL_SAMPLE_SIZE,
    select: { rawText: true, source: true },
  });
  return rows.map((r) => ({
    rawText: r.rawText.slice(0, LABEL_SAMPLE_TEXT_MAX),
    source: r.source,
  }));
}

/** Jev 判定半场(M53):舆情倾向 + hot·pain 覆判,两问合一次 decisions 请求。
 * 高置信(≥JUDGE_MIN_CONFIDENCE)逐项覆写 LLM 判定;低置信/不可用保留 LLM 值
 * (自动回退,打标永不因 Jev 失败失败)。双跑差异留痕=一致性抽查数据源。 */
async function judgeByJev(
  clusterId: bigint,
  samples: LabelSample[],
  llm: { kind: "hot" | "pain"; sentiment: InsightLabelContract["sentiment"] },
): Promise<{ kind: "hot" | "pain"; sentiment: InsightLabelContract["sentiment"] }> {
  const out = { ...llm };
  let judge: Awaited<ReturnType<typeof resolveAiModel>>;
  try {
    judge = await resolveAiModel(AI_PURPOSE_INSIGHT_JUDGE);
  } catch {
    return out;
  }
  if (!judge) return out; // 未绑定判定模型 → 全量走归纳模型(零行为变化)
  try {
    const r = await decideQuestions({
      baseUrl: judge.baseUrl ?? "",
      apiKey: judge.apiKey,
      model: judge.modelId,
      state: samples.map((s) => `[${s.source}] ${s.rawText}`),
      questions: {
        sentiment: {
          type: "choice",
          criteria: {
            positive: "整体呈正面情绪",
            neutral: "中性陈述为主,无明显情绪",
            negative: "负面情绪为主(抱怨/不满/吐槽)",
            mixed: "正负情绪混杂",
          },
          instructions: "这组用户信号的总体舆情倾向是哪一类?",
        },
        kind: {
          type: "choice",
          criteria: {
            hot: "外部热点话题(大家在讨论/关注什么)",
            pain: "用户痛点或需求(大家希望有什么/遇到什么困难)",
          },
          instructions: "这组信号更接近外部热点话题还是用户痛点?",
        },
      },
      timeoutMs: judge.timeoutSec * 1000,
    });
    // 判定采信:置信 ≥ 阈值 且 选项合法 → 覆写;低置信/非法 → 保留 LLM 值
    const sent = r.answers.sentiment;
    if (
      sent?.type === "choice" &&
      sent.choice !== undefined &&
      sent.confidence !== null &&
      sent.confidence >= JUDGE_MIN_CONFIDENCE &&
      ["positive", "neutral", "negative", "mixed"].includes(sent.choice)
    ) {
      if (sent.choice !== out.sentiment) {
        logger.info({
          event: "insight.judge.diff",
          clusterId: clusterId.toString(),
          field: "sentiment",
          llm: out.sentiment,
          jev: sent.choice,
          confidence: sent.confidence,
        });
      }
      out.sentiment = sent.choice as InsightLabelContract["sentiment"];
    }
    const kind = r.answers.kind;
    if (
      kind?.type === "choice" &&
      kind.choice !== undefined &&
      kind.confidence !== null &&
      kind.confidence >= JUDGE_MIN_CONFIDENCE &&
      (kind.choice === "hot" || kind.choice === "pain")
    ) {
      if (kind.choice !== out.kind) {
        logger.info({
          event: "insight.judge.diff",
          clusterId: clusterId.toString(),
          field: "kind",
          llm: out.kind,
          jev: kind.choice,
          confidence: kind.confidence,
        });
      }
      out.kind = kind.choice as "hot" | "pain";
    }
    logger.info({
      event: "insight.judged",
      clusterId: clusterId.toString(),
      cost: r.usageCost,
    });
  } catch (e) {
    // Jev 不可用(网络/配额/协议漂移)→ 保留 LLM 判定(自动回退)
    logger.warn({
      event: "insight.judge_failed",
      clusterId: clusterId.toString(),
      error: String(e),
    });
  }
  return out;
}

/** 单簇打标(日批主链路 + 一次性重判脚本复用);永不 throw(失败返回 false
 * 交批次汇总) */
export async function labelCluster(
  clusterId: bigint,
  memberCount: number,
  model: Awaited<ReturnType<typeof resolveAiModel>>,
): Promise<boolean> {
  if (!model) return false;
  const [samples, cluster] = await Promise.all([
    fetchLabelSamples(clusterId),
    prisma.insightCluster.findUnique({
      where: { id: clusterId },
      select: { label: true, summary: true },
    }),
  ]);
  if (samples.length === 0) return false;
  const sampleText = samples.map((s, i) => `${i + 1}. [${s.source}] ${s.rawText}`).join("\n");
  const prior =
    cluster?.label != null
      ? `\n(本簇已有命名「${cluster.label}」与概括「${cluster.summary ?? ""}」;成员有新增,可沿用或按新材料更名)`
      : "";
  const user = `信号样本 ${memberCount} 条(展示最近 ${samples.length} 条):\n${sampleText}${prior}`;
  const parsed = await chatJsonTask<InsightLabelContract>(
    model,
    parseInsightLabel,
    LABEL_SYSTEM,
    user,
    AI_PURPOSE_INSIGHT,
    { maxTokens: readExtraMaxTokens(model.extraParams) ?? undefined },
  );
  const [mediaRows, memberCountNow] = await Promise.all([
    prisma.insightSignal.findMany({
      where: { members: { some: { clusterId } } },
      select: { medium: true },
    }),
    prisma.insightClusterMember.count({ where: { clusterId } }),
  ]);
  // 判定半场(M53):Jev 高置信覆写舆情/hot·pain(未绑定判定模型时原值直通)
  const judged = await judgeByJev(clusterId, samples, {
    kind: parsed.kind,
    sentiment: parsed.sentiment,
  });
  await prisma.insightCluster.update({
    where: { id: clusterId },
    data: {
      label: parsed.label,
      summary: parsed.summary,
      keywords: parsed.keywords,
      // 簇别语义覆判(痛点扩围):LLM 判定覆盖源映射引导值;M53 起 Jev 高置信覆写
      kind: judged.kind,
      // 舆情倾向(M46 验收批):词云四色数据源;M53 起 Jev 高置信覆写
      sentiment: judged.sentiment,
      media: unionMedia([mediaRows.map((r) => r.medium)]),
      labeledAt: new Date(),
      // 基 LLM 调用期间的最新成员数记账,避免把打标间隙的新增误判为「未打标新增」
      labeledMemberCount: Math.max(memberCount, memberCountNow),
    },
    select: { id: true },
  });
  return true;
}
