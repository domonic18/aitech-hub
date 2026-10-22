/**
 * 贴图产出列表(M42 批④ 创作中心产出区):本创作已落库的贴图——首图缩略、
 * 标题、状态徽标、张数 + 「去组装台」(精修/裁剪/公众号同步)与「前台预览」
 * (仅已发布,前台 /pins 只暴露 published)。服务端纯展示件,取数
 * listPinsByTopic。
 */
import Link from "next/link";

import { asciiSlugFromTitle } from "@/lib/content/post-path";
import { pinPath } from "@/lib/content/pin-path";
import { formatCnDateTime } from "@/lib/datetime";
import { PIN_STATUS_LABEL, type PinStatus } from "@/lib/pins/constants";

export interface PinOutputItem {
  id: bigint;
  title: string;
  status: string;
  imageCount: number;
  coverPath: string | null;
  updatedAt: Date;
}

const STATUS_TONES: Record<PinStatus, string> = {
  draft: "border-line bg-panel-2 text-text-3",
  pending: "border-amber/30 bg-amber/10 text-amber-hi",
  synced: "border-green/30 bg-green/10 text-green-hi",
  published: "border-green/30 bg-green/10 text-green-hi",
};

export default function PinOutputsPanel({ pins }: { pins: PinOutputItem[] }) {
  if (pins.length === 0) {
    return (
      <p className="rounded-sm border border-dashed border-line px-3 py-4 text-[12px] text-text-3">
        还没有贴图——点「生成贴图」后,贴图会出现在这里,可去组装台精修并同步公众号
      </p>
    );
  }
  return (
    <div className="flex flex-col gap-2">
      {pins.map((p) => {
        const status = p.status as PinStatus;
        return (
          <div
            key={p.id.toString()}
            className="flex items-center gap-3 rounded-sm border border-line bg-panel p-2.5"
          >
            {p.coverPath ? (
              /* eslint-disable-next-line @next/next/no-img-element -- 管理端内部缩略,src 为站内动态路径 */
              <img
                src={p.coverPath}
                alt={p.title}
                loading="lazy"
                className="h-14 w-14 shrink-0 rounded-sm bg-panel-2 object-cover"
              />
            ) : (
              <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-sm bg-panel-2 text-[10px] text-text-3">
                无图
              </span>
            )}
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="truncate text-[13px] font-medium text-text-1">{p.title}</span>
                <span
                  className={`rounded-sm border px-1.5 py-0.5 text-[11px] ${STATUS_TONES[status] ?? STATUS_TONES.draft}`}
                >
                  {PIN_STATUS_LABEL[status] ?? p.status}
                </span>
              </div>
              <div className="mt-0.5 text-[11px] text-text-3">
                {p.imageCount} 张 · 更新 {formatCnDateTime(p.updatedAt)}
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              {status === "published" && (
                <Link
                  href={pinPath(p.id, asciiSlugFromTitle(p.title))}
                  target="_blank"
                  className="rounded-sm border border-line px-2 py-1 text-[11px] text-text-2 hover:border-accent hover:text-text-1"
                >
                  前台预览
                </Link>
              )}
              <Link
                href={`/admin/pins/${p.id.toString()}`}
                className="rounded-sm bg-accent px-2.5 py-1 text-[11px] font-medium text-[color:var(--accent-contrast)] hover:opacity-90"
              >
                去组装台
              </Link>
            </div>
          </div>
        );
      })}
    </div>
  );
}
