"use client";

/**
 * 源×簇覆盖矩阵 · 渠道族版(M60 批B):取代按「源」铺列的旧矩阵。
 *
 * 为什么换维度:旧矩阵把 16 个在役源都渲染成列,min-w 远小于真实最小宽,
 * 「行动」列折行;渠道还在扩(新闻媒体/垂直论坛),列数必爆。族是稳定维度,
 * 列数恒等于族数(≤6),新增源只增加族内成员。
 *
 * 每行 = 一个成熟簇:族分段占比条(看结构)+ 族级结论(空白/自有特色/部分/良好)
 * + 行动按钮(nowrap 定宽);行下 `<details>` 展开逐源计数,单源明细仍在但不再
 * 占列。判定口径见 `lib/insight/coverage.ts`(停滞族不参与判定)。
 */
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import {
  VERDICT_LABELS,
  buildCoverageFamilies,
  coverageVerdict,
  familyShares,
  type CoverageFamily,
  type CoverageVerdict,
} from "@/lib/insight/coverage";
import {
  FAMILY_LABELS,
  SOURCE_FAMILIES,
  SOURCE_LABELS,
  sourcesInFamily,
  type InsightSource,
  type InsightSourceFamily,
} from "@/lib/insight/source-registry";
import type { SourceMatrix, SourceMatrixCluster } from "@/lib/insight/trend";

/** 族 → 分段条色(令牌色,禁裸色值;news/forum 为预留族,当前无在役源) */
const FAMILY_BAR: Record<InsightSourceFamily, string> = {
  internal: "bg-accent",
  hotlist: "bg-amber",
  vendor: "bg-blue",
  community: "bg-green",
  news: "bg-red",
  forum: "bg-text-3",
};

const VERDICT_CLASS: Record<CoverageVerdict, string> = {
  blank: "border border-dashed border-red text-red",
  signature: "bg-blue/10 text-blue",
  covered: "bg-green/10 text-green",
  partial: "bg-panel-2 text-text-3",
};

interface Row {
  cluster: SourceMatrixCluster;
  families: CoverageFamily[];
  verdict: CoverageVerdict;
  shares: { family: InsightSourceFamily; pct: number }[];
}

