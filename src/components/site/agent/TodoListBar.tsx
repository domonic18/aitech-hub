"use client";
/**
 * 执行计划条(K2.5,平移 ai-invest TodoListBar,token 换装):updates 通道
 * 提取的 todos 渲染 ✓/◐/○ 三态;in_progress 呼吸动画,completed 划线置灰。
 */
import type { AgentTodo } from "@/lib/agent/todos";

const TODO_MARKERS: Record<AgentTodo["status"], string> = {
  completed: "✓",
  in_progress: "◐",
  pending: "○",
};

export default function TodoListBar({ todos }: { todos: AgentTodo[] }): React.ReactElement | null {
  if (todos.length === 0) return null;
  return (
    <div className="border-b border-line px-4 py-2">
      <div className="mb-1 font-mono text-[11px] text-text-3">执行计划</div>
      <ol className="space-y-1">
        {todos.map((todo, index) => (
          <li
            key={index}
            className={`flex items-start gap-2 text-xs ${
              todo.status === "in_progress"
                ? "text-accent-hover"
                : todo.status === "completed"
                  ? "text-text-3"
                  : "text-text-2"
            }`}
          >
            <span
              className={`w-4 shrink-0 text-center ${
                todo.status === "in_progress" ? "animate-pulse" : ""
              }`}
            >
              {TODO_MARKERS[todo.status]}
            </span>
            <span className={todo.status === "completed" ? "line-through" : ""}>
              {todo.content}
            </span>
          </li>
        ))}
      </ol>
    </div>
  );
}
