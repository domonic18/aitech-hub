"use client";

import Link from "next/link";

import { ECI_CSV_URL, ECI_LICENSE, ECI_LICENSE_URL } from "@/lib/ai-index/constants";
import type { TopEvent } from "@/lib/ai-index/top-events";
import { LineChart, type LineChartPoint } from "./LineChart";
import { AiTopEvents } from "./AiTopEvents";

interface ChartData {
  intelligenceData: LineChartPoint[];
  eciFrontier: LineChartPoint[];
  impactData: LineChartPoint[];
  latestEvents: TopEvent[];
  capabilityBaseline: number | null;
}

function dateFormatter(ts: number): string {
  const d = new Date(ts);
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

/** 外链:新窗口打开,带 noopener */
function ExtLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="text-accent underline decoration-dotted underline-offset-2 hover:text-accent-hover"
    >
      {children}
    </a>
  );
}

const LINK_CLASS =
  "text-accent underline decoration-dotted underline-offset-2 hover:text-accent-hover";

function ChartCard({
  title,
  description,
  source,
  meaning,
  axis,
  children,
}: {
  title: string;
  description: string;
  source: React.ReactNode;
  meaning: string;
  axis: string;
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <div className="rounded-lg border border-line bg-panel p-5">
      <h2 className="text-lg font-semibold text-text-1">{title}</h2>
      <p className="mt-1 text-sm text-text-3">{description}</p>
      <div className="mt-4">{children}</div>
      <div className="mt-4 rounded-md border border-line/60 bg-panel-2/50 px-3.5 py-2.5 text-xs leading-relaxed text-text-3">
        <p>
          <span className="font-medium text-text-2">数据来源：</span>
          {source}
        </p>
        <p className="mt-1">
          <span className="font-medium text-text-2">代表意义：</span>
          {meaning}
        </p>
        <p className="mt-1">
          <span className="font-medium text-text-2">坐标说明：</span>
          {axis}
        </p>
      </div>
    </div>
  );
}

export function AiIndexCharts({
  intelligenceData,
  eciFrontier,
  impactData,
  latestEvents,
  capabilityBaseline,
}: ChartData): React.ReactElement {
  return (
    <div className="grid gap-8">
      <ChartCard
        title="AI 智能指数"
        description="Epoch 客观能力水位 × 电报流 AI 冲击脉冲合成的总指数，一张图看 AI 整体水位。"
        source={
          <>
            <ExtLink href={ECI_CSV_URL}>Epoch AI Capabilities Index(eci_scores.csv)</ExtLink>(
            <ExtLink href={ECI_LICENSE_URL}>{ECI_LICENSE}</ExtLink>)+ 站内
            <Link href="/telegram/" className={LINK_CLASS}>
              电报流
            </Link>
            AI 相关条目的净冲击分,worker 每日聚合。
          </>
        }
        meaning="虚线是能力基线(Epoch ECI 锚定的能力水位,只随新模型发布缓慢抬升);实线是智能指数 = 能力基线 + 当日冲击加成。实线抬离基线,说明这段时间 AI 事件密集且量级大;贴着基线,说明能力在涨但当下缺少重磅事件。"
        axis="横轴为日期;纵轴为智能指数 = 能力基线(以当前前沿 ECI = 100 归一)+ 冲击加成(0–5 分,由当日冲击分百分位折算)。"
      >
        <LineChart
          data={intelligenceData}
          reference={
            capabilityBaseline !== null ? { y: capabilityBaseline, label: "能力基线(ECI)" } : null
          }
          xFormatter={dateFormatter}
          xLabel="日期"
          yLabel="智能指数"
          ariaLabel="AI 智能指数趋势"
        />
      </ChartCard>

      <ChartCard
        title="AI 能力水位(Epoch ECI)"
        description="每刷新一次历史最高分的模型,连成 AI 能力前沿的推进轨迹。"
        source={
          <>
            <ExtLink href={ECI_CSV_URL}>Epoch AI 官方 Capabilities Index(eci_scores.csv)</ExtLink>
            (258 个模型,含 90% 可信区间),由基准测试 IRT 拟合得出。
          </>
        }
        meaning="这是 AI 能力的客观刻度,不依赖新闻口径。曲线每抬升一次,代表出现了一个把能力上限推得更远的模型;2023→2026 前沿 ECI 由 121.6 升到 173.4。"
        axis="横轴为模型发布日期;纵轴为 ECI 分值(Epoch 的统一能力刻度,无量纲,数值越大综合能力越强)。"
      >
        <LineChart
          data={eciFrontier}
          xFormatter={dateFormatter}
          xLabel="发布日期"
          yLabel="ECI 能力分"
          ariaLabel="AI 能力前沿轨迹"
        />
      </ChartCard>

      <ChartCard
        title="AI 冲击分"
        description="当天 AI 相关资讯的净冲击强度在近半年里的相对位置,曲线下方为当日具体事件。"
        source={
          <>
            站内
            <Link href="/telegram/" className={LINK_CLASS}>
              电报流
            </Link>
            可见条目 → 相关性闸(只保留 AI 相关)→ Jev(System One)判分(失败回落规则打分)→ 净冲击聚合 →
            滚动窗口百分位。
          </>
        }
        meaning="反映「AI 这段时间发生了多少事、发生了多大的事」。峰值 = 密集且重磅的一波进展;断点 = 当天没有可计入的 AI 条目(不是「AI 停滞」)。"
        axis="横轴为日期;纵轴为冲击分(0–100 百分位:当天净冲击强度在滚动 180 天窗口中的相对位置,非绝对条数)。"
      >
        <LineChart
          data={impactData}
          xFormatter={dateFormatter}
          xLabel="日期"
          yLabel="冲击分"
          ariaLabel="AI 冲击分趋势"
        />
        <AiTopEvents events={latestEvents} title="当日贡献最大的 AI 事件" />
      </ChartCard>
    </div>
  );
}
