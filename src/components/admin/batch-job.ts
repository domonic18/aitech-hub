"use client";

/**
 * 批量异步任务「提交 + 轮询」共用骨架(M17 批⑥从 PostsTable 抽出,seo-batch 与
 * wechat-batch 双消费):POST 入队 202 {jobId,token} → 定时轮询至 completed/failed。
 * 终态与错误经回调交回各批量条自渲染(onDone/onError),忙态管理留在调用方;
 * 提交中文案由调用方在调用前自置(onWaiting 语义并入)。
 */
import type { ApiEnvelope } from "@/lib/http/response";

/** 轮询响应 data(seo-batch 与 wechat-batch 共有字段的并集) */
export interface BatchPollData {
  state?: "waiting" | "active" | "completed" | "failed";
  error?: string | null;
  processed?: number;
  total?: number;
  skipped?: number;
  failedIds?: string[];
}

export async function runBatchJob<T extends { jobId?: string; token?: string }>(opts: {
  endpoint: string;
  body: unknown;
  /** jobId+token → 轮询地址(query 带 token,两路由同款) */
  pollUrl: (jobId: string, token: string) => string;
  pollMs: number;
  pollMax: number;
  timeoutMsg: string;
  /** 202 携带数据到达(轮询前);返回错误文案 = 直接收止(如 eligible 0 人话) */
  onSubmitted?: (data: T) => string | null;
  /** 进度文案(每次轮询数据都会回调,waiting/active 态) */
  onProgress: (d: BatchPollData) => void;
  /** completed(业务成功态;failedIds/skipped 语义各批量条自行解读) */
  onDone: (d: BatchPollData) => void;
  /** 提交失败/任务失败/网络错/超时(人话,调用方展示错误位) */
  onError: (msg: string) => void;
}): Promise<void> {
  try {
    const res = await fetch(opts.endpoint, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(opts.body),
    });
    const json = (await res.json().catch(() => null)) as ApiEnvelope<T> | null;
    if (!res.ok || json?.code !== 0 || !json.data?.jobId || !json.data?.token) {
      opts.onError(json?.message ?? `提交失败(${res.status})`);
      return;
    }
    if (opts.onSubmitted) {
      const veto = opts.onSubmitted(json.data);
      if (veto !== null) {
        opts.onError(veto);
        return;
      }
    }
    const { jobId, token } = json.data;
    for (let i = 0; i < opts.pollMax; i += 1) {
      await new Promise((r) => setTimeout(r, opts.pollMs));
      const poll = await fetch(opts.pollUrl(jobId, token));
      if (!poll.ok) continue;
      const body = (await poll.json().catch(() => null)) as ApiEnvelope<BatchPollData> | null;
      if (body?.code !== 0 || !body?.data) continue;
      const d = body.data;
      if (d.state === "completed") {
        opts.onDone(d);
        return;
      }
      if (d.state === "failed") {
        opts.onError(d.error ?? "批量任务失败");
        return;
      }
      opts.onProgress(d);
    }
    opts.onError(opts.timeoutMsg);
  } catch {
    opts.onError("网络错误,请重试");
  }
}
