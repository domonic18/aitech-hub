/**
 * F11 分析总览 hero 行:左关键词云图卡(搜索 + 点词入词库),右 KPI 四竖列
 * (候选增量·7天 / 信号总数 / 机会均分(人写内容) / 新入词库)+ 底部日批
 * status 行「每日分析 · 今日 HH:MM 成功」。KPI 固定口径不随窗口 chips(板定
 * 7 天增量与全量总数);机会均分由页侧按当前 hot 簇均分传入。
 */
import KeywordCloud from "@/components/admin/insight/KeywordCloud";
import type { InsightCloudWord } from "@/lib/insight/hotboard";
import { formatCnDate, formatCnTime, startOfCnDay } from "@/lib/datetime";
import { prisma } from "@/lib/db";

function Kpi({
  label,
  value,
  title,
}: {
  label: string;
  value: string;
  title?: string;
}): React.ReactElement {
  return (
    <div className="rounded-md border border-line bg-panel px-4 py-3" title={title}>
      <div className="text-[11px] leading-4 text-text-3">{label}</div>
      <div className="mt-1 font-mono text-xl font-semibold text-text-1">{value}</div>
    </div>
  );
}

/** 日批 status:今日成功绿 / 非今日成功灰 / 失败红 / 无运行灰 */
async function DailyStatusLine(): Promise<React.ReactElement> {
  const run = await prisma.jobRun.findFirst({
    where: { jobKey: "insight/daily" },
    orderBy: { startedAt: "desc" },
    select: { startedAt: true, status: true },
  });
  if (run === null) {
    return (
      <div className="rounded-md border border-line bg-panel px-4 py-2.5 text-[11px] text-text-3">
        每日分析 · 尚无运行记录(03:57 排程或页头手动触发)
      </div>
    );
  }
  const at = `${formatCnDate(run.startedAt).slice(5)} ${formatCnTime(run.startedAt)}`;
  const isToday = run.startedAt >= startOfCnDay();
  const ok = run.status === "success";
  const tone = ok ? (isToday ? "text-green" : "text-text-2") : "text-red";
  return (
    <div className="rounded-md border border-line bg-panel px-4 py-2.5 text-[11px]">
      <span className={`font-medium ${tone}`}>
        每日分析 · {isToday ? "今日" : at} {ok ? "成功" : `失败(${at})`}
      </span>
      {!ok && <span className="text-text-3"> · 归因见 运行 › 健康</span>}
    </div>
  );
}

export default async function OverviewHero({
  cloud,
  totalSignals,
  hotAvg,
}: {
  cloud: InsightCloudWord[];
  totalSignals: number;
  /** hot 簇机会分均值(页侧算;无簇 null → 「—」) */
  hotAvg: number | null;
}): Promise<React.ReactElement> {
  const since7d = new Date(Date.now() - 7 * 86_400_000);
  const [candidates7d, confirmed7d] = await Promise.all([
    prisma.discoveryKeyword.count({ where: { createdAt: { gte: since7d } } }),
    prisma.discoveryKeyword.count({ where: { confirmedAt: { gte: since7d } } }),
  ]);
  return (
    <div className="grid items-stretch gap-3 lg:grid-cols-[minmax(0,1fr)_220px]">
      <div className="rounded-md border border-line bg-panel px-4 py-3.5">
        <div className="mb-2 text-sm font-semibold">关键词云图</div>
        <KeywordCloud words={cloud} />
        <div className="mt-2 text-[11px] text-text-3">
          字号 = 机会分 · 点击词加入种子词库(active)
        </div>
      </div>
      <div className="flex flex-col gap-2">
        <Kpi label="候选增量 · 7天" value={`+${candidates7d}`} title="近 7 天新增发现候选词" />
        <Kpi
          label="信号总数"
          value={totalSignals.toLocaleString()}
          title="在役源(百度/知乎/B站热榜)信号池累计"
        />
        <Kpi
          label="机会均分(人写内容)"
          value={hotAvg === null ? "—" : String(Math.round(hotAvg))}
          title="当前机会簇(hot)机会分均值"
        />
        <Kpi label="新入词库" value={`+${confirmed7d}`} title="近 7 天确认生效词" />
        <DailyStatusLine />
      </div>
    </div>
  );
}
