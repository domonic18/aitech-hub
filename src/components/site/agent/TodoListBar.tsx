"use client";
/**
 * 执行计划条(K2.5,平移 ai-invest TodoListBar,token 换装):updates 通道
 * 提取的 todos 渲染 ✓/◐/○ 三态;in_progress 呼吸动画,completed 划线置灰。
 *
 * **中断态(2026-11-17)**:run 被腰斩(护栏撞线/死端/异常)时,未完成项标
 * 「⊘ 已中断」而非留 ○——此前一排 pending,用户看不出做到哪一步;补一行
 * 汇总(已完成 / 未完成计数),让人一眼看到断点。呈现逻辑(标记符/汇总文案)在
 * `lib/agent/todos.ts`(零依赖纯模块,可单测),本组件只做渲染。
 */
import { todoMarker, todoSummary, toTodoViews, type AgentTodo } from "@/lib/agent/todos";

export default function TodoListBar({
  todos,
  interrupted = false,
}: {
  todos: AgentTodo[];
  interrupted?: boolean;
}): React.ReactElement | null {
  if (todos.length === 0) return null;
  const views = toTodoViews(todos, interrupted);
  const summary = todoSummary(todos, interrupted);
  return (
    <div className="border-b border-line px-4 py-2">
      <div className="mb-1 flex items-center gap-2 font-mono text-[11px] text-text-3">
        执行计划
        {summary ? <span className="text-amber-hi">· {summary}</span> : null}
      </div>
      <ol className="space-y-1">
        {views.map((view, index) => (
          <li
            key={index}
            className={`flex items-start gap-2 text-xs ${
              view.interrupted
                ? "text-amber-hi"
                : view.status === "in_progress"
                  ? "text-accent-hover"
                  : view.status === "completed"
                    ? "text-text-3"
                    : "text-text-2"
            }`}
          >
            <span
              className={`w-4 shrink-0 text-center ${
                view.status === "in_progress" && !view.interrupted ? "animate-pulse" : ""
              }`}
            >
              {todoMarker(view)}
            </span>
            <span className={view.status === "completed" ? "line-through" : ""}>
              {view.content}
              {view.interrupted ? (
                <span className="ml-1 font-mono text-[10.5px]">已中断</span>
              ) : null}
            </span>
          </li>
        ))}
      </ol>
    </div>
  );
}
