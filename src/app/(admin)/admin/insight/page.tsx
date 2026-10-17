/**
 * 洞察中心(M34 批①雏形,方案 docs/plan/insight-plan.md §6):热点舆情+痛点
 * 挖掘的信号池看板。批① 未聚类,先按源分组——KPI(总量/今日/零结果搜索)+
 * 近 7 日趋势 + 分源台账 + 最近信号流(可按源过滤)。批② 聚类上线后演进为
 * 簇视图,本页保留为原始信号页签。纯读无 mutation,服务端直查不设 API 路由。
 */
import Link from "next/link";

import Sparkline from "@/components/admin/usage/Sparkline";
import { requireAdminPage } from "@/lib/auth/guard";
import { insightOverview, listInsightSignals } from "@/lib/insight/admin";
import { INSIGHT_SOURCE_MEDIUM, type InsightSource } from "@/lib/insight/ingest";

export const dynamic = "force-dynamic";

const SOURCE_LABELS: Record<InsightSource, string> = {
  "internal-search": "站内搜索",
  "internal-agent": "助手问句",
  "internal-comment": "文章评论",
  "internal-feedback": "站点反馈",
  "telegram-ai": "电报AI解读",
};

const MEDIUM_LABELS: Record<string, string> = {
  money: "钱",
  time: "时间",
  voice: "声音",
  search: "搜索",
  "ai-record": "AI记录",
};

