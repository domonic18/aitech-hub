"use client";

/**
 * 贴图网格(M41):3:4 竖图卡(封面=首图快照/状态徽标/张数角标/专题 chip),
 * 点卡开详情抽屉(抓 GET /api/pins/[id]);编辑动作都在组装台,本组件只浏览。
 */
import { useState } from "react";
import { formatCnDateTime } from "@/lib/datetime";
import type { PinListItemDto } from "@/lib/pins/dto";
import type { PinStatus } from "@/lib/pins/constants";

import PinDetailDrawer from "./PinDetailDrawer";
import { PIN_BADGE_CLS, PIN_BADGE_LABEL } from "./status";

export default function PinsWorkbench({
  items,
  emptyHint,
}: {
  items: PinListItemDto[];
  emptyHint: string;
}): React.ReactElement {
  const [openId, setOpenId] = useState<string | null>(null);

  if (items.length === 0) {
    return (
      <div className="rounded-sm border border-dashed border-line px-4 py-14 text-center text-xs text-text-3">
        {emptyHint}
      </div>
    );
  }

  return (
    <>
      <div className="grid grid-cols-2 gap-3.5 md:grid-cols-3 xl:grid-cols-4">
        {items.map((p) => {
          const status = p.status as PinStatus;
          return (
            <button
              key={p.id}
              type="button"
              onClick={() => setOpenId(p.id)}
              className="cursor-pointer overflow-hidden rounded-sm border border-line bg-panel text-left transition-colors hover:border-accent"
              title={`贴图 #${p.id}`}
            >
              <div className="relative aspect-[3/4] overflow-hidden bg-panel-2">
                {p.coverPath ? (
                  // eslint-disable-next-line @next/next/no-img-element -- 管理端内部缩略,src 为站内媒体路径
                  <img
                    src={p.coverPath}
                    alt=""
                    loading="lazy"
                    className="h-full w-full object-cover"
                  />
                ) : (
                  <div className="flex h-full items-center justify-center text-[11px] text-text-3">
                    暂无图片
                  </div>
                )}
                <span
                  className={`absolute left-1.5 top-1.5 rounded-sm px-1.5 py-px font-mono text-[10.5px] ${PIN_BADGE_CLS[status] ?? ""}`}
                >
                  {PIN_BADGE_LABEL[status] ?? p.status}
                </span>
                <span className="absolute bottom-1.5 right-1.5 rounded-sm bg-black/60 px-1.5 py-px font-mono text-[10.5px] text-white">
                  {p.imageCount} 图
                </span>
              </div>
              <div className="px-2.5 pb-2.5 pt-2">
                <div className="truncate text-[13px] font-semibold text-text-1">{p.title}</div>
                {p.content && (
                  <p className="mt-0.5 line-clamp-2 min-h-[34px] text-[11.5px] leading-relaxed text-text-3">
                    {p.content}
                  </p>
                )}
                <div className="mt-1.5 flex items-center gap-1.5 font-mono text-[10.5px] text-text-3">
                  {p.topicTitle ? (
                    <span className="rounded-sm bg-accent-dim px-1.5 text-accent">
                      {p.topicTitle}
                    </span>
                  ) : (
                    <span className="rounded-sm bg-panel-2 px-1.5">未绑定</span>
                  )}
                  <span>{[...p.content].length} 字</span>
                  <span className="ml-auto">{formatCnDateTime(new Date(p.updatedAt))}</span>
                </div>
              </div>
            </button>
          );
        })}
      </div>
      {openId !== null && <PinDetailDrawer pinId={openId} onClose={() => setOpenId(null)} />}
    </>
  );
}
