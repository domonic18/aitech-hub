/**
 * MCP 工具出参封装(创作面与只读面共用):统一 JSON 文本出参 + 失败置
 * isError(Claude 侧按错误呈现)。失败原因只回人话,不带栈。
 *
 * M72 B1:错误出参统一形状 `{ok:false, code, message, retryable, hint}` ——
 * 线下 agent 靠 code 分流处置(改输入 / 稍后重试 / 换路径),靠 hint 知道
 * 下一步做什么,不必从中文文案里猜。code 取业务错误自带的码(PinError /
 * DistributeError),取不到则归 INTERNAL。成功出参形状各自不变(不加 ok 字段)。
 */
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

export function json(value: unknown, isError = false): CallToolResult {
  return { content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }], isError };
}

/** 错误出参体(统一形状) */
export interface McpErrorBody {
  ok: false;
  /** 机器可分流码(PinError/DistributeError 自带码;否则 INTERNAL) */
  code: string;
  /** 人话原因 */
  message: string;
  /** 是否可原样重试(瞬时故障 true;需改输入/等状态 false) */
  retryable: boolean;
  /** 下一步提示(可选) */
  hint?: string;
}

/** 码 → (是否可重试, 提示) */
const CODE_HINTS: Record<string, { retryable: boolean; hint: string }> = {
  not_found: { retryable: false, hint: "确认 id/键是否正确" },
  duplicate: { retryable: false, hint: "已存在,别重复提交" },
  pending: { retryable: false, hint: "正在同步中,等完成后再试" },
  invalid: { retryable: false, hint: "按提示修正入参" },
  invalid_input: { retryable: false, hint: "按提示修正入参" },
  invalid_transition: { retryable: false, hint: "当前状态不允许该流转,先看状态再操作" },
  edit_locked: {
    retryable: false,
    hint: "已同步/已发布的内容不能直编,先 set_pin_status 转 pending 撤回",
  },
};

/** 取错误自带码(业务错误类都有 code 字段) */
function errorCode(e: unknown): string {
  if (typeof e === "object" && e !== null && "code" in e) {
    const code = (e as { code?: unknown }).code;
    if (typeof code === "string" && code.length > 0) return code;
  }
  return "INTERNAL";
}

export function fail(
  e: unknown,
  opts?: { code?: string; hint?: string; retryable?: boolean },
): CallToolResult {
  const code = opts?.code ?? errorCode(e);
  const known = CODE_HINTS[code];
  const hint = opts?.hint ?? known?.hint;
  const body: McpErrorBody = {
    ok: false,
    code,
    message: e instanceof Error ? e.message : String(e),
    retryable: opts?.retryable ?? known?.retryable ?? true,
    ...(hint !== undefined ? { hint } : {}),
  };
  return json(body, true);
}
