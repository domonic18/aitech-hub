"use client";

/**
 * 重复检测分组视图(原型 admin-media「重复检测(同 sha1 分组)」.dupe-row 形态;
 * 2026-10-06 验收反馈问题1):同 sha1 ≥2 条一组,keeper=最早一条;
 * 「保留 1 个并合并引用」→ POST /api/media/dupes/merge,成功后 router.refresh
 * 重拉本页 RSC(组消失即完成)。原型「导出清单」后置:单机量级,合并即终结。
 */
import { useRouter } from "next/navigation";
import { useState } from "react";

import { formatCnDateTime } from "@/lib/datetime";
import type { ApiEnvelope } from "@/lib/http/response";
import { formatBytes } from "@/lib/media/media-schema";

export interface MediaDupeItemView {
  id: string;
  path: string;
  filename: string;
  sizeBytes: number | null;
  width: number | null;
  height: number | null;
  thumbPath: string | null;
  createdAt: Date;
  refCount: number;
  coverCount: number;
}

export interface MediaDupeGroupView {
  sha1: string;
  keeperId: string;
  items: MediaDupeItemView[];
  releasableBytes: number;
}

export default function MediaDupeList({ groups }: { groups: MediaDupeGroupView[] }) {
  const router = useRouter();
  const [busySha1, setBusySha1] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function merge(group: MediaDupeGroupView): Promise<void> {
    if (
      !confirm(
        `合并该重复组?保留最早一条(其余 ${group.items.length - 1} 个副本的引用改指保留项后入回收站)。`,
      )
    )
      return;
    setBusySha1(group.sha1);
    setError(null);
    try {
      const res = await fetch("/api/media/dupes/merge", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sha1: group.sha1 }),
      });
      const body = (await res.json()) as ApiEnvelope;
      if (body.code !== 0) {
        setError(body.message || `HTTP ${res.status}`);
        return;
      }
      router.refresh();
    } catch {
      setError("网络错误,请重试");
    } finally {
      setBusySha1(null);
    }
  }

  const totalBytes = groups.reduce((sum, g) => sum + g.releasableBytes, 0);
  return (
    <div className="rounded-md border border-line bg-panel">
      <div className="border-b border-line px-4 py-3 text-[13px] font-semibold">
        重复检测(同 sha1 分组)
        <span className="ml-2 font-mono text-[11px] font-normal text-text-3">
          发现 {groups.length} 组 · 可释放 ~{formatBytes(totalBytes)}
        </span>
      </div>
      <div className="divide-y divide-line">
        {groups.map((g) => {
          const keeper = g.items.find((i) => i.id === g.keeperId) ?? g.items[0]!;
          const uses =
            keeper.refCount + keeper.coverCount > 0
              ? `正文引用 ${keeper.refCount} · 封面 ${keeper.coverCount}`
              : "暂无引用";
          return (
            <div
              key={g.sha1}
              className="grid grid-cols-[84px_1fr] items-center gap-3 px-4 py-3 sm:grid-cols-[84px_1fr_auto]"
            >
              <div className="flex -space-x-3">
                {g.items.slice(0, 3).map((item, idx) =>
                  item.thumbPath || /\.(jpe?g|png|webp|gif)$/i.test(item.path) ? (
                    // eslint-disable-next-line @next/next/no-img-element -- 本地媒体卷缩略图,不走 next/image 优化域
                    <img
                      key={item.id}
                      src={item.thumbPath ?? item.path}
                      alt=""
                      className={`h-14 w-[84px] flex-none rounded-sm border object-cover ${
                        idx === 0 ? "border-accent" : "border-line"
                      }`}
                    />
                  ) : (
                    <span
                      key={item.id}
                      className={`flex h-14 w-[84px] flex-none items-center justify-center rounded-sm border bg-panel-2 font-mono text-[10px] text-text-3 ${
                        idx === 0 ? "border-accent" : "border-line"
                      }`}
                    >
                      副本
                    </span>
                  ),
                )}
                {g.items.length > 3 && (
                  <span className="z-10 flex h-14 w-6 flex-none items-center justify-center rounded-sm border border-line bg-panel-2 font-mono text-[10px] text-text-3">
                    +{g.items.length - 3}
                  </span>
                )}
              </div>
              <div className="min-w-0">
                <div className="truncate text-[12.5px] text-text-1" title={keeper.filename}>
                  {keeper.filename} ×{g.items.length}
                </div>
                <div className="mt-0.5 truncate font-mono text-[10.5px] text-text-3" title={g.sha1}>
                  sha1: {`${g.sha1.slice(0, 6)}…${g.sha1.slice(-4)}`} ·{" "}
                  {keeper.width && keeper.height ? `${keeper.width}×${keeper.height} · ` : ""}
                  {formatBytes(Number(keeper.sizeBytes ?? 0))} · {uses}
                </div>
                <div className="mt-0.5 text-[10.5px] text-text-3">
                  保留最早({formatCnDateTime(keeper.createdAt)}),合并后其余副本入回收站
                </div>
              </div>
              <div className="col-span-2 sm:col-span-1">
                <button
                  type="button"
                  disabled={busySha1 === g.sha1}
                  onClick={() => void merge(g)}
                  className="w-full cursor-pointer rounded-sm border border-green/35 bg-green/10 px-3 py-1.5 text-xs text-green hover:bg-green/15 disabled:opacity-50 sm:w-auto"
                >
                  {busySha1 === g.sha1 ? "合并中…" : "保留 1 个并合并引用"}
                </button>
              </div>
            </div>
          );
        })}
      </div>
      {error && <p className="px-4 pb-3 font-mono text-xs text-red">{error}</p>}
    </div>
  );
}
