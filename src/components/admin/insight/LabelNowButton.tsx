"use client";

/**
 * 立即打标(M60 批C):簇详情页手动补标——POST /api/insight/clusters/[id]/label
 * 入 insight 队列单簇打标 job(与每 30 分钟小批同处理器);后端先做零 LLM 前置
 * 检查(模型绑定/当日配额/成员数),阻断原因人话直出。执行在 worker,成功后
 * 提示去刷新(打标结果落簇行,刷新即见)。
 */
import { useState } from "react";

import type { ApiEnvelope } from "@/lib/http/response";

interface LabelEnqueueResult {
  jobId: string;
  clusterId: string;
}

export default function LabelNowButton({
  clusterId,
  label = "立即打标",
}: {
  clusterId: string;
  /** 按钮文案(痛点页作「重新归纳」) */
  label?: string;
}): React.ReactElement {
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run(): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/insight/clusters/${clusterId}/label`, { method: "POST" });
      const body = (await res.json()) as ApiEnvelope<LabelEnqueueResult>;
      if (body.code !== 0) {
        setError(body.message);
        return;
      }
      setDone(true);
    } catch {
      setError("请求失败,请重试");
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <span className="text-[11px] text-text-2" title="worker 数十秒内完成,刷新本页可见">
        已入队打标 · 数十秒后刷新查看
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-2">
      <button
        type="button"
        disabled={busy}
        onClick={() => void run()}
        className="cursor-pointer rounded-sm bg-panel-2 px-2.5 py-1 text-xs text-text-2 hover:text-text-1 disabled:cursor-not-allowed disabled:opacity-50"
        title="单簇立即打标(不等待日批;消耗一次洞察归纳配额)"
      >
        {busy ? "入队中…" : label}
      </button>
      {error && <span className="text-[11px] text-red">{error}</span>}
    </span>
  );
}
