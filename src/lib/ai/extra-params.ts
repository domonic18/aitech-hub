/**
 * extraParams 供应商扩展参数读取(纯函数零依赖,单测锚点):输出预算与协议
 * 扩展只住 ai_model 台账,代码零数值默认(2026-10-17 max_tokens 截断静默中断
 * 根修;改值=后台改台账,不发版)。类型门通过才带上,配错型由调用方告警。
 */

/**
 * extraParams.max_tokens 读取:正有限整数 → number;未配置/类型不合法
 * (字符串/负数/小数)→ null(调用方凭 hasExtraMaxTokens 分流告警)。
 */
export function readExtraMaxTokens(extraParams: Record<string, unknown>): number | null {
  const v = extraParams.max_tokens;
  return typeof v === "number" && Number.isInteger(v) && v > 0 ? v : null;
}

/** max_tokens 是否配置过(区分「未配置」与「配错型」;告警分流用) */
export function hasExtraMaxTokens(extraParams: Record<string, unknown>): boolean {
  return "max_tokens" in extraParams;
}

/**
 * extraParams.output_config 读取(anthropic 协议供应商扩展,如 MiniMax effort
 * 思考深度——缺省 max,降档须显式配置):普通对象原样返回;未配置/类型不合法 → null。
 */
export function readExtraOutputConfig(
  extraParams: Record<string, unknown>,
): Record<string, unknown> | null {
  const v = extraParams.output_config;
  return typeof v === "object" && v !== null && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : null;
}

/**
 * extraParams.temperature 读取(2026-10 模型切换):Kimi K3 固定不可改、
 * ChatAnthropic 开启 thinking 时只接受缺省或 1——采样温度不再由代码硬编码,
 * 未配置即不下发,由供应商默认。合法域 0–2 有限数。
 */
export function readExtraTemperature(extraParams: Record<string, unknown>): number | null {
  const v = extraParams.temperature;
  return typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= 2 ? v : null;
}

/** temperature 是否配置过(区分「未配置」与「配错型」;告警分流用) */
export function hasExtraTemperature(extraParams: Record<string, unknown>): boolean {
  return "temperature" in extraParams;
}
