"use client";

/**
 * 公众号同步记录表(M17 批①建;批⑤行操作+筛选/分页插槽):
 * 文章(链编辑页)/ 状态 soft chip(同 PostStatusBadge 三色语言:
 * synced 绿 / pending 琥珀 / failed 红)/ 微调快照 / syncedAt / 尝试 / 错误。
 * 行操作:「重新同步」POST sync + 轮询后刷新(pending 禁点);「清除绑定」
 * 清 media_id(公众号侧草稿被人工删后重推走新建)。筛选条/分页由 RSC 页面
 * 以 slot 注入(hrefFor 函数不能跨客户端边界,同 PostsTable children 模式)。
 */
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import type { ApiEnvelope } from "@/lib/http/response";
import type { PublishRecordRow } from "@/lib/distribute/records";

const STATUS_STYLES: Record<string, { chip: string; dot: string; label: string }> = {
  synced: { chip: "bg-green/12 text-green", dot: "bg-green", label: "已同步" },
  pending: { chip: "bg-amber/12 text-amber", dot: "bg-amber", label: "同步中" },
  failed: { chip: "bg-red/12 text-red", dot: "bg-red", label: "失败" },
};

const OP_BTN =
  "cursor-pointer rounded-sm bg-transparent px-1 py-0.5 text-[11px] text-accent hover:bg-accent-dim disabled:cursor-not-allowed disabled:opacity-50";

const SYNC_POLL_MS = 2_000;
const SYNC_POLL_MAX = 150; // 同 SyncWechatDialog:单篇最坏分钟级,兜底 5min

type SyncPollBody = ApiEnvelope<{
  state: "waiting" | "active" | "completed" | "failed";
  ok?: boolean | null;
  reason?: string | null;
} | null>;

function StatusBadge({ status }: { status: string }): React.ReactElement {
  const s = STATUS_STYLES[status] ?? {
    chip: "bg-panel-2 text-text-3",
    dot: "bg-text-3",
    label: status,
  };
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-sm px-2 py-0.5 text-xs font-medium ${s.chip}`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${s.dot}`} aria-hidden="true" />
      {s.label}
    </span>
  );
}

function fmtTime(d: Date | null): string {
  if (!d) return "—";
  return new Date(d).toLocaleString("zh-CN", { hour12: false });
}

/** 行内重新同步:入队 + 轮询至终态,完成后 router.refresh 拉新记录 */
function makeResync(
  router: ReturnType<typeof useRouter>,
  refreshRow: (id: string, error: string | null) => void,
) {
  return async (row: PublishRecordRow): Promise<void> => {
    refreshRow(row.id, null);
    try {
      const res = await fetch("/api/distribute/wechat/sync", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ postId: row.postId }),
      });
      const json = (await res.json().catch(() => null)) as ApiEnvelope<{
        jobId?: string;
        token?: string;
      }> | null;
      if (!res.ok || json?.code !== 0 || !json.data?.jobId || !json.data?.token) {
        refreshRow(row.id, json?.message ?? `提交失败(${res.status})`);
        return;
      }
      const { jobId, token } = json.data;
      for (let i = 0; i < SYNC_POLL_MAX; i += 1) {
        await new Promise((r) => setTimeout(r, SYNC_POLL_MS));
        const poll = await fetch(
          `/api/distribute/wechat/sync/${jobId}?token=${encodeURIComponent(token)}`,
        );
        if (!poll.ok) continue;
        const body = (await poll.json().catch(() => null)) as SyncPollBody | null;
        if (body?.code !== 0 || !body?.data) continue;
        const d = body.data;
        if (d.state === "completed" || d.state === "failed") {
          refreshRow(row.id, d.state === "failed" || !d.ok ? (d.reason ?? "同步失败") : null);
          router.refresh();
          return;
        }
      }
      refreshRow(row.id, "轮询超时:任务仍在后台,稍后刷新本页查看");
    } catch {
      refreshRow(row.id, "网络错误,请重试");
    }
  };
}

