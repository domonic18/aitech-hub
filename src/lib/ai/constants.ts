/**
 * AI 服务治理常量(M8 批⑥,arch/04 §4):协议/用途/角色枚举与角色卡元数据。
 * 合法值应用层 Zod 管控(arch/03 枚举演进条款);角色串与用途串同值,
 * 绑定校验即 purposes.has(role)。
 */

export const AI_PROTOCOL_OPENAI = "openai";
export const AI_PROTOCOL_ANTHROPIC = "anthropic";
export const AI_PROTOCOL_OTHER = "other";
/** 模型协议(连通性测试仅支持前两者;other=自管端点,诚实标暂不支持) */
export const AI_MODEL_PROTOCOLS = [
  AI_PROTOCOL_OPENAI,
  AI_PROTOCOL_ANTHROPIC,
  AI_PROTOCOL_OTHER,
] as const;

export const AI_PURPOSE_INTERPRET = "interpret";
export const AI_PURPOSE_SUMMARIZE = "summarize";
export const AI_PURPOSE_SEARCH = "search";
export const AI_PURPOSE_COVER = "cover";
/** 模型用途 = 任务角色(四角色,arch/04 §4 任务绑定) */
export const AI_MODEL_PURPOSES = [
  AI_PURPOSE_INTERPRET,
  AI_PURPOSE_SUMMARIZE,
  AI_PURPOSE_SEARCH,
  AI_PURPOSE_COVER,
] as const;

export type AiTaskRole = (typeof AI_MODEL_PURPOSES)[number];

/** 角色卡元数据(任务绑定 Tab;图标为 AdminSprite 符号 id) */
export const AI_ROLE_META: Record<AiTaskRole, { label: string; icon: string; sub: string }> = {
  [AI_PURPOSE_INTERPRET]: {
    label: "电报解读",
    icon: "i-send",
    sub: "短视频条目 → ASR 转写 → LLM 解读(要点 · 背景 · 延伸)",
  },
  [AI_PURPOSE_SUMMARIZE]: {
    label: "文字摘要",
    icon: "i-filetext",
    sub: "纯文字资讯 → 一句话摘要 + 标签(入流轻处理)",
  },
  [AI_PURPOSE_SEARCH]: {
    label: "Agent 搜索",
    icon: "i-search",
    sub: "Query 改写 → 检索召回 → 引用作答",
  },
  [AI_PURPOSE_COVER]: {
    label: "封面生图",
    icon: "i-picture",
    sub: "文章题图 + OG 图生成",
  },
};

export const ASR_PROTOCOL_OPENAI = "openai";
export const ASR_PROTOCOL_MINIMAX = "minimax";
export const ASR_PROTOCOL_OTHER = "other";
/** ASR 渠道协议(转写探针仅支持前两者) */
export const ASR_PROTOCOLS = [
  ASR_PROTOCOL_OPENAI,
  ASR_PROTOCOL_MINIMAX,
  ASR_PROTOCOL_OTHER,
] as const;

/** 供应商预设(下拉;末位「其他」放开自由串) */
export const AI_PROVIDER_PRESETS = [
  "DeepSeek",
  "智谱 AI",
  "阿里云",
  "字节火山",
  "Moonshot",
] as const;

/** last_test_status 合法值 */
export const TEST_STATUS_OK = "ok";
export const TEST_STATUS_FAIL = "fail";
