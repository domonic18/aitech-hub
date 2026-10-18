"use client";

/**
 * 定时任务手动触发按钮组(M25 批③,验收二批①泛化):props 缺省即发现二按钮
 * (POST /api/discovery/trigger);洞察域经 props 复用(hotboard 拉热榜/daily
 * 跑日批 → POST /api/insight/trigger)。入队即返回(执行与风控/LLM 节奏在
 * worker),结果看对应台账。按钮态:入队中禁点 → 成功短暂示「已入队」→ 复位。
 */
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";

import type { ApiEnvelope } from "@/lib/http/response";

export type TriggerJobDef = { job: string; label: string; hint: string };

const DISCOVERY_JOBS: readonly TriggerJobDef[] = [
  { job: "hotwords", label: "热词发现", hint: "联想词源直拉,新词落 pending" },
  { job: "bili", label: "B站发现", hint: "双窗搜索+聚合+L0,耗时数分钟" },
];

export default function TriggerButtons({
  endpoint = "/api/discovery/trigger",
  jobs = DISCOVERY_JOBS,
}: {
  endpoint?: string;
  jobs?: readonly TriggerJobDef[];
}) {
  const router = useRouter();
  const [busyJob, setBusyJob] = useState<string | null>(null);
  const [doneJob, setDoneJob] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  async function trigger(job: string): Promise<void> {
    if (busyJob) return;
    setBusyJob(job);
    setErr(null);
    try {
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ job }),
      });
      const body = (await res.json()) as ApiEnvelope;
      if (!res.ok || body.code !== 0) {
        setErr(body.message || `触发失败(${res.status})`);
        return;
      }
      setDoneJob(job);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => setDoneJob(null), 3000);
      router.refresh();
    } catch {
      setErr("网络异常,请重试");
    } finally {
      setBusyJob(null);
    }
  }

  return (
    <div className="flex flex-col items-end gap-0.5">
      <div className="flex items-center gap-2">
        {jobs.map(({ job, label, hint }) => (
          <button
            key={job}
            type="button"
            title={hint}
            disabled={busyJob !== null}
            onClick={() => void trigger(job)}
            className="rounded-sm border border-line bg-panel px-2.5 py-1 text-xs text-text-2 hover:border-line-hover hover:text-text-1 disabled:opacity-50"
          >
            {busyJob === job ? "入队中…" : doneJob === job ? "已入队 ✓" : `▶ ${label}`}
          </button>
        ))}
      </div>
      {err && <span className="text-[11px] text-red">{err}</span>}
    </div>
  );
}
