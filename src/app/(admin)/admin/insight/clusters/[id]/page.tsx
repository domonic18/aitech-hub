/**
 * 簇详情(M34 批②,方案 §6):簇头(命名/概括/关键词/介质/覆盖度/机会分)+
 * 近 30 日热力格 + 成员信号原话流(最近 50 条)+ 来源分布。服务端直查。
 */
import Link from "next/link";
import { notFound } from "next/navigation";

import HeatGrid from "@/components/admin/insight/HeatGrid";
import {
  CoverageBadge,
  MediaBadges,
  SOURCE_LABELS,
  formatTime,
} from "@/components/admin/insight/shared";
import { requireAdminPage } from "@/lib/auth/guard";
import { getInsightClusterDetail } from "@/lib/insight/admin";

export const dynamic = "force-dynamic";

export default async function AdminInsightClusterPage({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<React.ReactElement> {
  await requireAdminPage();
  const { id } = await params;
  if (!/^\d+$/.test(id)) notFound();
  const detail = await getInsightClusterDetail(BigInt(id));
  if (detail === null) notFound();
  const { cluster, signals, sourceDist } = detail;
  const c = cluster;

  return (
    <div className="flex flex-col gap-4">
      <div>
        <div className="flex flex-wrap items-center gap-2">
          <Link href="/admin/insight" className="text-xs text-text-3 hover:text-accent">
            ← 洞察中心
          </Link>
          <span className="rounded-sm bg-panel-2 px-1.5 py-0.5 font-mono text-[11px] text-text-2">
            {c.kind === "hot" ? "热点" : "痛点"}#{c.id}
          </span>
          {c.status === "fading" && (
            <span className="rounded-sm bg-panel-2 px-1.5 py-0.5 font-mono text-[11px] text-text-3">
              退热
            </span>
          )}
        </div>
        <h2 className="mt-1 flex flex-wrap items-center gap-2 text-base font-semibold">
          {c.label ?? "待打标簇"}
          {c.score !== null && (
            <span className="font-mono text-sm text-text-2">机会分 {Math.round(c.score)}</span>
          )}
        </h2>
        {c.summary !== null && <p className="mt-1 text-[13px] text-text-2">{c.summary}</p>}
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          <MediaBadges media={c.media} />
          <CoverageBadge score={c.coverageScore} state={c.coverageState} />
          {c.keywords.map((k) => (
            <span key={k} className="rounded-sm bg-panel-2 px-1.5 py-0.5 text-[11px] text-text-2">
              #{k}
            </span>
          ))}
        </div>
        <p className="mt-2 font-mono text-[11px] text-text-3">
          {c.members} 条信号 · 首见 {formatTime(c.firstSeenAt)} · 最近 {formatTime(c.lastSeenAt)}
          {c.peakAt !== null && ` · 峰值 ${formatTime(c.peakAt)}`}
          {c.labeledAt !== null && ` · 打标 ${formatTime(c.labeledAt)}`}
        </p>
      </div>

      <div className="rounded-md border border-line bg-panel px-4 py-3">
        <div className="mb-2 flex items-center gap-2 text-xs font-medium text-text-2">
          近 30 日热度
          {c.snapshots.length >= 2 && c.snapshots[c.snapshots.length - 1]!.rank !== null && (
            <span className="font-mono text-[11px] text-text-3">
              最新排名 #{c.snapshots[c.snapshots.length - 1]!.rank}
            </span>
          )}
        </div>
        <HeatGrid points={c.snapshots.map((s) => ({ date: s.date, score: s.score }))} />
        {c.snapshots.length === 0 && (
          <p className="mt-2 text-[11px] text-text-3">暂无快照:日批(03:57)首轮跑完开始累积</p>
        )}
      </div>

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-4">
        <div className="rounded-md border border-line bg-panel px-4 py-3 lg:col-span-1">
          <div className="mb-2 text-xs font-medium text-text-2">来源分布</div>
          <ul className="flex flex-col gap-1.5">
            {sourceDist.map((s) => (
              <li key={s.source} className="flex items-center justify-between gap-2 text-[12px]">
                <span className="text-text-2">
                  {SOURCE_LABELS[s.source as keyof typeof SOURCE_LABELS] ?? s.source}
                </span>
                <span className="font-mono text-text-1">{s.count}</span>
              </li>
            ))}
            {sourceDist.length === 0 && <li className="text-xs text-text-3">暂无成员</li>}
          </ul>
        </div>

        <div className="rounded-md border border-line bg-panel lg:col-span-3">
          <div className="border-b border-line px-4 py-2.5 text-xs font-medium text-text-2">
            信号原话流(最近 {signals.length} 条)
          </div>
          <table className="w-full text-left text-[13px]">
            <tbody>
              {signals.map((s) => (
                <tr key={s.id} className="border-b border-line last:border-b-0 hover:bg-panel-2">
                  <td className="w-24 px-4 py-2 align-top">
                    <span className="rounded-sm bg-panel-2 px-1.5 py-0.5 font-mono text-[11px] text-text-2">
                      {SOURCE_LABELS[s.source as keyof typeof SOURCE_LABELS] ?? s.source}
                    </span>
                  </td>
                  <td className="px-3 py-2 align-top text-text-1" title={s.rawText}>
                    <span className="line-clamp-2">{s.rawText}</span>
                  </td>
                  <td className="w-28 px-4 py-2 text-right align-top font-mono text-[11px] text-text-3">
                    {formatTime(s.signalAt)}
                  </td>
                </tr>
              ))}
              {signals.length === 0 && (
                <tr>
                  <td colSpan={3} className="px-4 py-8 text-center text-xs text-text-3">
                    暂无成员信号
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
      {c.coverageState !== null && (
        <p className="text-[11px] text-text-3">
          内容覆盖度=站点既有文章对本簇信号的语义覆盖(质心向量近邻匹配);「内容空白」 即选题机会。
        </p>
      )}
    </div>
  );
}
