/**
 * deepagents todos 提取(K2.5,零依赖可入前端):write_todos 工具把执行计划
 * 写进图状态,updates 帧载荷 {node: stateDelta} 各节点增量里扫 todos 数组。
 * 服务端(run.ts)与前端(计画条)共用此纯函数,客户端 bundle 不得经 run.ts
 * 引入 deepagents——故独立成模块。
 */

/** updates 帧中的 todos 形态(deepagents TodoListMiddleware 写图状态) */
export interface AgentTodo {
  content: string;
  status: "pending" | "in_progress" | "completed";
}

/** 从 updates 载荷提取 todos(平移 ai-invest extractTodos:扫各节点增量) */
export function extractTodos(updates: unknown): AgentTodo[] {
  if (typeof updates !== "object" || updates === null) return [];
  for (const value of Object.values(updates as Record<string, unknown>)) {
    if (
      typeof value === "object" &&
      value !== null &&
      Array.isArray((value as { todos?: unknown }).todos)
    ) {
      return (value as { todos: AgentTodo[] }).todos;
    }
  }
  return [];
}
