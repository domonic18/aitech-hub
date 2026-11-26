"use client";

/**
 * 参数筛选组(UX P2):按用途分组条件渲染——
 * - 视频:音频(有声/无声) + 时长(≥5s / ≥10s)
 * - 图像/视频:分辨率(从全表 tiers 动态聚合去重)
 * 任一档命中即通过(与 matchesTierParams 同口径)。
 */
import type { PublicModelRow, TierParamFilter } from "@/lib/pricing/public";

/** 从行集聚合分辨率选项(去重、按出现频次降序) */
function resolutionOptions(rows: PublicModelRow[]): string[] {
  const counts = new Map<string, number>();
  for (const r of rows) {
    for (const t of r.tiers) {
      if (t.params?.resolution) {
        counts.set(t.params.resolution, (counts.get(t.params.resolution) ?? 0) + 1);
      }
    }
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([res]) => res);
}

const chip = (on: boolean): string =>
  `cursor-pointer rounded-full border px-2 py-[3px] text-[11px] leading-none transition-colors select-none ${
    on
      ? "border-accent bg-accent text-white"
      : "border-line bg-panel text-text-2 hover:border-line-hover hover:text-text-1"
  }`;

export function ParamFilterGroup({
  cat,
  rows,
  filter,
  onChange,
}: {
  cat: string;
  rows: PublicModelRow[];
  filter: TierParamFilter;
  onChange: (next: TierParamFilter) => void;
}): React.ReactElement | null {
  const isVideo = cat === "video";
  const isImage = cat === "image";
  if (!isVideo && !isImage) return null;

  const resolutions = resolutionOptions(rows);
  const durationOptions = [5, 10] as const;

  return (
    <div className="flex flex-col gap-2">
      {(isVideo || isImage) && resolutions.length > 0 && (
        <div>
          <div className="mb-1 text-[10.5px] text-text-3">分辨率</div>
          <div className="flex flex-wrap gap-1.5">
            <button
              type="button"
              aria-pressed={filter.resolution === undefined}
              onClick={() => onChange({ ...filter, resolution: undefined })}
              className={chip(filter.resolution === undefined)}
            >
              全部
            </button>
            {resolutions.map((res) => (
              <button
                key={res}
                type="button"
                aria-pressed={filter.resolution === res}
                onClick={() =>
                  onChange({ ...filter, resolution: filter.resolution === res ? undefined : res })
                }
                className={chip(filter.resolution === res)}
              >
                {res}
              </button>
            ))}
          </div>
        </div>
      )}
      {isVideo && (
        <div className="flex flex-col gap-2">
          <div>
            <div className="mb-1 text-[10.5px] text-text-3">音频</div>
            <div className="flex flex-wrap gap-1.5">
              <button
                type="button"
                aria-pressed={filter.hasAudio === undefined}
                onClick={() => onChange({ ...filter, hasAudio: undefined })}
                className={chip(filter.hasAudio === undefined)}
              >
                全部
              </button>
              <button
                type="button"
                aria-pressed={filter.hasAudio === true}
                onClick={() =>
                  onChange({ ...filter, hasAudio: filter.hasAudio === true ? undefined : true })
                }
                className={chip(filter.hasAudio === true)}
              >
                有声
              </button>
              <button
                type="button"
                aria-pressed={filter.hasAudio === false}
                onClick={() =>
                  onChange({ ...filter, hasAudio: filter.hasAudio === false ? undefined : false })
                }
                className={chip(filter.hasAudio === false)}
              >
                无声
              </button>
            </div>
          </div>
          <div>
            <div className="mb-1 text-[10.5px] text-text-3">时长</div>
            <div className="flex flex-wrap gap-1.5">
              <button
                type="button"
                aria-pressed={filter.durationGte === undefined}
                onClick={() => onChange({ ...filter, durationGte: undefined })}
                className={chip(filter.durationGte === undefined)}
              >
                全部
              </button>
              {durationOptions.map((d) => (
                <button
                  key={d}
                  type="button"
                  aria-pressed={filter.durationGte === d}
                  onClick={() =>
                    onChange({
                      ...filter,
                      durationGte: filter.durationGte === d ? undefined : d,
                    })
                  }
                  className={chip(filter.durationGte === d)}
                >
                  ≥{d}s
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
