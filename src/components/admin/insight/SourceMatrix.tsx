"use client";

/**
 * 源×簇覆盖矩阵(M52 批C):活跃簇(机会分降序前 N)× 在役源信号计数。
 * Content Gap 方法论落地——热源有簇 × 内部痛源(评论)零信号 = 内容空白格
 * (红虚线框 + 一键转选题,POST /api/insight/clusters/[id]/topic);内部痛源
 * 强 × 外部热源零 = 自有特色选题(蓝底标)。格底色按行内相对热度着色。
 * 客户端组件(useRouter 转选题交互)。
 * M52 验收修订:①转选题幂等(服务端同题去重 + 客户端已转题禁点);②源停滞
 * 列弱化(最新信号超 14 天的源不参与空白判定,列头「停滞」标)。
 */
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import type { SourceMatrix } from "@/lib/insight/trend";

/** 列头短标(长标入 title) */
const SOURCE_SHORT: Record<string, { short: string; full: string; internal: boolean }> = {
  "hot-baidu": { short: "百度", full: "百度热搜", internal: false },
  "hot-zhihu": { short: "知乎", full: "知乎热榜", internal: false },
  "hot-bilibili": { short: "B站", full: "B站热搜", internal: false },
  "telegram-ai": { short: "电报", full: "电报AI解读", internal: false },
  "internal-comment": { short: "评论", full: "文章评论(站内痛点)", internal: true },
};

const INTERNAL_SOURCE = "internal-comment";

