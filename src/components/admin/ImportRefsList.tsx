"use client";

/**
 * 引用清单(技术债批⑤,自 ImportPostsModal 抽出):逐条状态点(✓/✗/…/·)+
 * 行级动作——本地图失败且有同名已选文件「重试」、未匹配「选图」即时补选、
 * 外链失败「重试」单条转存。动作回调由弹窗持有(写 overrides 与状态)。
 */
import { refBasename, type MdImageRef } from "@/lib/media/import-md";

/** 单引用处理状态(target = 已落站内路径) */
export type RefState = { status: "pending" | "uploading" | "done" | "failed"; target?: string };

export default function ImportRefsList({
  refs,
  states,
  byName,
  running,
  onRetryLocal,
  onPick,
  onRetryExternal,
}: {
  refs: MdImageRef[];
  states: Record<string, RefState>;
  /** 已选本地文件按文件名索引(行级「重试/选图」动作可用性判定) */
  byName: Map<string, File>;
  running: boolean;
  onRetryLocal: (src: string, file: File) => void;
  onPick: (src: string) => void;
  onRetryExternal: (src: string) => void;
}): React.ReactElement {
  return (
    <ul className="mt-2 max-h-56 space-y-1 overflow-y-auto text-xs">
      {refs.map((r) => {
        const s = states[r.src] ?? { status: "pending" };
        const hit = r.external ? undefined : byName.get(refBasename(r.src));
        const canRetryLocal = !r.external && s.status === "failed" && !!hit;
        const canPick = !r.external && s.status !== "done" && !hit;
        const action = canRetryLocal ? (
          <button
            type="button"
            className="cursor-pointer rounded-sm border border-line px-1.5 py-0.5 text-[11px] text-text-3 hover:text-text-1"
            onClick={() => onRetryLocal(r.src, hit as File)}
          >
            重试
          </button>
        ) : canPick ? (
          <button
            type="button"
            disabled={running}
            className="cursor-pointer rounded-sm border border-line px-1.5 py-0.5 text-[11px] text-text-3 hover:text-text-1 disabled:opacity-60"
            onClick={() => onPick(r.src)}
          >
            选图
          </button>
        ) : r.external && s.status === "failed" ? (
          <button
            type="button"
            className="cursor-pointer rounded-sm border border-line px-1.5 py-0.5 text-[11px] text-text-3 hover:text-text-1"
            onClick={() => onRetryExternal(r.src)}
          >
            重试
          </button>
        ) : null;
        return (
          <li key={r.src} className="flex items-center gap-2">
            <span
              className={
                s.status === "done"
                  ? "text-accent"
                  : s.status === "failed"
                    ? "text-red"
                    : "text-text-3"
              }
            >
              {s.status === "done"
                ? "✓"
                : s.status === "failed"
                  ? "✗"
                  : s.status === "uploading"
                    ? "…"
                    : "·"}
            </span>
            <span className="truncate font-mono text-[11px] text-text-2" title={r.src}>
              {r.external ? "[外链] " : ""}
              {r.src}
            </span>
            <span className="ml-auto flex shrink-0 items-center gap-1.5">
              {s.target && (
                <span className="max-w-[160px] truncate font-mono text-[10px] text-text-3">
                  {s.target}
                </span>
              )}
              {action}
            </span>
          </li>
        );
      })}
    </ul>
  );
}
