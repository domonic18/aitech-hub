/**
 * 分布条(M14 批⑦,原型 dist):按任务/按模型两个卡共用;按 tokens 占比画 track 条,
 * 四色轮换与角色 tag 同源(accent/green/blue/amber)。
 */
import { fmtTokens } from "./usage-format";
import type { UsageDistRow } from "@/lib/ai/usage-queries";

const FILL_CLS = ["bg-accent", "bg-green", "bg-blue", "bg-amber"];

export default function UsageDist({ rows }: { rows: UsageDistRow[] }): React.ReactElement {
  const max = Math.max(...rows.map((r) => r.tokens), 1);
  const total = rows.reduce((s, r) => s + r.tokens, 0);
  if (rows.length === 0) {
    return <div className="px-4 pb-4 pt-2 text-xs text-text-3">窗口内暂无调用</div>;
  }
  return (
    <div className="px-4 pb-4 pt-2">
      {rows.map((r, i) => (
        <div
          key={r.key}
          className="grid grid-cols-[92px_1fr_84px] items-center gap-2.5 py-[7px] text-[13px]"
        >
          <span className="overflow-hidden text-ellipsis whitespace-nowrap text-text-2">
            {r.key}
          </span>
          <span className="block h-2 overflow-hidden rounded-full bg-panel-2">
            <span
              className={`block h-full rounded-full ${FILL_CLS[i % FILL_CLS.length]}`}
              style={{ width: `${Math.max(2, (r.tokens / max) * 100)}%` }}
            />
          </span>
          <span className="whitespace-nowrap text-right font-mono text-xs text-text-3">
            {fmtTokens(r.tokens)}
            {total > 0 ? ` · ${Math.round((r.tokens / total) * 100)}%` : ""}
          </span>
        </div>
      ))}
    </div>
  );
}
