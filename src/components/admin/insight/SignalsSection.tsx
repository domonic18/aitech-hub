/**
 * 洞察中心 §3 信号明细分区(验收二批② 自页面抽出 + 日期范围筛选;M52 批D
 * 增介质筛选):源 chips + 介质 chips + from/to 日期表单(GET,北京日界,
 * lt 次日零点)+ 原始信号表。from/to 只作用于本分区;w(总览窗口)/day
 * (热榜回看)经隐藏域跨提交保留。
 */
import Link from "next/link";

import type { InsightSignalRow } from "@/lib/insight/admin";
import { INSIGHT_MEDIA_VOCAB, MEDIUM_LABELS } from "@/lib/insight/constants";
import type { InsightSource } from "@/lib/insight/ingest";

import { SOURCE_LABELS, formatTime, insightHref, type InsightViewParams } from "./shared";

const chip = "rounded-sm px-2 py-0.5 font-mono text-[11px]";
const chipOn = `${chip} bg-accent-dim text-accent`;
const chipOff = `${chip} bg-panel-2 text-text-2 hover:text-text-1`;

export default function SignalsSection({
  signals,
  sources,
  params,
}: {
  signals: InsightSignalRow[];
  /** 在役源键集(chips 展示序=白名单序) */
  sources: InsightSource[];
  params: InsightViewParams;
}): React.ReactElement {
  const source = sources.find((s) => s === params.source);
  const medium = INSIGHT_MEDIA_VOCAB.find((m) => m === params.medium);
  const { from, to } = params;
  return (
    <div className="rounded-md border border-line bg-panel">
      <div className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-2.5">
        <span className="text-xs font-medium text-text-2">信号筛选</span>
        <Link
          href={insightHref(params, { source: undefined })}
          scroll={false}
          className={source === undefined ? chipOn : chipOff}
        >
          全部
        </Link>
        {sources.map((k) => (
          <Link
            key={k}
            href={insightHref(params, { source: k })}
            scroll={false}
            className={source === k ? chipOn : chipOff}
          >
            {SOURCE_LABELS[k]}
          </Link>
        ))}
        <span className="ml-1 text-[10px] text-text-3">介质</span>
        <Link
          href={insightHref(params, { medium: undefined })}
          scroll={false}
          className={medium === undefined ? chipOn : chipOff}
        >
          全部
        </Link>
        {INSIGHT_MEDIA_VOCAB.map((m) => (
          <Link
            key={m}
            href={insightHref(params, { medium: m })}
            scroll={false}
            className={medium === m ? chipOn : chipOff}
          >
            {MEDIUM_LABELS[m]}
          </Link>
        ))}
        <form method="GET" action="/admin/insight/" className="ml-auto flex items-center gap-1.5">
          {/* 跨分区参数保真:窗口/热榜回看日/当前源/介质随表单提交 */}
          {params.w && <input type="hidden" name="w" value={params.w} />}
          {params.day && <input type="hidden" name="day" value={params.day} />}
          {source && <input type="hidden" name="source" value={source} />}
          {medium && <input type="hidden" name="medium" value={medium} />}
          <input
            type="date"
            name="from"
            defaultValue={from ?? ""}
            aria-label="开始日期"
            className="rounded-sm border border-line bg-panel px-1.5 py-0.5 font-mono text-[11px] text-text-2"
          />
          <span className="text-[11px] text-text-3">→</span>
          <input
            type="date"
            name="to"
            defaultValue={to ?? ""}
            aria-label="结束日期"
            className="rounded-sm border border-line bg-panel px-1.5 py-0.5 font-mono text-[11px] text-text-2"
          />
          <button
            type="submit"
            className="cursor-pointer rounded-sm border border-line bg-panel px-2 py-0.5 text-[11px] text-text-2 hover:border-line-hover hover:text-text-1"
          >
            查询
          </button>
          {(from || to) && (
            <Link
              href={insightHref(params, { from: undefined, to: undefined })}
              scroll={false}
              className="text-[11px] text-text-3 hover:text-accent"
            >
              清除
            </Link>
          )}
        </form>
      </div>
      <table className="w-full text-left text-[13px]">
        <tbody>
          {signals.map((sig) => (
            <tr key={sig.id} className="border-b border-line last:border-b-0 hover:bg-panel-2">
              <td className="w-24 px-4 py-2 align-top">
                <span className="rounded-sm bg-panel-2 px-1.5 py-0.5 font-mono text-[11px] text-text-2">
                  {SOURCE_LABELS[sig.source as InsightSource] ?? sig.source}
                </span>
              </td>
              <td className="px-3 py-2 align-top">
                <span className="line-clamp-2 text-text-1" title={sig.rawText}>
                  {sig.rawText}
                </span>
              </td>
              <td className="w-28 px-4 py-2 text-right align-top font-mono text-[11px] text-text-3">
                {formatTime(sig.signalAt)}
              </td>
            </tr>
          ))}
          {signals.length === 0 && (
            <tr>
              <td colSpan={3} className="px-4 py-8 text-center text-xs text-text-3">
                {source === undefined ? (
                  <>
                    该范围内暂无信号:信号由外部热榜小时级拉取产生——去
                    <Link
                      href="/admin/data/sources/?t=channels"
                      className="mx-0.5 text-accent hover:underline"
                    >
                      源管理·热榜源
                    </Link>
                    检查启停或手动拉取,或在
                    <Link href="/admin/data/plan/" className="mx-0.5 text-accent hover:underline">
                      运行·计划
                    </Link>
                    看排程
                  </>
                ) : (
                  `「${SOURCE_LABELS[source]}」该范围内暂无信号,换个范围或等下一轮拉取`
                )}
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
