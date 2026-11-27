"use client";

import type { TopEvent } from "@/lib/ai-index/top-events";

const DIMENSION_LABELS: Record<string, string> = {
  model: "模型",
  benchmark: "评测",
  agent: "智能体",
  multimodal: "多模态",
  business: "产业",
  policy: "政策",
  general: "综合",
};

const DIRECTION_STYLE: Record<string, { dot: string; label: string }> = {
  positive: { dot: "bg-green-hi", label: "推进" },
  negative: { dot: "bg-red-hi", label: "拖累" },
  neutral: { dot: "bg-text-3", label: "常规" },
};

export function AiTopEvents({
  events,
  title,
}: {
  events: TopEvent[];
  title?: string;
}): React.ReactElement | null {
  if (events.length === 0) return null;

  return (
    <div className="mt-4 rounded-md border border-line/60 bg-panel-2/40 p-3.5">
      {title && <p className="mb-2 text-xs font-medium text-text-2">{title}</p>}
      <ul className="space-y-2">
        {events.map((ev, i) => {
          const style = DIRECTION_STYLE[ev.direction] ?? DIRECTION_STYLE.neutral;
          return (
            <li key={`${ev.title}-${i}`} className="flex items-start gap-2.5 text-[13px]">
              <span
                className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${style.dot}`}
                aria-hidden="true"
              />
              <div className="min-w-0 flex-1">
                <p className="leading-snug text-text-2">
                  {ev.url && ev.url !== "#" ? (
                    <a
                      href={ev.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="hover:text-accent-hover"
                    >
                      {ev.title}
                    </a>
                  ) : (
                    ev.title
                  )}
                </p>
                <p className="mt-0.5 text-[11px] text-text-3">
                  {DIMENSION_LABELS[ev.dimension] ?? ev.dimension}
                  <span className="mx-1.5">·</span>
                  {style.label}
                  <span className="mx-1.5">·</span>
                  冲击 {ev.score}
                </p>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
