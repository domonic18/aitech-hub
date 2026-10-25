"use client";

/**
 * 序列轨(M41):竖排缩略(首图带「封面」标),拖拽排序(M48 验收反馈)+上下移/
 * 移除 + 添加图片入口;已同步/已发布整体只读(撤回后再编)。拖拽为原生 HTML5
 * DnD(零依赖;触屏无 DnD,↑/↓ 按钮保留作备援),drop 落点=被悬停项的目标位。
 */
import { useState } from "react";

import type { PinImageDto } from "@/lib/pins/dto";
import { PIN_IMAGES_MAX } from "@/lib/pins/constants";

export default function ImageRail({
  images,
  editable,
  busy,
  selected,
  onSelect,
  onMove,
  onRemove,
  onAdd,
}: {
  images: PinImageDto[];
  editable: boolean;
  busy: boolean;
  selected: number;
  onSelect: (i: number) => void;
  onMove: (from: number, to: number) => void;
  onRemove: (imageId: string) => void;
  onAdd: () => void;
}): React.ReactElement {
  const canAdd = editable && images.length < PIN_IMAGES_MAX;
  /** 拖拽态:from=拖起项下标,over=当前悬停目标下标(null=不在拖拽中) */
  const [dragFrom, setDragFrom] = useState<number | null>(null);
  const [dragOver, setDragOver] = useState<number | null>(null);

  function clearDrag(): void {
    setDragFrom(null);
    setDragOver(null);
  }

  function handleDrop(target: number): void {
    if (dragFrom !== null && dragFrom !== target) onMove(dragFrom, target);
    clearDrag();
  }

  return (
    <div className="rounded-sm border border-line bg-panel p-2.5">
      <div className="mb-2 flex items-center justify-between px-0.5">
        <span className="text-xs font-medium text-text-1">
          图片序列{" "}
          <span className="font-mono text-text-3">
            {images.length}/{PIN_IMAGES_MAX}
          </span>
          {editable && images.length > 1 && (
            <span className="ml-1.5 text-[10.5px] text-text-3">· 拖拽缩略图可调顺序</span>
          )}
        </span>
        {!editable && <span className="text-[10.5px] text-amber-hi">已锁定</span>}
      </div>
      <div className="flex max-h-[560px] flex-col gap-2 overflow-y-auto">
        {images.map((img, i) => (
          <div
            key={img.id}
            draggable={editable && !busy && images.length > 1}
            onDragStart={(e) => {
              setDragFrom(i);
              e.dataTransfer.effectAllowed = "move";
              e.dataTransfer.setData("text/plain", String(i)); // Firefox 必需
            }}
            onDragOver={(e) => {
              if (dragFrom === null || dragFrom === i) return;
              e.preventDefault();
              e.dataTransfer.dropEffect = "move";
              setDragOver(i);
            }}
            onDrop={(e) => {
              e.preventDefault();
              handleDrop(i);
            }}
            onDragEnd={clearDrag}
            className={`relative overflow-hidden rounded-sm border ${
              dragFrom === i
                ? "border-line opacity-40"
                : dragOver === i && dragFrom !== null
                  ? "border-accent border-dashed shadow-[0_0_0_1px_var(--accent)]"
                  : i === selected
                    ? "border-accent shadow-[0_0_0_1px_var(--accent)]"
                    : "border-line"
            } ${editable && !busy && images.length > 1 ? "cursor-grab active:cursor-grabbing" : ""}`}
          >
            <button
              type="button"
              onClick={() => onSelect(i)}
              className="block w-full cursor-pointer"
              title={`第 ${i + 1} 张${i === 0 ? "(封面)" : ""}`}
            >
              {/* eslint-disable-next-line @next/next/no-img-element -- 站内媒体路径缩略 */}
              <img
                src={img.mediaPath}
                alt=""
                loading="lazy"
                className="block h-24 w-full object-cover"
              />
              {i === 0 && (
                <span className="absolute left-1 top-1 rounded-sm bg-accent px-1 py-px font-mono text-[9.5px] text-white">
                  封面
                </span>
              )}
              <span className="absolute right-1 top-1 rounded-sm bg-black/60 px-1 py-px font-mono text-[9.5px] text-white">
                {i + 1}
              </span>
            </button>
            {editable && (
              <div className="flex items-center border-t border-line bg-panel-2">
                <button
                  type="button"
                  aria-label="上移"
                  disabled={busy || i === 0}
                  onClick={() => onMove(i, i - 1)}
                  className="flex-1 cursor-pointer py-1 text-[11px] text-text-3 hover:text-accent disabled:cursor-not-allowed disabled:opacity-40"
                >
                  ↑
                </button>
                <button
                  type="button"
                  aria-label="下移"
                  disabled={busy || i === images.length - 1}
                  onClick={() => onMove(i, i + 1)}
                  className="flex-1 cursor-pointer border-x border-line py-1 text-[11px] text-text-3 hover:text-accent disabled:cursor-not-allowed disabled:opacity-40"
                >
                  ↓
                </button>
                <button
                  type="button"
                  aria-label="移除"
                  disabled={busy}
                  onClick={() => onRemove(img.id)}
                  className="flex-1 cursor-pointer py-1 text-[11px] text-text-3 hover:text-red disabled:cursor-not-allowed disabled:opacity-40"
                >
                  ✕
                </button>
              </div>
            )}
          </div>
        ))}
        {images.length === 0 && (
          <div className="rounded-sm border border-dashed border-line px-2 py-6 text-center text-[11px] text-text-3">
            还没有图片
          </div>
        )}
      </div>
      <button
        type="button"
        disabled={!canAdd || busy}
        onClick={onAdd}
        className="mt-2 w-full cursor-pointer rounded-sm border border-dashed border-line py-2 text-xs text-text-2 hover:border-accent hover:text-accent disabled:cursor-not-allowed disabled:opacity-50"
      >
        {!editable
          ? "撤回后方可添加"
          : images.length >= PIN_IMAGES_MAX
            ? `已达上限 ${PIN_IMAGES_MAX} 张`
            : "＋ 添加图片"}
      </button>
    </div>
  );
}
