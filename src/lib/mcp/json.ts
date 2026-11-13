/**
 * MCP 工具出参封装(创作面与只读面共用):统一 JSON 文本出参 + 失败置
 * isError(Claude 侧按错误呈现)。失败原因只回人话,不带栈。
 */
export function json(value: unknown, isError = false) {
  return { content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }], isError };
}

export function fail(e: unknown) {
  return json({ error: e instanceof Error ? e.message : String(e) }, true);
}
