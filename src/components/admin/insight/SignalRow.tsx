/**
 * 信号单行渲染(M59 批A):信号独立页列表与总览「最新信号」预览共用。
 * 展示口径沿用 M58:译文优先、原文可展开、翻译状态可见;原文链接取 meta.url
 * (无 url 列的源留 —)。li 形便于两处都以列表装配。
 */
import type { InsightSignalRow } from "@/lib/insight/admin";
import type { InsightSource } from "@/lib/insight/ingest";

import { RegionBadge, SOURCE_LABELS, formatTime } from "./shared";

export default function SignalRow({
  sig,
  showUrl = true,
}: {
  sig: InsightSignalRow;
  /** 总览预览省略外链列(版面窄),独立页展示 */
  showUrl?: boolean;
}): React.ReactElement {
  return (
    <li className="flex items-start gap-x-2 gap-y-1 px-3 py-2.5">
      <span className="w-[92px] shrink-0 pt-0.5 font-mono text-[11px] text-text-3">
        {formatTime(sig.signalAt)}
      </span>
      <span className="shrink-0 rounded-sm bg-panel-2 px-1.5 py-0.5 font-mono text-[10.5px] whitespace-nowrap text-text-2">
        {SOURCE_LABELS[sig.source as InsightSource] ?? sig.source}
      </span>
      <RegionBadge region={sig.region} />
      <div className="min-w-0 flex-1">
        <p
          className="text-[12.5px] leading-5 text-text-1"
          title={sig.translatedText ?? sig.rawText}
        >
          {sig.translatedText ?? sig.rawText}
        </p>
        {sig.translatedText !== null && (
          <details className="mt-0.5 text-[11px] text-text-3">
            <summary className="cursor-pointer select-none hover:text-text-2">
              原文{sig.lang ? ` · ${sig.lang}` : ""}
            </summary>
            <p className="mt-1 whitespace-pre-wrap text-text-2">{sig.rawText}</p>
          </details>
        )}
        {sig.translationStatus === "pending" && (
          <span className="text-[11px] text-amber-hi">待翻译(译文落定后入向量)</span>
        )}
        {sig.translationStatus === "failed" && (
          <span className="text-[11px] text-text-3">翻译失败,展示原文</span>
        )}
      </div>
      {showUrl && (
        <span className="shrink-0 pt-0.5">
          {sig.url === null ? (
            <span className="font-mono text-[11px] text-text-3" title="该源未提供原文链接">
              —
            </span>
          ) : (
            <a
              href={sig.url}
              target="_blank"
              rel="noopener noreferrer"
              className="font-mono text-[11px] text-text-2 hover:text-accent"
              title={sig.url}
            >
              原文 ↗
            </a>
          )}
        </span>
      )}
    </li>
  );
}
