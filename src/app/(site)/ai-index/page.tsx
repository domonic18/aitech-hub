import type { Metadata } from "next";

import { AiIndexCharts } from "@/components/site/ai-index/AiIndexCharts";
import { getEciFrontier } from "@/lib/ai-index/capability";
import { getEciSyncStatus, listAiIndexDaily } from "@/lib/ai-index/read";
import { parseTopEvents } from "@/lib/ai-index/top-events";

export const metadata: Metadata = {
  title: "AI 智能指数",
  description: "追踪 AI 发展速度：能力水位、冲击脉冲与智能指数趋势。",
};

export const revalidate = 300;

export default async function AiIndexPage(): Promise<React.ReactElement> {
  // 1. 能力层:Epoch ECI 前沿轨迹(来自 ai_index_eci_model 表,worker 日采)
  const frontier = await getEciFrontier();
  const eciFrontierData = frontier.map((r, i) => ({
    x: new Date(r.date).getTime(),
    y: r.eci,
    // 只标当前前沿模型的名称,避免 23 个点全标注
    label: i === frontier.length - 1 ? r.model : undefined,
  }));

  // 2. 脉冲层与合成指数:由 ai_index_daily 表驱动
  const dailyRows = await listAiIndexDaily(180);
  const intelligenceData = dailyRows.map((r) => ({
    x: new Date(r.date).getTime(),
    y: r.intelligenceIndex,
  }));
  const impactData = dailyRows.map((r) => ({
    x: new Date(r.date).getTime(),
    y: r.eventCount > 0 ? r.velocity : null,
  }));

  const sync = await getEciSyncStatus();
  const latest = dailyRows[dailyRows.length - 1];
  const latestEvents = latest ? parseTopEvents(latest.topEvents) : [];
  return (
    <section className="mx-auto w-full max-w-5xl px-4 py-8">
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-text-1">AI 智能指数</h1>
        <p className="mt-3 max-w-3xl text-text-2">
          两条线合成一个数：Epoch 的客观能力刻度(ECI)给出 AI 能力的真实水位， 电报流里当天真正与 AI
          相关的事件给出冲击脉冲。能力抬升是长线，事件冲击是台阶。
        </p>
        <p className="mt-2 text-xs text-text-3">
          {sync.modelCount > 0
            ? `ECI 数据截至 ${sync.latestModelDate ?? "未知"}（${sync.modelCount} 个模型）${
                sync.lastOkAt !== null
                  ? ` · 最近同步 ${sync.lastOkAt.toISOString().slice(0, 10)}`
                  : ""
              }`
            : "ECI 能力层尚无数据,等待首次日采同步。"}
        </p>
        {sync.stale && (
          <p className="mt-1 text-xs text-amber">
            能力水位同步已滞后 {sync.staleDays ?? "—"} 天,指数里的能力基线可能不是最新刻度。
          </p>
        )}
      </div>

      <AiIndexCharts
        intelligenceData={intelligenceData}
        eciFrontier={eciFrontierData}
        impactData={impactData}
        latestEvents={latestEvents}
        capabilityBaseline={latest?.capability ?? null}
      />
    </section>
  );
}
