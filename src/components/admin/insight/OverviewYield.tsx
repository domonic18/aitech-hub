/**
 * F11 种子词产出榜(近 7 天):命中该词的候选批次计数排行,行点击带词跳
 * 候选治理按词过滤——效能产出重心一屏可见。全期累计口径在词库管理效能列,
 * 此处窗口化为板定「近 7 天」。
 */
import Link from "next/link";

import { keywordYieldAdmin } from "@/lib/discovery/word-yield";

export default async function OverviewYield(): Promise<React.ReactElement> {
  const yields = await keywordYieldAdmin({ days: 7, limit: 8 });
  return (
    <div className="flex flex-col rounded-md border border-line bg-panel">
      <div className="flex items-baseline justify-between border-b border-line px-4 py-2.5">
        <span className="text-sm font-semibold">种子词产出榜</span>
        <span className="text-[11px] text-text-3">近 7 天</span>
      </div>
      {yields.length === 0 ? (
        <p className="px-4 py-8 text-center text-xs text-text-3">
          近 7 天暂无候选产出——跑一轮发现(源管理 · 台账行内)或等排程
        </p>
      ) : (
        <ol className="px-2 py-1">
          {yields.map((y, i) => (
            <li key={y.word}>
              <Link
                href={`/admin/insight/discovery/?t=candidates&kw=${encodeURIComponent(y.word)}`}
                title={`查看「${y.word}」挖到的候选(批准 ${y.approved})`}
                className="flex items-center gap-2 rounded-sm px-2 py-1.5 hover:bg-panel-2"
              >
                <span className="w-5 shrink-0 text-right font-mono text-[12px] text-text-3">
                  {i + 1}
                </span>
                <span className="min-w-0 flex-1 truncate text-[13px] text-text-1">{y.word}</span>
                <span className="shrink-0 font-mono text-[12px] text-text-2">{y.candidates}</span>
              </Link>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
