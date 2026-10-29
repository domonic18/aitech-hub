/**
 * 洞察信号领域分类(M54 批B):未分类信号经 Jev Choice 双问(领域 + 子域,
 * 合一次 decisions 请求)落 domain/subdomain。挂 embed tick 最前(分类先于
 * 同域聚类,新信号当轮即入对桶)。
 *
 * 采信纪律(与打标判定半场同构):置信 ≥JUDGE_MIN_CONFIDENCE 且答案在词表内
 * → 落库;低置信/失败/答案非法 → 保留 unclassified 待下轮(永不猜测)。
 * 子域追问按「该 domain 启用子域数 ≥2」动态判定(P2-26,taxonomy 词表驱动,
 * 不再硬编码 tech);子域应答须属已答领域才采信。分类器=insight_judge 绑定
 * (与打标判定同一 Jev 通道);未绑定 → sweep 空转(零行为变化)。
 */
import { prisma } from "../db";
import { logger } from "../logger";
import { decideQuestions } from "../ai/decisions-client";
import { AI_PURPOSE_INSIGHT_JUDGE } from "../ai/constants";
import { CLASSIFY_BATCH_SIZE, JUDGE_MIN_CONFIDENCE } from "./constants";
import { resolveInsightModel } from "./model";
import { listEnabledDomainKeys, listEnabledSubdomainKeys } from "./taxonomy";

export interface ClassifySummary {
  scanned: number;
  classified: number;
  kept: number; // 低置信/答案非法,保留 unclassified
  failed: number; // Jev 调用失败
  skipped: boolean; // 判定模型未绑定
}

/** 分类 sweep:未分类信号(unclassified)批量过 Jev 双问并落库。永不 throw。 */
export async function runInsightClassify(limit = CLASSIFY_BATCH_SIZE): Promise<ClassifySummary> {
  const summary: ClassifySummary = {
    scanned: 0,
    classified: 0,
    kept: 0,
    failed: 0,
    skipped: false,
  };
  // 判定模型未绑定/解析失败 → sweep 空转(P2-25 统一降级口径,零行为变化)
  const judge = await resolveInsightModel(AI_PURPOSE_INSIGHT_JUDGE);
  if (!judge?.baseUrl || !judge.apiKey) {
    summary.skipped = true;
    return summary;
  }
  const domains = await listEnabledDomainKeys();
  if (domains.length < 2) {
    summary.skipped = true;
    return summary;
  }
  // 子域第二问动态判定(P2-26):不再硬编码 tech——逐领域取启用子域,凡启用
  // 子域数 ≥2 的领域进入第二问;criteria 为这些领域子域并集(key 全局唯一)。
  // 单次 decisions 请求须先于 domain 应答出题,故出题按「任一合格领域」判定,
  // 采信侧再校验子域确属已答领域(跨域答案不采信,tech 现行为等价)。
  const subOwner = new Map<string, string>(); // 子域 key → 所属领域
  for (const d of domains) {
    const subs = await listEnabledSubdomainKeys(d);
    if (subs.length >= 2) for (const s of subs) subOwner.set(s, d);
  }
  const signals = await prisma.insightSignal.findMany({
    where: { domain: "unclassified" },
    select: { id: true, source: true, normalizedText: true },
    orderBy: { id: "desc" },
    take: limit,
  });
  summary.scanned = signals.length;
  for (const sig of signals) {
    try {
      const r = await decideQuestions({
        baseUrl: judge.baseUrl ?? "",
        apiKey: judge.apiKey,
        model: judge.modelId,
        state: { source: sig.source, text: sig.normalizedText },
        questions: {
          domain: {
            type: "choice",
            criteria: Object.fromEntries(domains.map((d) => [d, `属于「${d}」领域的内容`])),
            instructions: "这条信号属于哪个领域?",
          },
          ...(subOwner.size > 0
            ? {
                subdomain: {
                  type: "choice" as const,
                  criteria: Object.fromEntries(
                    [...subOwner.keys()].map((s) => [s, `属于「${s}」子方向的内容`]),
                  ),
                  instructions: "若属带子方向的领域,细分到哪个子方向?",
                },
              }
            : {}),
        },
        timeoutMs: judge.timeoutSec * 1000,
      });
      const domainAnswer = r.answers.domain;
      const domainChoice = domainAnswer?.choice;
      const domain =
        domainAnswer?.type === "choice" &&
        domainChoice !== undefined &&
        domainAnswer.confidence !== null &&
        domainAnswer.confidence >= JUDGE_MIN_CONFIDENCE &&
        domains.includes(domainChoice)
          ? domainChoice
          : null;
      let subdomain: string | null = null;
      const subAnswer = r.answers.subdomain;
      const subChoice = subAnswer?.choice;
      if (
        domain !== null &&
        subAnswer?.type === "choice" &&
        subChoice !== undefined &&
        subAnswer.confidence !== null &&
        subAnswer.confidence >= JUDGE_MIN_CONFIDENCE &&
        // 子域确属已答领域才采信(跨域答案不落库;P2-26 动态判定)
        subOwner.get(subChoice) === domain
      ) {
        subdomain = subChoice;
      }
      if (domain === null) {
        summary.kept += 1;
        continue;
      }
      await prisma.insightSignal.update({
        where: { id: sig.id },
        data: { domain, ...(subdomain !== null ? { subdomain } : {}) },
        select: { id: true },
      });
      summary.classified += 1;
    } catch (e) {
      summary.failed += 1;
      logger.warn({
        event: "insight.classify_failed",
        signalId: sig.id.toString(),
        error: String(e).slice(0, 200),
      });
    }
  }
  logger.info({ event: "insight.classified", ...summary });
  return summary;
}
