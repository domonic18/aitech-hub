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

/**
 * 从图状态 values.todos(原始 unknown)提取 todos(M27 批⑥):load(state)返回
 * 的 todos 是顶层键的裸数组(非 updates 帧的 {node:{todos}} 形态),白名单字段
 * 过滤防脏数据入前端计画条。
 */
export function extractTodosFromValues(raw: unknown): AgentTodo[] {
  if (!Array.isArray(raw)) return [];
  return (raw as unknown[]).filter(
    (t): t is AgentTodo =>
      typeof t === "object" &&
      t !== null &&
      typeof (t as { content?: unknown }).content === "string" &&
      ((t as { status?: unknown }).status === "pending" ||
        (t as { status?: unknown }).status === "in_progress" ||
        (t as { status?: unknown }).status === "completed"),
  );
}
