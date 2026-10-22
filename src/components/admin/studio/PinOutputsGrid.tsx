"use client";

/**
 * 贴图产出网格(v2 工作台舞台「贴图」页签,自 PinOutputsPanel 网格化):
 * 3:4 封面卡(状态徽标 + 张数角标),悬停浮层操作——去组装台(精修/裁剪/
 * 公众号同步单点入口)/ 前台预览(仅已发布)/ 删除(M42 反馈问题二:删除
 * 入口直达,不必先进组装台;confirm 写后果,DELETE 后本地摘卡不整页刷新)。
 * 初始数据服务端 listPinsByTopic,客户端仅持删除后的本地列表。
 */
import { useState } from "react";
import Link from "next/link";

import { asciiSlugFromTitle } from "@/lib/content/post-path";
import { pinPath } from "@/lib/content/pin-path";
import { formatCnDateTime } from "@/lib/datetime";
import type { ApiEnvelope } from "@/lib/http/response";
import { PIN_STATUS_LABEL, type PinStatus } from "@/lib/pins/constants";

export interface PinGridItem {
  id: bigint;
  title: string;
  status: string;
  imageCount: number;
  coverPath: string | null;
  updatedAt: Date;
}

const STATUS_BADGE: Record<PinStatus, string> = {
  draft: "bg-panel-2 text-text-2",
  pending: "bg-amber/80 text-white",
  synced: "bg-green/80 text-white",
  published: "bg-green/80 text-white",
};

export default function PinOutputsGrid({ pins }: { pins: PinGridItem[] }) {
  const [list, setList] = useState(pins);
  const [err, setErr] = useState<string | null>(null);

  async function del(p: PinGridItem): Promise<void> {
    if (!window.confirm(`删除贴图《${p.title}》?图片序列与渠道记录一并删除,不可恢复。`)) return;
    setErr(null);
    try {
      const res = await fetch(`/api/pins/${p.id.toString()}`, { method: "DELETE" });
      const body = (await res.json()) as ApiEnvelope;
      if (!res.ok || body.code !== 0) {
        setErr(body.message || `删除失败(${res.status})`);
        return;
      }
      setList((l) => l.filter((x) => x.id !== p.id));
    } catch {
      setErr("网络异常,请重试");
    }
  }

  if (list.length === 0) {
    return (
      <p className="rounded-sm border border-dashed border-line px-3 py-6 text-center text-[12px] text-text-3">
        还没有贴图——点「生成贴图」后,贴图会出现在这里,可去组装台精修并同步公众号
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
        {list.map((p) => {
          const status = p.status as PinStatus;
          return (
            <div
              key={p.id.toString()}
              className="group overflow-hidden rounded-sm border border-line bg-panel transition-colors hover:border-accent"
            >
              <div className="relative aspect-[3/4] overflow-hidden bg-panel-2">
                {p.coverPath ? (
                  /* eslint-disable-next-line @next/next/no-img-element -- 管理端内部缩略,src 为站内媒体路径 */
                  <img
                    src={p.coverPath}
                    alt={p.title}
                    loading="lazy"
                    className="h-full w-full object-cover"
                  />
                ) : (
                  <div className="flex h-full items-center justify-center text-[11px] text-text-3">
                    暂无图片
                  </div>
                )}
                <span
                  className={`absolute left-1.5 top-1.5 rounded-sm px-1.5 py-px font-mono text-[10.5px] ${STATUS_BADGE[status] ?? ""}`}
                >
                  {PIN_STATUS_LABEL[status] ?? p.status}
                </span>
                <span className="absolute bottom-1.5 right-1.5 rounded-sm bg-black/60 px-1.5 py-px font-mono text-[10.5px] text-white">
                  {p.imageCount} 图
                </span>
                {/* 悬停操作浮层(focus-within 保键盘可达) */}
                <div className="absolute inset-x-0 bottom-0 flex items-center justify-center gap-1.5 bg-gradient-to-t from-black/75 to-transparent px-2 pb-2 pt-6 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
                  <Link
                    href={`/admin/pins/${p.id.toString()}`}
                    className="rounded-sm bg-accent px-2 py-1 text-[11px] font-medium text-[color:var(--accent-contrast)] hover:opacity-90"
                  >
                    去组装台
                  </Link>
                  {status === "published" && (
                    <Link
                      href={pinPath(p.id, asciiSlugFromTitle(p.title))}
                      target="_blank"
                      className="rounded-sm border border-white/30 bg-black/40 px-2 py-1 text-[11px] text-white hover:border-white"
                    >
                      前台预览
                    </Link>
                  )}
                  <button
                    type="button"
                    onClick={() => void del(p)}
                    className="rounded-sm border border-white/30 bg-black/40 px-2 py-1 text-[11px] text-white hover:border-red hover:text-red"
                  >
                    删除
                  </button>
                </div>
              </div>
              <div className="px-2 pb-2 pt-1.5">
                <div className="truncate text-[12px] font-medium text-text-1" title={p.title}>
                  {p.title}
                </div>
                <div className="mt-0.5 text-[10.5px] text-text-3">
                  更新 {formatCnDateTime(p.updatedAt)}
                </div>
              </div>
            </div>
          );
        })}
      </div>
      {err && (
        <span className="text-[11px] text-red" role="alert">
          {err}
        </span>
      )}
    </div>
  );
}
