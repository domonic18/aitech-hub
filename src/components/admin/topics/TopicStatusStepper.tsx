/**
 * 专题状态流程条(2026-10-20 验收反馈问题三:状态管理可视化不足):收集→合成→
 * 发布三步横向步进——完成步打勾、当前步高亮、未达步灰置,每步下挂一行「这一步
 * 意味着什么」,让当前位置与下一步动作自解释,替代原裸文字徽章。纯展示件,
 * 服务端渲染零交互;人工流转操作在 TopicOverviewPanel(带后果说明与确认)。
 */
import { TOPIC_STATUS, TOPIC_STATUS_LABEL, type TopicStatus } from "@/lib/topics/constants";

const STEP_HINT: Record<TopicStatus, string> = {
  collecting: "添加素材、写批注",
  drafted: "初稿已生成,可人工定稿",
  published: "前台可见,可同步渠道",
};

export default function TopicStatusStepper({ status }: { status: string }) {
  const current = TOPIC_STATUS.indexOf(status as TopicStatus);
  return (
    <ol className="flex items-start gap-2">
      {TOPIC_STATUS.map((s, i) => {
        const done = i < current;
        const active = i === current;
        return (
          <li key={s} className="flex min-w-0 flex-1 items-start gap-2">
            <div className="flex min-w-0 flex-col items-start gap-1">
              <span
                className={
                  "flex h-5 w-5 flex-none items-center justify-center rounded-full border text-[11px] font-medium " +
                  (done
                    ? "border-green/40 bg-green/12 text-green-hi"
                    : active
                      ? "border-accent bg-accent/12 text-accent"
                      : "border-line bg-panel-2 text-text-3")
                }
              >
                {done ? (
                  <svg className="ic ic-sm" aria-hidden="true">
                    <use href="#i-check" />
                  </svg>
                ) : (
                  i + 1
                )}
              </span>
              <span
                className={
                  "whitespace-nowrap text-[12px] " +
                  (active ? "font-semibold text-text-1" : "text-text-2")
                }
              >
                {TOPIC_STATUS_LABEL[s]}
              </span>
              <span className="whitespace-nowrap text-[11px] text-text-3">{STEP_HINT[s]}</span>
            </div>
            {i < TOPIC_STATUS.length - 1 && (
              <span
                aria-hidden="true"
                className={"mt-2.5 h-px flex-1 " + (i < current ? "bg-green/40" : "bg-line")}
              />
            )}
          </li>
        );
      })}
    </ol>
  );
}
