/**
 * F26 痛点详情(pain 形态):页头(痛点 · label + 重新归纳=全局日批)→
 * summaryCard(概括全文 + 出现次数/涉及信号/主要平台 metrics)→ 原文证据
 * 6 条(热度优先排序,meta.url 在则跳原文)→ actionCard(关联机会簇 chips +
 * 已产出文章 + 可写角度 + 生成选题占位)。板面情绪/原文直链为终态愿景:
 * 信号无情绪字段不造数,链接仅热榜源携带 url 时出现。
 */
import Link from "next/link";

import TopicGenButton from "@/components/admin/insight/TopicGenButton";
import TriggerButtons from "@/components/admin/discovery/TriggerButtons";
import { SOURCE_LABELS, formatTime, writeAngleLine } from "@/components/admin/insight/shared";
import type { InsightClusterDetail } from "@/lib/insight/admin";
import type { InsightClusterExtras } from "@/lib/insight/cluster-extras";

/** meta 携带 {rank,heat?,url?,batch}(hotlist run 写入);其余源 meta 各自形状 */
function metaOf(raw: unknown): { heat: number; url: string | null } {
  if (raw === null || typeof raw !== "object") return { heat: 0, url: null };
  const m = raw as Record<string, unknown>;
  return {
    heat: typeof m.heat === "number" ? m.heat : 0,
    url: typeof m.url === "string" && m.url.startsWith("http") ? m.url : null,
  };
}

export default function ClusterPainDetail({
  detail,
  extras,
}: {
  detail: InsightClusterDetail;
  extras: InsightClusterExtras;
}): React.ReactElement {
  const c = detail.cluster;
  // 原文证据:热度(heat)优先,同热度按时间新→旧;取 6 条
  const quotes = [...detail.signals]
    .sort((a, b) => metaOf(b.meta).heat - metaOf(a.meta).heat)
    .slice(0, 6);
  const topSources = detail.sourceDist
    .slice(0, 3)
    .map((s) => SOURCE_LABELS[s.source as keyof typeof SOURCE_LABELS] ?? s.source);

  return (
    <div className="flex flex-col gap-4">
      <div>
        <div className="flex flex-wrap items-center gap-2">
          <Link href="/admin/insight/" className="text-xs text-text-3 hover:text-accent">
            ← 洞察中心
          </Link>
          <span className="rounded-sm bg-panel-2 px-1.5 py-0.5 font-mono text-[11px] text-text-2">
            痛点#{c.id}
          </span>
          {c.status === "fading" && (
            <span className="rounded-sm bg-panel-2 px-1.5 py-0.5 font-mono text-[11px] text-text-3">
              退热
            </span>
          )}
        </div>
        <div className="mt-1 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-base font-semibold">痛点 · {c.label ?? "待打标簇"}</h2>
          {/* 重新归纳即全局日批(单 LLM 归纳管线),入队后到点即跑 */}
          <TriggerButtons
            endpoint="/api/insight/trigger"
            jobs={[
              {
                job: "daily",
                label: "重新归纳",
                hint: "走全局日批:LLM 打标+覆盖度+评分快照,耗时数分钟",
              },
            ]}
          />
        </div>
        <p className="mt-0.5 text-[11px] text-text-3">AI 归纳 · 每日分析生成,可重新归纳</p>
        <p className="mt-2 font-mono text-[11px] text-text-3">
          首见 {formatTime(c.firstSeenAt)} · 最近 {formatTime(c.lastSeenAt)}
          {c.labeledAt !== null && ` · 打标 ${formatTime(c.labeledAt)}`}
        </p>
      </div>

      {/* summaryCard */}
      <div className="rounded-md border border-line bg-panel px-4 py-3">
        <div className="text-sm font-semibold">痛点概括</div>
        {c.summary !== null ? (
          <p className="mt-1.5 text-[13px] leading-relaxed text-text-2">{c.summary}</p>
        ) : (
          <p className="mt-1.5 text-xs text-text-3">暂无 AI 概括:绑定「洞察归纳」模型后日批生成</p>
        )}
        <div className="mt-2.5 flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-line pt-2.5 text-xs text-text-2">
          <span>
            近 30 日出现{" "}
            <span className="font-mono font-semibold text-text-1">{extras.sig30d}</span> 次
          </span>
          <span>
            涉及信号 <span className="font-mono font-semibold text-text-1">{c.members}</span> 条
          </span>
          {topSources.length > 0 && <span>主要平台:{topSources.join(" / ")}</span>}
        </div>
      </div>

      {/* quoteCard 原文证据 */}
      <div className="rounded-md border border-line bg-panel">
        <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-line px-4 py-2.5">
          <span className="text-sm font-semibold">原文证据</span>
          <span className="text-[11px] text-text-3">按热度排序 · 有原文链可跳转</span>
        </div>
        <div className="grid gap-2 p-2 lg:grid-cols-2">
          {quotes.map((s) => {
            const meta = metaOf(s.meta);
            const related = c.keywords.find((k) =>
              s.rawText.toLowerCase().includes(k.toLowerCase()),
            );
            return (
              <div key={s.id} className="rounded-md border border-line bg-panel-2 px-3.5 py-2.5">
                {meta.url !== null ? (
                  <a
                    href={meta.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-[13px] leading-relaxed text-text-1 hover:text-accent"
                    title="跳原文"
                  >
                    「{s.rawText}」
                  </a>
                ) : (
                  <p className="text-[13px] leading-relaxed text-text-1">「{s.rawText}」</p>
                )}
                <div className="mt-1.5 flex flex-wrap items-center gap-2 text-[11px] text-text-3">
                  {related !== undefined && (
                    <span className="rounded-sm bg-panel px-1.5 py-0.5 text-text-2">
                      相关:{related}
                    </span>
                  )}
                  <span>
                    {SOURCE_LABELS[s.source as keyof typeof SOURCE_LABELS] ?? s.source} ·{" "}
                    {formatTime(s.signalAt)}
                  </span>
                </div>
              </div>
            );
          })}
          {quotes.length === 0 && (
            <p className="col-span-full px-4 py-8 text-center text-xs text-text-3">暂无成员信号</p>
          )}
        </div>
      </div>

      {/* actionCard */}
      <div className="rounded-md border border-line bg-panel px-4 py-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="text-sm font-semibold">关联机会簇</div>
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {extras.relatedHot.map((h) => (
                <Link
                  key={h.id}
                  href={`/admin/insight/clusters/${h.id}`}
                  className="rounded-sm bg-panel-2 px-2 py-0.5 text-xs text-text-2 hover:bg-accent-dim hover:text-accent"
                  title="查看机会簇详情"
                >
                  {h.label ?? `热点#${h.id}`} · {h.members}
                </Link>
              ))}
              {extras.relatedHot.length === 0 && (
                <span className="text-xs text-text-3">暂无共享关键词的机会簇</span>
              )}
            </div>
            {extras.producedPosts > 0 && (
              <p className="mt-2 text-xs text-text-2">
                已产出{" "}
                <span className="font-mono font-semibold text-text-1">{extras.producedPosts}</span>{" "}
                篇相关文章——可从差异角度补更
              </p>
            )}
            <div className="mt-2.5 text-sm font-semibold">可写角度</div>
            <p className="mt-1 text-[13px] leading-relaxed text-text-2">
              {writeAngleLine(c.coverageState)}
            </p>
          </div>
          <div className="flex shrink-0 flex-col items-end gap-1.5">
            <span className="text-[11px] text-text-3">选题生成排期中</span>
            <TopicGenButton />
          </div>
        </div>
      </div>
    </div>
  );
}
