"use client";

/**
 * 配图工坊·画布(M40 批 B):底图(拆层就绪后切干净底板)+ 可见图层按
 * normalized bbox 叠放,bbox 叠加层供点选图层与拖选编辑区域(点按 8px 阈值
 * 区分点击与拖选;点击命中取 z 最高包含层)。编辑 bbox/选中层共用琥珀色高亮。
 */
import { useRef, useState } from "react";

import type { StudioGroupView } from "@/lib/ai/illustration-studio";

import type { NormalizedBbox } from "./labels";

interface DragState {
  startX: number;
  startY: number;
  cur: NormalizedBbox;
  moved: boolean;
}

function clamp999(v: number): number {
  return Math.max(0, Math.min(999, Math.round(v)));
}

export default function LayerCanvas({
  baseSrc,
  group,
  selectedLayerId,
  editBbox,
  onSelectLayer,
  onDrawBbox,
}: {
  baseSrc: string;
  /** 拆层就绪的组(null=未拆层,仅展示底图,无 bbox 叠加) */
  group: StudioGroupView | null;
  selectedLayerId: number | null;
  /** 当前编辑框(来自选中层或手动拖选),琥珀色高亮 */
  editBbox: NormalizedBbox | null;
  onSelectLayer: (id: number | null) => void;
  onDrawBbox: (bbox: NormalizedBbox) => void;
}): React.ReactElement {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const dragRef = useRef<DragState | null>(null);
  const [drag, setDrag] = useState<DragState | null>(null);
  const layers = group?.status === "ready" ? group.layers : [];
  const visibleLayers = layers.filter((l) => l.visible);

  function toViewBox(e: React.PointerEvent): { x: number; y: number } {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect || rect.width === 0 || rect.height === 0) return { x: 0, y: 0 };
    return {
      x: clamp999(((e.clientX - rect.left) / rect.width) * 1000),
      y: clamp999(((e.clientY - rect.top) / rect.height) * 1000),
    };
  }

  function onPointerDown(e: React.PointerEvent) {
    if (layers.length === 0) return;
    const { x, y } = toViewBox(e);
    const st = { startX: x, startY: y, cur: [x, y, x, y] as NormalizedBbox, moved: false };
    dragRef.current = st;
    setDrag(st);
    e.currentTarget.setPointerCapture(e.pointerId);
  }

  function onPointerMove(e: React.PointerEvent) {
    const st = dragRef.current;
    if (!st) return;
    const { x, y } = toViewBox(e);
    if (Math.abs(x - st.startX) > 4 || Math.abs(y - st.startY) > 4) st.moved = true;
    st.cur = [
      Math.min(st.startX, x),
      Math.min(st.startY, y),
      Math.max(st.startX, x),
      Math.max(st.startY, y),
    ];
    setDrag({ ...st });
  }

  function onPointerUp() {
    const st = dragRef.current;
    dragRef.current = null;
    setDrag(null);
    if (!st) return;
    if (!st.moved) {
      // 点按:命中检测取 z 最高包含层,未命中清选
      const hit = [...layers]
        .sort((a, b) => b.zIndex - a.zIndex)
        .find(
          (l) =>
            st.startX >= l.bbox[0] &&
            st.startX <= l.bbox[2] &&
            st.startY >= l.bbox[1] &&
            st.startY <= l.bbox[3],
        );
      onSelectLayer(hit ? hit.id : null);
      return;
    }
    // 拖选:面积过小视为误触
    if (st.cur[2] - st.cur[0] < 8 || st.cur[3] - st.cur[1] < 8) return;
    onDrawBbox(st.cur);
  }

  return (
    <div className="relative select-none overflow-hidden rounded-md border border-line bg-panel-2">
      {/* eslint-disable-next-line @next/next/no-img-element -- 站内动态媒体路径,免优化直出 */}
      <img src={baseSrc} alt="工坊底图" className="block w-full" draggable={false} />
      {visibleLayers.map((l) => {
        const [x1, y1, x2, y2] = l.bbox;
        return (
          // eslint-disable-next-line @next/next/no-img-element -- 同上,透明 PNG 按 bbox 叠放
          <img
            key={l.id}
            src={l.mediaPath}
            alt={l.name}
            draggable={false}
            className="pointer-events-none absolute"
            style={{
              left: `${x1 / 10}%`,
              top: `${y1 / 10}%`,
              width: `${(x2 - x1) / 10}%`,
              height: `${(y2 - y1) / 10}%`,
            }}
          />
        );
      })}
      {layers.length > 0 && (
        <svg
          ref={svgRef}
          viewBox="0 0 1000 1000"
          preserveAspectRatio="none"
          className="absolute inset-0 h-full w-full cursor-crosshair touch-none"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
        >
          {layers.map((l) => {
            const selected = l.id === selectedLayerId;
            return (
              <rect
                key={l.id}
                x={l.bbox[0]}
                y={l.bbox[1]}
                width={l.bbox[2] - l.bbox[0]}
                height={l.bbox[3] - l.bbox[1]}
                fill={selected ? "rgba(245,158,11,0.08)" : "transparent"}
                stroke={selected ? "#f59e0b" : "rgba(59,130,246,0.55)"}
                strokeWidth={selected ? 2.5 : 1.5}
                vectorEffect="non-scaling-stroke"
              />
            );
          })}
          {/* 手动编辑框(无选中层时)与拖选过程框 */}
          {!selectedLayerId && editBbox && (
            <rect
              x={editBbox[0]}
              y={editBbox[1]}
              width={editBbox[2] - editBbox[0]}
              height={editBbox[3] - editBbox[1]}
              fill="rgba(245,158,11,0.06)"
              stroke="#f59e0b"
              strokeWidth={2.5}
              vectorEffect="non-scaling-stroke"
            />
          )}
          {drag?.moved && (
            <rect
              x={drag.cur[0]}
              y={drag.cur[1]}
              width={drag.cur[2] - drag.cur[0]}
              height={drag.cur[3] - drag.cur[1]}
              fill="rgba(245,158,11,0.06)"
              stroke="#f59e0b"
              strokeWidth={2}
              strokeDasharray="6 4"
              vectorEffect="non-scaling-stroke"
            />
          )}
        </svg>
      )}
    </div>
  );
}
