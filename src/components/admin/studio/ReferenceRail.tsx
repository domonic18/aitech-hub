"use client";

/**
 * 参照图选择轨(M42 批④ 贴图配置):候选来自服务端 resolveTopicReferences
 * (样例图 → 视频封面 → 挂载文章配图 → 本创作已有贴图,仅站内 uploads)。
 * 「自动」= 不指定,agent 生成时按同一优先级自选;点选某张则把路径写进
 * pin_positioning 的「参照图:」条款行,后续生成优先采纳。单选、无多选。
 */
import { REFERENCE_SOURCE_LABEL, type ReferenceSource } from "@/lib/topics/reference-labels";

export interface ReferenceRailItem {
  source: string;
  mediaPath: string;
  label: string;
}

export default function ReferenceRail({
  candidates,
  value,
  onChange,
  disabled = false,
}: {
  candidates: ReferenceRailItem[];
  /** 当前指定路径(空串 = 自动) */
  value: string;
  onChange: (mediaPath: string) => void;
  disabled?: boolean;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[11px] font-semibold text-text-3">参照图</span>
        <button
          type="button"
          disabled={disabled}
          onClick={() => onChange("")}
          className={`rounded-sm px-2 py-0.5 text-[11px] ${
            value === ""
              ? "bg-accent/12 font-medium text-accent"
              : "border border-line text-text-2 hover:text-text-1"
          } disabled:opacity-50`}
        >
          自动(按优先级)
        </button>
        <span className="text-[11px] text-text-3">
          {value === "" ? "生成时自选一张:样例图 → 视频封面 → 文章配图 → 本创作贴图" : value}
        </span>
      </div>
      {candidates.length === 0 ? (
        <p className="text-[11px] text-text-3">
          暂无可选参照(绑定样例图、挂载已转存封面的视频或带配图的文章后出现)
        </p>
      ) : (
        <div className="flex gap-2 overflow-x-auto pb-1">
          {candidates.map((c) => {
            const selected = value === c.mediaPath;
            return (
              <button
                key={`${c.source}:${c.mediaPath}`}
                type="button"
                disabled={disabled}
                onClick={() => onChange(c.mediaPath)}
                title={`${REFERENCE_SOURCE_LABEL[c.source as ReferenceSource] ?? c.source}·${c.label}`}
                className={`w-20 shrink-0 cursor-pointer overflow-hidden rounded-sm border text-left disabled:opacity-50 ${
                  selected ? "border-accent" : "border-line hover:border-text-3"
                }`}
              >
                {/* eslint-disable-next-line @next/next/no-img-element -- 管理端内部缩略,src 为站内动态路径 */}
                <img
                  src={c.mediaPath}
                  alt={c.label}
                  loading="lazy"
                  className="h-20 w-20 bg-panel-2 object-cover"
                />
                <span className="block truncate px-1 py-0.5 text-[10px] text-text-3">
                  {REFERENCE_SOURCE_LABEL[c.source as keyof typeof REFERENCE_SOURCE_LABEL] ??
                    c.source}
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
