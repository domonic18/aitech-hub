"use client";

/**
 * 重复检测分组视图(原型 admin-media「重复检测(同 sha1 分组)」.dupe-row 形态;
 * 2026-10-06 验收反馈问题3 重做):同 sha1 ≥2 条一组,keeper=最早一条;
 * 每组独立带边框行卡,缩略图并排(不叠放),keeper 高亮;「保留 1 个并合并引用」
 * → POST /api/media/dupes/merge,成功后 router.refresh 重拉本页 RSC(组消失即完成)。
 * 原型「导出清单」后置:单机量级,合并即终结(M14 定)。
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

/** 缩略图并排上限,余量以 +N 计数收尾(不叠图) */
const THUMB_MAX = 3;

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
    /* 原型:网格下方的独立分区(margin-top + border-top 分隔 + #i-scan 标题行) */
    <div className="mt-5 border-t border-line pt-4">
      <div className="mb-3 flex items-center gap-2.5">
        <h3 className="flex items-center gap-1.5 text-[15px] font-semibold">
          <svg className="ic" aria-hidden="true">
            <use href="#i-scan" />
          </svg>
          重复检测(同 sha1 分组)
        </h3>
        <span className="font-mono text-[11.5px] text-text-3">
          发现 {groups.length} 组 · 可释放 ~{formatBytes(totalBytes)}
        </span>
      </div>

      {groups.map((g) => {
        const keeper = g.items.find((i) => i.id === g.keeperId) ?? g.items[0]!;
        const keeperUses = keeper.refCount + keeper.coverCount > 0;
        // 原型「建议:…」句式,按 keeper 引用情况分两句式
        const advice = keeperUses
          ? "建议:保留一个,其余副本的引用自动合并指向保留项"
          : "建议:保留一个,其余副本入回收站(该组暂无引用)";
        const uses = keeperUses
          ? `正文引用 ${keeper.refCount} · 封面 ${keeper.coverCount}`
          : "暂无引用";
        return (
          /* 每组独立行卡(原型 .dupe-row:auto 首轨容纳缩略图并排 + 1fr + auto,不叠放不压字) */
          <div
            key={g.sha1}
            className="mb-2.5 grid grid-cols-[auto_1fr] items-center gap-3.5 rounded-sm border border-line bg-panel px-3.5 py-3 sm:grid-cols-[auto_1fr_auto]"
          >
            <div className="flex items-center gap-1.5">
              {g.items.slice(0, THUMB_MAX).map((item) => {
                const isKeeper = item.id === g.keeperId;
                const cls = `h-14 w-[84px] rounded-sm border object-cover ${
                  isKeeper ? "border-accent" : "border-line"
                }`;
                return item.thumbPath || /\.(jpe?g|png|webp|gif)$/i.test(item.path) ? (
                  // eslint-disable-next-line @next/next/no-img-element -- 本地媒体卷缩略图,不走 next/image 优化域
                  <img
                    key={item.id}
                    src={item.thumbPath ?? item.path}
                    alt=""
                    title={item.filename}
                    className={cls}
                  />
                ) : (
                  <span
                    key={item.id}
                    title={item.filename}
                    className={`flex h-14 w-[84px] items-center justify-center rounded-sm border bg-panel-2 font-mono text-[10px] text-text-3 ${
                      isKeeper ? "border-accent" : "border-line"
                    }`}
                  >
                    副本
                  </span>
                );
              })}
              {g.items.length > THUMB_MAX && (
                <span className="font-mono text-[11px] text-text-3">
                  +{g.items.length - THUMB_MAX}
                </span>
              )}
            </div>
            <div className="min-w-0">
              <div
                className="truncate text-[13px] font-semibold text-text-1"
                title={keeper.filename}
              >
                {keeper.filename} ×{g.items.length}
              </div>
              <div
                className="mt-0.5 font-mono text-[11.5px] leading-relaxed text-text-3"
                title={g.sha1}
              >
                sha1: {`${g.sha1.slice(0, 6)}…${g.sha1.slice(-4)}`} ·{" "}
                {keeper.width && keeper.height ? `${keeper.width}×${keeper.height} · ` : ""}
                {formatBytes(Number(keeper.sizeBytes ?? 0))} · {uses}
                <br />
                {advice}
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
                className="h-[30px] w-full cursor-pointer rounded-sm border border-green/35 bg-green/10 px-3.5 text-xs text-green hover:border-green hover:bg-green/15 disabled:opacity-50 sm:w-auto"
              >
                {busySha1 === g.sha1 ? "合并中…" : "保留 1 个并合并引用"}
              </button>
            </div>
          </div>
        );
      })}
      {error && <p className="font-mono text-xs text-red">{error}</p>}
    </div>
  );
}
