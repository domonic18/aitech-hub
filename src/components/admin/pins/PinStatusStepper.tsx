"use client";

/**
 * 状态步进条(M41):四态节点(完成/当前/未到) + 按 PIN_MANUAL_TARGETS 派生的
 * 流转钮组(标签按 `from>to` 键收敛,与 API 文档/工作台口径同源);发布类钮
 * 用主色,撤回类用描边。
 */
import {
  PIN_MANUAL_TARGETS,
  PIN_STATUS,
  PIN_STATUS_LABEL,
  type PinStatus,
} from "@/lib/pins/constants";

const TRANSITION_LABEL: Record<string, string> = {
  "draft>pending": "提交验收",
  "pending>draft": "撤回继续组装",
  "pending>published": "直接发布(站点)",
  "synced>published": "发布",
  "synced>pending": "撤回再编辑",
  "published>pending": "下架修改",
};

export default function PinStatusStepper({
  status,
  busy,
  onTransition,
}: {
  status: PinStatus;
  busy: boolean;
  onTransition: (next: PinStatus) => void;
}): React.ReactElement {
  const idx = PIN_STATUS.indexOf(status);
  return (
    <div className="mb-4 flex flex-wrap items-center gap-x-2 gap-y-2 rounded-sm border border-line bg-panel px-4 py-3">
      {PIN_STATUS.map((s, i) => (
        <span key={s} className="flex items-center gap-2">
          {i > 0 && (
            <span
              aria-hidden="true"
              className={`text-xs ${i <= idx ? "text-accent" : "text-text-3"}`}
            >
              →
            </span>
          )}
          <span
            className={`flex items-center gap-1.5 text-xs ${
              i === idx ? "font-semibold text-accent" : i < idx ? "text-text-1" : "text-text-3"
            }`}
          >
            <span
              className={`flex h-4 w-4 items-center justify-center rounded-full font-mono text-[9.5px] ${
                i <= idx ? "bg-accent-dim text-accent" : "bg-panel-2 text-text-3"
              }`}
            >
              {i + 1}
            </span>
            {PIN_STATUS_LABEL[s]}
          </span>
        </span>
      ))}
      <span className="ml-auto flex flex-wrap items-center gap-2">
        {PIN_MANUAL_TARGETS[status].map((next) => {
          const publishish = next === "published" || (status === "draft" && next === "pending");
          return (
            <button
              key={next}
              type="button"
              disabled={busy}
              onClick={() => onTransition(next)}
              className={`cursor-pointer rounded-sm px-3 py-1.5 text-xs font-medium disabled:cursor-not-allowed disabled:opacity-60 ${
                publishish
                  ? "bg-accent text-white hover:bg-accent-hover"
                  : "border border-line text-text-2 hover:border-accent hover:text-accent"
              }`}
            >
              {TRANSITION_LABEL[`${status}>${next}`] ?? PIN_STATUS_LABEL[next]}
            </button>
          );
        })}
      </span>
    </div>
  );
}