export default function SourceMatrix({ matrix }: { matrix: SourceMatrix }): React.ReactElement {
  const router = useRouter();
  const [busyId, setBusyId] = useState<string | null>(null);
  /** 已转题簇(客户端防重;服务端另有同题去重兜底) */
  const [converted, setConverted] = useState<Set<string>>(new Set());
  const [msg, setMsg] = useState<string | null>(null);

  const { clusters, sources, cells } = matrix;
  const staleSources = new Set(sources.filter((s) => s.stale).map((s) => s.source));
  const internalStale = staleSources.has(INTERNAL_SOURCE);
  const cell = (id: bigint, source: string): number => cells[`${id}:${source}`] ?? 0;
  const internalCount = (id: bigint): number => cell(id, INTERNAL_SOURCE);
  const hotTotal = (id: bigint): number =>
    sources
      .filter((s) => !SOURCE_SHORT[s.source]?.internal)
      .reduce((a, s) => a + cell(id, s.source), 0);

  async function toTopic(id: bigint, label: string | null): Promise<void> {
    setBusyId(String(id));
    setMsg(null);
    try {
      const res = await fetch(`/api/insight/clusters/${id}/topic`, { method: "POST" });
      const json = (await res.json().catch(() => null)) as {
        code?: number;
        message?: string;
        data?: { topic_id?: string };
      } | null;
      if (res.ok && json?.code === 0) {
        setConverted((prev) => new Set(prev).add(String(id)));
        setMsg(`「${label ?? "未命名簇"}」已转选题,创作中心可见`);
        router.refresh();
      } else {
        setMsg(json?.message ?? `转选题失败(HTTP ${res.status})`);
      }
    } catch {
      setMsg("网络错误,请重试");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[560px] text-left text-[12px]">
          <thead>
            <tr className="border-b border-line text-[11px] text-text-3">
              <th className="px-2 py-1.5 font-medium">簇(机会分降序)</th>
              {sources.map((s) => (
                <th
                  key={s.source}
                  className={`px-2 py-1.5 text-center font-medium ${s.stale ? "text-text-3/50" : ""}`}
                  title={`${SOURCE_SHORT[s.source]?.full ?? s.source}${
                    s.stale ? "(源停滞:14 天无新信号,不参与空白判定)" : ""
                  }`}
                >
                  {SOURCE_SHORT[s.source]?.short ?? s.source}
                  {s.stale && <span className="ml-0.5 text-[9px]">(停滞)</span>}
                </th>
              ))}
              <th className="px-2 py-1.5 text-right font-medium">行动</th>
            </tr>
          </thead>
          <tbody>
            {clusters.map((c) => {
              const blank =
                !internalStale &&
                c.kind === "hot" &&
                internalCount(c.clusterId) === 0 &&
                hotTotal(c.clusterId) > 0;
              const signature =
                c.kind === "pain" && internalCount(c.clusterId) >= 3 && hotTotal(c.clusterId) === 0;
              const max = Math.max(...sources.map((s) => cell(c.clusterId, s.source)), 1);
              const isConverted = converted.has(String(c.clusterId));
              return (
                <tr key={String(c.clusterId)} className="border-b border-line/50 last:border-0">
                  <td className="max-w-[200px] px-2 py-1.5">
                    <Link
                      href={`/admin/insight/clusters/${c.clusterId}`}
                      className="flex items-center gap-1.5 hover:underline"
                      title={`机会分 ${c.score !== null ? Math.round(c.score) : "—"}`}
                    >
                      <span
                        className={`shrink-0 rounded-sm px-1 font-mono text-[10px] leading-4 ${
                          c.kind === "hot"
                            ? "bg-amber/12 text-amber-hi"
                            : "bg-accent/12 text-accent"
                        }`}
                      >
                        {c.kind === "hot" ? "热" : "痛"}
                      </span>
                      <span className="truncate text-text-1">{c.label ?? "待打标簇"}</span>
                    </Link>
                  </td>
                  {sources.map((s) => {
                    const n = cell(c.clusterId, s.source);
                    const gap =
                      !s.stale && c.kind === "hot" && s.source === INTERNAL_SOURCE && n === 0;
                    const dim = s.stale;
                    return (
                      <td key={s.source} className="px-2 py-1.5 text-center">
                        <span
                          className={`inline-block min-w-7 rounded-sm px-1 py-0.5 font-mono text-[11px] ${
                            gap
                              ? "border border-dashed border-red text-red"
                              : signature && !SOURCE_SHORT[s.source]?.internal
                                ? "bg-blue/10 text-blue"
                                : n > 0
                                  ? "bg-panel-2 text-text-1"
                                  : "text-text-3/30"
                          }`}
                          style={
                            !gap &&
                            !(signature && !SOURCE_SHORT[s.source]?.internal) &&
                            n > 0 &&
                            !dim
                              ? { opacity: 0.45 + (0.55 * n) / max }
                              : dim
                                ? { opacity: 0.35 }
                                : undefined
                          }
                        >
                          {n}
                        </span>
                      </td>
                    );
                  })}
                  <td className="px-2 py-1.5 text-right">
                    {isConverted ? (
                      <span className="text-[10.5px] text-green">已转题</span>
                    ) : blank ? (
                      <button
                        type="button"
                        disabled={busyId === String(c.clusterId)}
                        onClick={() => void toTopic(c.clusterId, c.label)}
                        className="cursor-pointer rounded-sm border border-dashed border-red px-1.5 py-0.5 text-[10.5px] text-red hover:bg-red/10 disabled:opacity-50"
                        title="热源有需求 × 站内无痛点信号 = 内容空白,一键转选题补覆盖"
                      >
                        {busyId === String(c.clusterId) ? "转题中…" : "补空白"}
                      </button>
                    ) : signature ? (
                      <span className="text-[10.5px] text-blue">自有特色</span>
                    ) : (
                      <span className="text-text-3/50">—</span>
                    )}
                  </td>
                </tr>
              );
            })}
            {clusters.length === 0 && (
              <tr>
                <td
                  colSpan={sources.length + 2}
                  className="px-2 py-6 text-center text-xs text-text-3"
                >
                  暂无成熟簇(已打标且 ≥3 条信号)——等 LLM 打标日批把簇养熟后进矩阵
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {msg && <p className="text-[11px] text-green">{msg}</p>}
      <p className="text-[10.5px] leading-relaxed text-text-3">
        读法:热源簇在「评论」列空白 = 外部有需求、站内无痛点信号(内容空白,建议转选题补覆盖);
        评论列强 × 外部全零 = 站内自有特色选题。格深浅=行内相对信号量;源停滞(14 天无新信号)期间
        该列置灰不参与空白判定。
      </p>
    </div>
  );
}