export default function CoverageBoard({ matrix }: { matrix: SourceMatrix }): React.ReactElement {
  const router = useRouter();
  const [busyId, setBusyId] = useState<string | null>(null);
  /** 已转题簇(客户端防重;服务端另有同题去重兜底) */
  const [converted, setConverted] = useState<Set<string>>(new Set());
  const [msg, setMsg] = useState<string | null>(null);
  const [blankOnly, setBlankOnly] = useState(false);

  const { clusters, sources, cells } = matrix;
  const staleOf = new Set(sources.filter((s) => s.stale).map((s) => s.source));
  const cell = (id: bigint, source: InsightSource): number => cells[`${id}:${source}`] ?? 0;

  const rows: Row[] = clusters.map((cluster) => {
    const families = buildCoverageFamilies(sources, (s) => cell(cluster.clusterId, s));
    return {
      cluster,
      families,
      verdict: coverageVerdict(cluster.kind, families),
      shares: familyShares(families),
    };
  });
  const blankCount = rows.filter((r) => r.verdict === "blank").length;
  const shown = blankOnly ? rows.filter((r) => r.verdict === "blank") : rows;

  /** 族图例:全域合计 + 族内成员全停滞标记 */
  const legend = SOURCE_FAMILIES.map((family) => ({
    family,
    total: rows.reduce((a, r) => a + (r.families.find((f) => f.family === family)?.total ?? 0), 0),
    stale: sourcesInFamily(family).every((s) => staleOf.has(s)),
  }));

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
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
        <div className="flex flex-wrap items-center gap-1.5">
          {legend.map((l) => (
            <span
              key={l.family}
              className={`inline-flex items-center gap-1 rounded-sm border border-line px-1.5 py-0.5 text-[10.5px] ${
                l.stale ? "text-text-3/60" : "text-text-2"
              }`}
              title={`${FAMILY_LABELS[l.family]} · 在役源 ${sourcesInFamily(l.family)
                .map((s) => SOURCE_LABELS[s])
                .join("、")}${l.stale ? "(整族停滞:14 天无新信号,不参与判定)" : ""}`}
            >
              <span className={`inline-block size-2 rounded-[2px] ${FAMILY_BAR[l.family]}`} />
              {FAMILY_LABELS[l.family]}
              <span className="font-mono text-text-3">{l.total}</span>
              {l.stale && <span className="text-[9px]">● 停滞</span>}
            </span>
          ))}
        </div>
        <button
          type="button"
          onClick={() => setBlankOnly((v) => !v)}
          aria-pressed={blankOnly}
          className={`ml-auto cursor-pointer rounded-sm border px-2 py-0.5 text-[10.5px] ${
            blankOnly
              ? "border-red bg-red/10 text-red"
              : "border-line text-text-2 hover:border-line-hover hover:text-text-1"
          }`}
          title="只看内容空白簇(外部有热信号 × 站内零信号)"
        >
          仅看空白
          <span className="ml-1 font-mono">{blankCount}</span>
        </button>
      </div>

      <div className="flex flex-col">
        {shown.map(({ cluster: c, families, verdict, shares }) => {
          const isConverted = converted.has(String(c.clusterId));
          const blank = verdict === "blank";
          return (
            <div key={String(c.clusterId)} className="border-b border-line/50 py-1.5 last:border-0">
              <div className="grid grid-cols-[minmax(0,1fr)_2.5rem_minmax(0,1.1fr)_4.75rem_4.5rem] items-center gap-2 sm:gap-3">
                <Link
                  href={`/admin/insight/clusters/${c.clusterId}`}
                  className="flex min-w-0 items-center gap-1.5 hover:underline"
                  title={`${c.label ?? "待打标"} · 机会分 ${c.score !== null ? Math.round(c.score) : "—"}`}
                >
                  <span
                    className={`shrink-0 rounded-sm px-1 font-mono text-[10px] leading-4 ${
                      c.kind === "hot" ? "bg-amber/12 text-amber-hi" : "bg-accent/12 text-accent"
                    }`}
                  >
                    {c.kind === "hot" ? "热" : "痛"}
                  </span>
                  <span className="truncate text-text-1">{c.label ?? "待打标"}</span>
                </Link>
                <span className="text-right font-mono text-[11px] text-text-2" title="机会分">
                  {c.score !== null ? Math.round(c.score) : "—"}
                </span>
                <div
                  className={`flex h-2 overflow-hidden rounded-sm ${
                    shares.length === 0 ? "border border-dashed border-line" : "bg-panel-2"
                  }`}
                  role="img"
                  aria-label={
                    families
                      .filter((f) => f.total > 0)
                      .map((f) => `${FAMILY_LABELS[f.family]} ${f.total}`)
                      .join("、") || "无信号"
                  }
                >
                  {shares.map((s) => {
                    const fam = families.find((f) => f.family === s.family);
                    return (
                      <span
                        key={s.family}
                        className={`${FAMILY_BAR[s.family]} ${fam?.stale ? "opacity-35" : ""}`}
                        style={{ flexGrow: s.pct, flexBasis: 0 }}
                        title={`${FAMILY_LABELS[s.family]}:${fam?.members
                          .filter((m) => m.count > 0)
                          .map((m) => `${SOURCE_LABELS[m.source]} ${m.count}`)
                          .join("、")}${fam?.stale ? "(停滞)" : ""}`}
                      />
                    );
                  })}
                </div>
                <span
                  className={`whitespace-nowrap rounded-sm px-1.5 py-0.5 text-center text-[10.5px] ${VERDICT_CLASS[verdict]}`}
                  title={
                    verdict === "blank"
                      ? "外部族有热信号 × 站内族零信号 = 内容空白,建议补稿"
                      : verdict === "signature"
                        ? "站内族信号强 × 外部族零信号 = 站内独有需求"
                        : verdict === "covered"
                          ? "全部非停滞族都有信号"
                          : "部分渠道族尚无信号(或该族停滞无从判断)"
                  }
                >
                  {VERDICT_LABELS[verdict]}
                </span>
                <span className="text-right">
                  {/* 每行恒有转选题钮(M53 验收反馈:要防抖防呆,不是移除);
                      定宽 + nowrap 保证行动列永不折行(M60 反馈) */}
                  {isConverted ? (
                    <span className="text-[10.5px] text-green">已转题</span>
                  ) : busyId === String(c.clusterId) ? (
                    <span className="text-[10.5px] text-text-3">转题中…</span>
                  ) : (
                    <button
                      type="button"
                      onClick={() => void toTopic(c.clusterId, c.label)}
                      className={`w-[72px] cursor-pointer whitespace-nowrap rounded-sm border px-1.5 py-0.5 text-[10.5px] ${
                        blank
                          ? "border-dashed border-red text-red hover:bg-red/10"
                          : "border-line text-text-2 hover:border-line-hover hover:text-text-1"
                      }`}
                      title={
                        blank
                          ? "热源有需求 × 站内无痛点信号 = 内容空白,一键转选题补覆盖"
                          : "在创作中心创建对应主题"
                      }
                    >
                      {blank ? "补空白" : "转选题"}
                    </button>
                  )}
                </span>
              </div>
              <details className="mt-1 pl-1">
                <summary className="w-fit cursor-pointer list-none text-[10px] text-text-3 hover:text-text-1">
                  单源明细({families.filter((f) => f.total > 0).length} 族有信号)
                </summary>
                <div className="mt-1 flex flex-wrap gap-1">
                  {families.flatMap((f) =>
                    f.members.map((m) => (
                      <span
                        key={m.source}
                        className={`rounded-sm px-1 py-0.5 font-mono text-[10px] ${
                          m.count > 0
                            ? "bg-panel-2 text-text-1"
                            : m.stale
                              ? "text-text-3/30 line-through"
                              : "text-text-3/40"
                        }`}
                        title={`${FAMILY_LABELS[f.family]} · ${SOURCE_LABELS[m.source]}${
                          m.stale ? "(停滞)" : ""
                        }`}
                      >
                        {SOURCE_LABELS[m.source]} {m.count}
                      </span>
                    )),
                  )}
                </div>
              </details>
            </div>
          );
        })}
        {shown.length === 0 && (
          <p className="px-2 py-6 text-center text-xs text-text-3">
            {blankOnly
              ? "当前没有内容空白簇(或数据未就绪)"
              : "暂无成熟簇(已打标且 ≥3 条信号)——等 LLM 打标把簇养熟后进矩阵"}
          </p>
        )}
      </div>

      {msg && <p className="text-[11px] text-green">{msg}</p>}
      <p className="text-[10.5px] leading-relaxed text-text-3">
        读法:分段条=该簇信号在各渠道族的占比(悬停看族内单源计数,行下「单源明细」看逐源)。
        热簇有外部族信号而站内族(评论/助手问句)为零 = <b>内容空白</b>(红虚线,建议补稿); 痛簇站内族
        ≥3 且外部族为零 = <b>自有特色</b>。整族停滞(14 天无新信号)不参与判定。
        新增渠道只需在源注册表归属到已有族,矩阵列数不变。
      </p>
    </div>
  );
}
