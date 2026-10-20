"use client";

/**
 * 媒体图片查看器(2026-10-20 验收反馈问题三):抽屉内预览点击后全屏放大查看。
 * 滚轮缩放(朝向光标,原生非 passive 监听防滚动穿透)、双击 1↔2 切换、
 * Pointer 拖拽平移(scale>1)、工具条(缩小/百分比/放大/适配/关闭)、Esc 关闭。
 * createPortal 挂 body,z-50 高于抽屉(z-30);Esc 只关最上层——抽屉的 Esc
 * 处理按本组件 open 态让行(MediaDrawer 状态门控,不赌监听顺序)。
 * 缩放几何:视图状态 = {scale, tx, ty}(tx/ty 为屏幕 px,相对视口中心);
 * 「朝向光标」= 缩放前后光标下的内容点保持不动,见 zoomAt。
 */
import {
  useEffect,
  useRef,
  useState,
  type ReactElement,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { createPortal } from "react-dom";

const MIN_SCALE = 0.2;
const MAX_SCALE = 8;
/** 工具条按钮的步进倍率(与滚轮的连续因子互补) */
const ZOOM_STEP = 1.2;

interface ViewState {
  scale: number;
  tx: number;
  ty: number;
}

const FIT: ViewState = { scale: 1, tx: 0, ty: 0 };

/** 以 (cx,cy)(相对视口中心的屏幕 px)为锚缩放:锚点内容不动 */
function zoomAt(prev: ViewState, factor: number, cx = 0, cy = 0): ViewState {
  const scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, prev.scale * factor));
  const k = scale / prev.scale;
  return { scale, tx: cx - (cx - prev.tx) * k, ty: cy - (cy - prev.ty) * k };
}

function ToolBtn({
  icon,
  label,
  onClick,
}: {
  icon: string;
  label: string;
  onClick: () => void;
}): ReactElement {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      className="cursor-pointer rounded-sm p-1.5 text-white/80 hover:bg-white/10 hover:text-white"
      onClick={onClick}
    >
      <svg className="ic" aria-hidden="true">
        <use href={`#${icon}`} />
      </svg>
    </button>
  );
}

export default function MediaViewer({
  src,
  alt,
  onClose,
}: {
  src: string;
  alt: string;
  onClose: () => void;
}): React.ReactElement {
  const [view, setView] = useState<ViewState>(FIT);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<{ id: number; x: number; y: number } | null>(null);
  /** 本次按下后是否发生过拖拽:拖拽松手不触发「点遮罩关闭」 */
  const movedRef = useRef(false);

  useEffect(() => {
    const onEsc = (e: KeyboardEvent): void => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onEsc);
    return () => document.removeEventListener("keydown", onEsc);
  }, [onClose]);

  // 滚轮缩放:React 的 onWheel 是 passive 合成事件,preventDefault 无效,
  // 须挂原生非 passive 监听(factor = exp(-deltaY·0.0015):一屏滚过约 3~4 档)
  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent): void => {
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      const cx = e.clientX - rect.left - rect.width / 2;
      const cy = e.clientY - rect.top - rect.height / 2;
      setView((v) => zoomAt(v, Math.exp(-e.deltaY * 0.0015), cx, cy));
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  function onStagePointerDown(e: ReactPointerEvent<HTMLDivElement>): void {
    movedRef.current = false;
    if (view.scale <= 1) return; // 未放大:整块即「点空白关闭」的点击面
    dragRef.current = { id: e.pointerId, x: e.clientX, y: e.clientY };
    e.currentTarget.setPointerCapture(e.pointerId);
  }

  function onStagePointerMove(e: ReactPointerEvent<HTMLDivElement>): void {
    const d = dragRef.current;
    if (!d || d.id !== e.pointerId) return;
    movedRef.current = true;
    const { clientX: nx, clientY: ny } = e;
    setView((v) => ({ ...v, tx: v.tx + nx - d.x, ty: v.ty + ny - d.y }));
    dragRef.current = { id: d.id, x: nx, y: ny };
  }

  function onStagePointerUp(e: ReactPointerEvent<HTMLDivElement>): void {
    // capture 随 pointerup 隐式释放,这里只清拖拽态
    if (dragRef.current?.id === e.pointerId) dragRef.current = null;
  }

  /** 双击 1↔2(锚在双击处);已放大则回适配 */
  function onImgDoubleClick(e: React.MouseEvent): void {
    setView((v) => {
      if (v.scale > 1.5) return FIT;
      const cx = e.clientX - window.innerWidth / 2;
      const cy = e.clientY - window.innerHeight / 2;
      return zoomAt(v, 2 / v.scale, cx, cy);
    });
  }

  return createPortal(
    <div ref={rootRef} className="fixed inset-0 z-50 bg-black/80">
      {/* 舞台:空白处点击关闭(拖拽后松手不算)、放大后拖拽平移 */}
      <div
        className="absolute inset-0 flex items-center justify-center overflow-hidden"
        style={{ cursor: view.scale > 1 ? "grab" : "zoom-out" }}
        onClick={() => {
          if (!movedRef.current) onClose();
        }}
        onPointerDown={onStagePointerDown}
        onPointerMove={onStagePointerMove}
        onPointerUp={onStagePointerUp}
      >
        {/* eslint-disable-next-line @next/next/no-img-element -- 管理端内部预览,src 为站内动态路径 */}
        <img
          src={src}
          alt={alt}
          draggable={false}
          className="absolute left-1/2 top-1/2 max-h-[88vh] max-w-[92vw] select-none"
          style={{
            transform: `translate(-50%, -50%) translate(${view.tx}px, ${view.ty}px) scale(${view.scale})`,
          }}
          onClick={(e) => e.stopPropagation()} // 图上单击不关(区分空白区)
          onDoubleClick={onImgDoubleClick}
        />
      </div>

      {/* 工具条:缩小 / 百分比 / 放大 / 适配 / 关闭(按钮走中心缩放) */}
      <div
        className="absolute bottom-6 left-1/2 flex -translate-x-1/2 items-center gap-0.5 rounded-sm border border-white/15 bg-black/60 px-1.5 py-1 text-white/90 backdrop-blur"
        onClick={(e) => e.stopPropagation()}
        onDoubleClick={(e) => e.stopPropagation()}
      >
        <ToolBtn
          icon="i-zoom-out"
          label="缩小"
          onClick={() => setView((v) => zoomAt(v, 1 / ZOOM_STEP))}
        />
        <span className="w-14 select-none text-center font-mono text-xs tabular-nums text-white/80">
          {Math.round(view.scale * 100)}%
        </span>
        <ToolBtn
          icon="i-zoom-in"
          label="放大"
          onClick={() => setView((v) => zoomAt(v, ZOOM_STEP))}
        />
        <span className="mx-1 h-4 w-px bg-white/20" aria-hidden="true" />
        <ToolBtn icon="i-expand" label="适配(还原 1:1)" onClick={() => setView(FIT)} />
        <span className="mx-1 h-4 w-px bg-white/20" aria-hidden="true" />
        <ToolBtn icon="i-close" label="关闭" onClick={onClose} />
      </div>
    </div>,
    document.body,
  );
}