function parseSource(raw: string | undefined): InsightSource | undefined {
  return raw !== undefined && raw in INSIGHT_SOURCE_MEDIUM ? (raw as InsightSource) : undefined;
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleString("zh-CN", {
    timeZone: "Asia/Shanghai",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function KpiCard({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint?: string;
}): React.ReactElement {
  return (
    <div className="rounded-md border border-line bg-panel px-4 py-3">
      <div className="text-xs text-text-3">{label}</div>
      <div className="mt-1 font-mono text-xl font-semibold text-text-1">{value}</div>
      {hint !== undefined && <div className="mt-0.5 text-[11px] text-text-3">{hint}</div>}
    </div>
  );
}

export default async function AdminInsightPage({
  searchParams,
}: {
  searchParams: Promise<{ source?: string }>;
}): Promise<React.ReactElement> {
  await requireAdminPage();
  const { source: rawSource } = await searchParams;
  const source = parseSource(rawSource);

  const [overview, signals] = await Promise.all([
    insightOverview(),
    listInsightSignals({ source, limit: 50 }),
  ]);

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h2 className="text-base font-semibold">洞察中心</h2>
        <p className="mt-0.5 text-xs text-text-3">
          热点舆情 + 用户痛点挖掘(方案 docs/plan/insight-plan.md,M34):批① 内部零采集源
          入池,未聚类先按源分组;批② 接 AI 加工(向量化聚类/打标/机会评分卡)。零结果
          搜索=内容未被满足的需求缺口,痛点侧核心指标。
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KpiCard label="信号总量" value={overview.total.toLocaleString()} />
        <KpiCard label="今日新增" value={overview.today.toLocaleString()} />
        <KpiCard
          label="近 7 日零结果搜索"
          value={overview.zeroResultSearch7d.toLocaleString()}
          hint="内容缺口信号,选题候选"
        />
        <div className="rounded-md border border-line bg-panel px-4 py-3">
          <div className="text-xs text-text-3">近 7 日日增</div>
          <div className="mt-2">
            <Sparkline data={overview.daily.map((d) => d.count)} />
          </div>
          <div className="mt-1 font-mono text-[10px] text-text-3">
            {overview.daily[0]?.date.slice(5)} → {overview.daily[6]?.date.slice(5)}
          </div>
        </div>
      </div>

      <div className="overflow-x-auto rounded-md border border-line bg-panel">
        <table className="w-full text-left text-[13px]">
          <thead>
            <tr className="border-b border-line bg-panel-2 text-xs text-text-2">
              <th className="px-4 py-2.5 font-medium">信号源</th>
              <th className="px-3 py-2.5 font-medium">介质</th>
              <th className="px-3 py-2.5 text-right font-medium">总量</th>
              <th className="px-3 py-2.5 text-right font-medium">今日</th>
              <th className="px-4 py-2.5 text-right font-medium">占比</th>
            </tr>
          </thead>
          <tbody>
            {overview.bySource.map((s) => (
              <tr key={s.source} className="border-b border-line last:border-b-0 hover:bg-panel-2">
                <td className="px-4 py-2.5">
                  <Link
                    href={`/admin/insight?source=${s.source}`}
                    className="text-text-1 hover:text-accent"
                  >
                    {SOURCE_LABELS[s.source as InsightSource] ?? s.source}
                  </Link>
                </td>
                <td className="px-3 py-2.5">
                  <span className="rounded-sm bg-panel-2 px-1.5 py-0.5 font-mono text-[11px] text-text-2">
                    {MEDIUM_LABELS[s.medium] ?? s.medium}
                  </span>
                </td>
                <td className="px-3 py-2.5 text-right font-mono text-[12px] text-text-1">
                  {s.total.toLocaleString()}
                </td>
                <td className="px-3 py-2.5 text-right font-mono text-[12px] text-text-2">
                  {s.today.toLocaleString()}
                </td>
                <td className="px-4 py-2.5 text-right font-mono text-[11px] text-text-3">
                  {overview.total > 0 ? `${Math.round((s.total / overview.total) * 100)}%` : "—"}
                </td>
              </tr>
            ))}
            {overview.bySource.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-xs text-text-3">
                  信号池还是空的:前台搜一次/发一条评论即可看到首个信号
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="rounded-md border border-line bg-panel">
        <div className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-2.5">
          <span className="text-xs font-medium text-text-2">最近信号</span>
          <Link
            href="/admin/insight"
            className={`rounded-sm px-2 py-0.5 font-mono text-[11px] ${
              source === undefined
                ? "bg-accent-dim text-accent"
                : "bg-panel-2 text-text-2 hover:text-text-1"
            }`}
          >
            全部
          </Link>
          {(Object.keys(INSIGHT_SOURCE_MEDIUM) as InsightSource[]).map((k) => (
            <Link
              key={k}
              href={`/admin/insight?source=${k}`}
              className={`rounded-sm px-2 py-0.5 font-mono text-[11px] ${
                source === k
                  ? "bg-accent-dim text-accent"
                  : "bg-panel-2 text-text-2 hover:text-text-1"
              }`}
            >
              {SOURCE_LABELS[k]}
            </Link>
          ))}
        </div>
        <table className="w-full text-left text-[13px]">
          <tbody>
            {signals.map((sig) => (
              <tr key={sig.id} className="border-b border-line last:border-b-0 hover:bg-panel-2">
                <td className="w-24 px-4 py-2 align-top">
                  <span className="rounded-sm bg-panel-2 px-1.5 py-0.5 font-mono text-[11px] text-text-2">
                    {SOURCE_LABELS[sig.source as InsightSource] ?? sig.source}
                  </span>
                </td>
                <td className="px-3 py-2 align-top">
                  <span className="line-clamp-2 text-text-1" title={sig.rawText}>
                    {sig.rawText}
                  </span>
                </td>
                <td className="w-24 px-3 py-2 text-right align-top">
                  {sig.hitCount !== null && (
                    <span
                      className={`font-mono text-[11px] ${sig.zeroResult ? "text-red" : "text-text-3"}`}
                      title={sig.zeroResult ? "零结果:内容缺口" : `命中 ${sig.hitCount} 条`}
                    >
                      {sig.zeroResult ? "零结果" : `${sig.hitCount} 命中`}
                    </span>
                  )}
                </td>
                <td className="w-28 px-4 py-2 text-right align-top font-mono text-[11px] text-text-3">
                  {formatTime(sig.signalAt)}
                </td>
              </tr>
            ))}
            {signals.length === 0 && (
              <tr>
                <td colSpan={4} className="px-4 py-8 text-center text-xs text-text-3">
                  {source === undefined ? "暂无信号" : `「${SOURCE_LABELS[source]}」暂无信号`}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
