/**
 * 外链批量转存客户端(技术债批⑤,自 ImportPostsModal 抽出):POST
 * /api/media/import 入队 → 1.5s 步进轮询 GET ?job= 直至 completed/failed/
 * 预算耗尽。轮询次数按最坏转存时长(单张超时 × 张数)+ 缓冲推导,避免客户端
 * 先于 worker 放弃(评审 S2:30 张 × 15s 最坏 450s > 固定 180s 预算)。任一
 * 失败不抛:未成 URL 映射 null,由调用方逐条落状态与 warning。
 */
import { type ApiEnvelope } from "@/lib/http/response";
import { type TransferResult, MEDIA_LIMITS } from "@/lib/media/media-schema";
import type { ImportMapping } from "@/lib/media/import-md";

const POLL_INTERVAL_MS = 1_500;
const POLL_BUFFER_MS = 30_000;

function pollTriesFor(count: number): number {
  return Math.ceil((count * MEDIA_LIMITS.fetchTimeoutMs + POLL_BUFFER_MS) / POLL_INTERVAL_MS);
}

export async function runImportTransfer(urls: string[]): Promise<ImportMapping> {
  const post = await fetch("/api/media/import", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ urls }),
  });
  if (!post.ok) return Object.fromEntries(urls.map((u) => [u, null]));
  const postBody = (await post.json().catch(() => null)) as ApiEnvelope<{
    jobId?: string;
  } | null> | null;
  const jobId = postBody?.data?.jobId;
  if (!jobId) return Object.fromEntries(urls.map((u) => [u, null]));
  // 轮询直至完成(转存任务在 worker 执行;超时预算按最坏抓取时长推导)
  for (let i = 0; i < pollTriesFor(urls.length); i += 1) {
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
    const poll = await fetch(`/api/media/import?job=${encodeURIComponent(jobId)}`);
    if (!poll.ok) continue;
    const body = (await poll.json().catch(() => null)) as ApiEnvelope<{
      state?: string;
      result?: TransferResult | null;
    } | null> | null;
    if (body?.data?.state === "completed" && body.data.result) {
      return body.data.result.mapping;
    }
    if (body?.data?.state === "failed") break;
  }
  return Object.fromEntries(urls.map((u) => [u, null]));
}
