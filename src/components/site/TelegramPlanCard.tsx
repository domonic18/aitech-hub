/**
 * 电报流右栏「采集计划」(M69):公开页的内容获取计划——即将运行(未来 12h
 * 内容任务) + 最近运行(内容类 job_run 台账)。数据由 content-plan 一次性装配,
 * 只含白名单任务;纯文本,不暴露后台链接、引擎健康与队列状态。
 */
import type { ContentPlanSnapshot } from "@/lib/collect/content-plan";

const DOT_CLASS: Record<string, string> = {
  success: "bg-green",
  failed: "bg-red",
};

export default function TelegramPlanCard({
  plan,
}: {
  plan: ContentPlanSnapshot;
}): React.ReactElement {
  return (
    <div className="overflow-hidden rounded-lg border border-line bg-panel shadow-sm">
      <div className="border-b border-line bg-panel-2 px-4 py-2.5 text-[13.5px] font-bold">
        采集计划
      </div>
      <div className="px-4 pb-3.5 pt-3">
        <div className="mb-1.5 font-mono text-[11px] text-text-3">即将运行 · 未来 12 小时</div>
        {plan.upcoming.length === 0 ? (
          <div className="text-xs text-text-3">12 小时内暂无内容采集任务</div>
        ) : (
          <div className="space-y-1">
            {plan.upcoming.map((u) => (
              <div key={u.key} className="flex items-center gap-2 text-xs">
                <span className="font-mono text-text-2">{u.atText}</span>
                <span className="truncate text-text-3" title={u.label}>
                  {u.label}
                </span>
              </div>
            ))}
          </div>
        )}

        <div className="mt-3 border-t border-line pt-3">
          <div className="mb-1.5 font-mono text-[11px] text-text-3">最近运行</div>
          {plan.recent.length === 0 ? (
            <div className="text-xs text-text-3">暂无运行记录</div>
          ) : (
            <div className="space-y-1">
              {plan.recent.map((r) => (
                <div key={r.id} className="flex items-center gap-2 text-xs">
                  <span
                    className={`inline-block h-1.5 w-1.5 shrink-0 rounded-full ${
                      DOT_CLASS[r.status] ?? "bg-blue animate-pulse"
                    }`}
                  />
                  <span className="truncate text-text-2" title={r.label}>
                    {r.label}
                  </span>
                  <span className="ml-auto shrink-0 font-mono text-[10.5px] text-text-3">
                    {r.atText}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
