/**
 * 分发任务轮询口径(M72 抽取):jobId/token 形状与状态映射。
 *
 * 为什么抽:HTTP 轮询路由与 MCP 工具都要认 jobId、校验 token、映射状态——
 * 两处各写一份必然漂移(校验松紧、状态枚举名不一致,agent 与前端看到的
 * 进度口径就分叉了)。这里出唯一口径,两侧同调。
 */
import type { WechatSyncResult } from "./wechat-sync-run";

/** BullMQ jobId 形状(本仓生成的形如 wechat-<base36> / pin-wechat-<base36>) */
export const DISTRIBUTE_JOB_ID_RE = /^[a-z0-9-]{6,60}$/;

/** 轮询 token 形状(uuid) */
export const DISTRIBUTE_TOKEN_RE = /^[0-9a-f-]{8,64}$/;

export type DistributeJobState = "waiting" | "active" | "completed" | "failed";

/** BullMQ 状态 → 轮询面四态(waiting/delayed/prioritized/unknown 归等待) */
export function mapDistributeJobState(st: string): DistributeJobState {
  if (st === "completed") return "completed";
  if (st === "failed") return "failed";
  if (st === "active") return "active";
  return "waiting";
}

/**
 * completed job 的结果投影(文章同步与贴图同步两种 returnvalue 同读):
 * 文章同步给 mediaId,贴图同步没有 mediaId(图片消息草稿)——取不到的置 null。
 */
export function distributeJobResult(job: { returnvalue: unknown }): {
  ok: boolean | null;
  mediaId: string | null;
  reason: string | null;
} {
  const rv = job.returnvalue as Partial<WechatSyncResult> | undefined;
  return {
    ok: rv?.ok ?? null,
    mediaId: rv?.mediaId ?? null,
    reason: rv?.reason ?? null,
  };
}
