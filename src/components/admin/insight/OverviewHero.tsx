/**
 * F11 分析总览 hero 行:左关键词云图卡(搜索 + 舆情四色 + 图例筛选 + 点词入
 * 词库),右 KPI 四竖列(候选增量·7天 / 信号总数 / 机会均分(人写内容) /
 * 新入词库)+ 底部日批 status 行「每日分析 · 今日 HH:MM 成功」+ 打标覆盖行
 * (M60 批C:已打标/可打标(待打标数),与榜单/打标选择器同口径)。KPI 不随窗口
 * chips(板定 7 天增量与全量总数);领域口径(M54 批C):信号总数/机会均分
 * 随页头领域 chips(词库两卡恒全局,发现词库无域维度);机会均分由页侧按当前
 * hot 簇均分传入;词云卡头标窗口口径(windowDays)——窗口 chips 只影响词云,
 * 标识让取景范围可见。读法提示(字号=机会分/颜色=舆情/点词入词库)随图例行在
 * KeywordCloud。
 */
import KeywordCloud from "@/components/admin/insight/KeywordCloud";
import { formatCnDate, formatCnTime, startOfCnDay } from "@/lib/datetime";
import { countLabelingCoverage, discoveryKeyword7dCounts } from "@/lib/insight/admin";
import { LABEL_MIN_MEMBERS } from "@/lib/insight/constants";
import type { InsightCloudWord } from "@/lib/insight/hotboard";
import { latestJobRun } from "@/lib/jobs/runlog-admin";

function Kpi({
  label,
  value,
  title,
}: {
  label: string;
  value: string;
  title?: string;
}): React.ReactElement {
  // flex-1 + 垂直居中:右栏四卡均分列高,底边与左侧云图卡对齐(2026-10-24 验收反馈:
  // 云图卡高于 KPI 列时右下留白,不美观)
  return (
    <div
      className="flex flex-1 flex-col justify-center rounded-md border border-line bg-panel px-4 py-3"
      title={title}
    >
      <div className="text-[11px] leading-4 text-text-3">{label}</div>
      <div className="mt-1 font-mono text-xl font-semibold text-text-1">{value}</div>
    </div>
  );
}

/** 日批 status:今日成功绿 / 非今日成功灰 / 失败红 / 无运行灰 */
async function DailyStatusLine(): Promise<React.ReactElement> {
  const run = await latestJobRun("insight/daily");
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

/** 打标覆盖 status:已打标/可打标(待打标数);待打标 >0 标黄(每 30 分钟小批消化) */
async function LabelingStatusLine({ domain }: { domain?: string }): Promise<React.ReactElement> {
  const cov = await countLabelingCoverage(domain);
  const tone = cov.pending === 0 ? "text-green" : "text-amber-hi";
  return (
    <div className="rounded-md border border-line bg-panel px-4 py-2.5 text-[11px]">
      <span className={`font-medium ${tone}`}>
        打标覆盖 · {cov.labeled.toLocaleString()}/{cov.labelable.toLocaleString()}
        {cov.pending > 0 ? `(${cov.pending.toLocaleString()} 待打标)` : " · 已全部命名"}
      </span>
      <span className="text-text-3">
        {" "}
        · 可打标 = 活跃簇且成员 ≥{LABEL_MIN_MEMBERS};每 30 分钟小批消化,日批兜底
      </span>
    </div>
  );
}

export default async function OverviewHero({
  cloud,
  totalSignals,
  hotAvg,
  windowDays,
  domain,
}: {
  cloud: InsightCloudWord[];
  totalSignals: number;
  /** hot 簇机会分均值(页侧算;无簇 null → 「—」) */
  hotAvg: number | null;
  /** 词云窗口(页头窗口 chips),用于卡头口径标识 */
  windowDays: number;
  /** 领域视图(页头领域 chips;undefined=全量),打标覆盖随域 */
  domain?: string;
}): Promise<React.ReactElement> {
  const { candidates7d, confirmed7d } = await discoveryKeyword7dCounts();
  return (
    <div className="grid items-stretch gap-3 lg:grid-cols-[minmax(0,1fr)_220px]">
      <div className="rounded-md border border-line bg-panel px-4 py-3.5">
        <div className="mb-2 text-sm font-semibold">
          关键词云图
          <span className="ml-2 text-[11px] font-normal text-text-3">
            近 {windowDays} 天活跃 · 窗口/领域随页头 chips
          </span>
        </div>
        <KeywordCloud words={cloud} />
      </div>
      {/* 移动端 KPI 两列铺(四竖排占满屏高、留白过多);lg 起恢复竖列与云图卡等高 */}
      <div className="grid grid-cols-2 gap-2 lg:flex lg:flex-col">
        <Kpi
          label="候选增量 · 7天"
          value={`+${candidates7d}`}
          title="近 7 天新增发现候选词(词库全局,不随领域)"
        />
        <Kpi
          label="信号总数"
          value={totalSignals.toLocaleString()}
          title="在役源信号池累计(随页头领域 chips;全部=含未分类)"
        />
        <Kpi
          label="机会均分(人写内容)"
          value={hotAvg === null ? "—" : String(Math.round(hotAvg))}
          title="当前机会簇(hot)机会分均值(随页头领域 chips)"
        />
        <Kpi
          label="新入词库"
          value={`+${confirmed7d}`}
          title="近 7 天确认生效词(词库全局,不随领域)"
        />
        {/* 状态行恒占整行(两列栅格里并排会把文案挤成两行半) */}
        <div className="col-span-2 flex flex-col gap-2">
          <DailyStatusLine />
          <LabelingStatusLine domain={domain} />
        </div>
      </div>
    </div>
  );
}
