/**
 * F20 按博主排队卡:视频博主三态逐行——● 采集中(运行时钟)/ ○ 排队中
 * (waiting job 计数)/ ✓ 已入库(累计条数·最近采集)。取数复用 F27 台账
 * 同源(videoRunningAccounts / listBloggerVideoCounts),排队经 crawler
 * waiting job data.accountId 归并。
 */
import { videoRunningAccounts, videoWaitingAccounts } from "@/lib/collect/crawler-runs";
import { listBloggersAdmin, listBloggerVideoCounts } from "@/lib/telegram/bloggers-admin";
import { VIDEO_PLATFORM_LABELS } from "@/lib/telegram/constants";

function elapsed(ms: number): string {
  const s = Math.max(0, Math.floor((Date.now() - ms) / 1000));
  return `${Math.floor(s / 60)}m ${s % 60}s`;
}

/** 「N 分钟前 / N 小时前 / —」(最近采集相对时刻) */
function ago(at: Date | null): string {
  if (at === null) return "—";
  const m = Math.floor((Date.now() - at.getTime()) / 60_000);
  return m < 60 ? `${Math.max(1, m)} 分钟前` : `${Math.floor(m / 60)} 小时前`;
}

export default async function BloggerQueueCard(): Promise<React.ReactElement> {
  const [bloggers, videoCounts, running, waiting] = await Promise.all([
    listBloggersAdmin(),
    listBloggerVideoCounts(),
    videoRunningAccounts(),
    videoWaitingAccounts(),
  ]);

  const rows = bloggers
    .map((b) => {
      const sinceMs = running.get(b.id);
      const queued = waiting.get(b.id) ?? 0;
      const mode: "running" | "queued" | "done" =
        sinceMs !== undefined ? "running" : queued > 0 ? "queued" : "done";
      return {
        id: b.id,
        name: b.nickname,
        platform: VIDEO_PLATFORM_LABELS[b.platform] ?? b.platform,
        mode: mode as "running" | "queued" | "done",
        sinceMs: sinceMs ?? null,
        queued,
        count: videoCounts.get(`${b.platform}\n${b.nickname}`) ?? 0,
        lastRunAt: b.lastRunAt,
      };
    })
    .sort((a, b) => {
      const rank = { running: 0, queued: 1, done: 2 } as const;
      return rank[a.mode] - rank[b.mode] || b.count - a.count;
    });

  return (
    <div className="rounded-md border border-line bg-panel">
      <div className="flex items-center justify-between border-b border-line px-4 py-3 text-sm font-semibold">
        按博主
        <span className="font-mono text-[11px] font-normal text-text-3">
          采集中 {rows.filter((r) => r.mode === "running").length} · 排队{" "}
          {rows.filter((r) => r.mode === "queued").length}
        </span>
      </div>
      <div className="grid gap-x-6 px-4 py-3 sm:grid-cols-2 xl:grid-cols-3">
        {rows.map((r) => (
          <div key={r.id} className="flex items-center gap-2 py-1 text-xs">
            {r.mode === "running" ? (
              <>
                <i className="inline-block h-1.5 w-1.5 shrink-0 animate-pulse rounded-full bg-amber" />
                <span className="truncate text-text-1" title={`${r.platform} · ${r.name}`}>
                  {r.name}
                </span>
                <span className="ml-auto shrink-0 text-amber-hi">
                  采集中 · {elapsed(r.sinceMs ?? Date.now())}
                </span>
              </>
            ) : r.mode === "queued" ? (
              <>
                <i className="inline-block h-1.5 w-1.5 shrink-0 rounded-full border border-line-hover" />
                <span className="truncate text-text-2" title={`${r.platform} · ${r.name}`}>
                  {r.name}
                </span>
                <span className="ml-auto shrink-0 text-text-3">排队 {r.queued} 轮</span>
              </>
            ) : (
              <>
                <span className="shrink-0 text-green">✓</span>
                <span className="truncate text-text-2" title={`${r.platform} · ${r.name}`}>
                  {r.name}
                </span>
                <span className="ml-auto shrink-0 text-text-3">
                  已入库 {r.count} 条 · {ago(r.lastRunAt)}
                </span>
              </>
            )}
          </div>
        ))}
        {rows.length === 0 && (
          <p className="col-span-full py-4 text-center text-xs text-text-3">
            暂无登记博主——「源管理 · 博主台账」登记后此处出排队实况
          </p>
        )}
      </div>
    </div>
  );
}