export default function SyncRecordsTable({
  rows,
  total,
  filter,
  children,
}: {
  rows: PublishRecordRow[];
  total: number;
  filter?: React.ReactNode;
  children?: React.ReactNode;
}) {
  // 行级忙/错状态(重新同步是分钟级异步,行内就地反馈;刷新后由 RSC 状态接管)
  const router = useRouter();
  const [busyIds, setBusyIds] = useState<Set<string>>(new Set());
  const [rowErrors, setRowErrors] = useState<Record<string, string>>({});
  const refreshRow = (id: string, error: string | null): void => {
    setBusyIds((prev) => {
      const next = new Set(prev);
      if (error === null) next.add(id);
      else next.delete(id);
      return next;
    });
    if (error !== null) setRowErrors((prev) => ({ ...prev, [id]: error }));
  };
  const resync = makeResync(router, refreshRow);

  async function clearBinding(row: PublishRecordRow): Promise<void> {
    if (
      !window.confirm(
        "确认清除该记录的 media_id 绑定?下一次同步将重新在公众号后台新建草稿(现绑定对应的草稿若仍存在,会残留一份副本)。",
      )
    ) {
      return;
    }
    refreshRow(row.id, null);
    try {
      const res = await fetch(`/api/distribute/records/${row.id}/reset`, { method: "POST" });
      const json = (await res.json().catch(() => null)) as ApiEnvelope<null> | null;
      if (!res.ok || json?.code !== 0) {
        refreshRow(row.id, json?.message ?? `操作失败(${res.status})`);
        return;
      }
      router.refresh();
    } catch {
      refreshRow(row.id, "网络错误,请重试");
    }
  }

  return (
    <div className="rounded-md border border-line bg-panel">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-3">
        <div className="text-[12.5px] text-text-2">同步记录</div>
        {filter}
        <div className="font-mono text-[11px] text-text-3">共 {total} 条</div>
      </div>
      {rows.length === 0 ? (
        <div className="px-4 py-10 text-center text-xs text-text-3">
          暂无同步记录——在文章列表或编辑页点「同步公众号」后,这里记录每次推送状态
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-[12.5px]">
            <thead>
              <tr className="border-b border-line bg-panel-2 text-[11px] text-text-3">
                <th className="px-4 py-2 font-medium">文章</th>
                <th className="px-3 py-2 font-medium">状态</th>
                <th className="px-3 py-2 font-medium">推送标题</th>
                <th className="px-3 py-2 font-medium">草稿 media_id</th>
                <th className="px-3 py-2 font-medium">同步时间</th>
                <th className="px-3 py-2 font-medium">尝试</th>
                <th className="px-3 py-2 font-medium">错误</th>
                <th className="px-4 py-2 text-right font-medium">操作</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const busy = busyIds.has(r.id) || r.status === "pending";
                return (
                  <tr
                    key={r.id}
                    className="border-b border-line/60 last:border-0 hover:bg-panel-2/60"
                  >
                    <td className="max-w-[220px] px-4 py-2">
                      <Link
                        href={`/admin/posts/${r.postId}`}
                        className="block truncate text-accent hover:underline"
                        title={r.postTitle}
                      >
                        {r.postTitle}
                      </Link>
                    </td>
                    <td className="px-3 py-2">
                      <StatusBadge status={busyIds.has(r.id) ? "pending" : r.status} />
                    </td>
                    <td
                      className="max-w-[180px] truncate px-3 py-2 text-text-2"
                      title={r.title ?? ""}
                    >
                      {r.title ?? "—"}
                    </td>
                    <td
                      className="max-w-[160px] truncate px-3 py-2 font-mono text-[11px] text-text-2"
                      title={r.mediaId ?? ""}
                    >
                      {r.mediaId ?? "—"}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 text-text-2">
                      {fmtTime(r.syncedAt)}
                    </td>
                    <td className="px-3 py-2 font-mono text-text-3">{r.attempts}</td>
                    <td
                      className="max-w-[240px] truncate px-3 py-2 text-red"
                      title={rowErrors[r.id] ?? r.lastError ?? ""}
                    >
                      {rowErrors[r.id] ?? r.lastError ?? "—"}
                    </td>
                    <td className="whitespace-nowrap px-4 py-2 text-right">
                      <button
                        type="button"
                        disabled={busy}
                        title={
                          busy
                            ? "同步任务进行中,完成后可再操作"
                            : "按上次推送的标题/摘要/封面重新推送到公众号草稿箱"
                        }
                        className={OP_BTN}
                        onClick={() => void resync(r)}
                      >
                        {busyIds.has(r.id) || r.status === "pending" ? "同步中" : "重新同步"}
                      </button>
                      {r.mediaId && (
                        <button
                          type="button"
                          disabled={busy}
                          title="清除 media_id 绑定:公众号侧草稿被人工删除后,用此操作让下次同步重新新建"
                          className={`${OP_BTN} ml-1.5`}
                          onClick={() => void clearBinding(r)}
                        >
                          清除绑定
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {children}
    </div>
  );
}
