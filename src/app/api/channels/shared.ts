/**
 * /api/channels 路由族共享协议层(P2-20,posts/media 域内 shared.ts 同范式):
 * PAT 拒绝语 + ChannelAdminError → HTTP 状态映射收口——此前五路由各写一遍
 * (not_found/name_taken/in_use 三种映射写法并存,新增错误码漏改一处即漂移)。
 */
import { NextResponse } from "next/server";

import { apiEnvelope } from "@/lib/http/response";
import { ChannelAdminError, type ChannelAdminErrorCode } from "@/lib/telegram/channels-admin";

export { requireSessionActor } from "@/lib/http/session-guard";

/** 渠道持有采集凭证,仅会话通道可管(PAT 不得管理基础设施配置,同 users 口径) */
export const CHANNELS_PAT_DENY = "PAT must not manage channels";

const ERROR_STATUS = {
  not_found: 404,
  name_taken: 409,
  in_use: 409,
  disabled: 409,
  not_supported: 400,
} as const satisfies Record<ChannelAdminErrorCode, number>;

/** 业务错 → HTTP 状态:资源缺失 404 / 资源冲突类(name_taken·in_use·disabled)409 /
 * 其余(not_supported 等请求不合法)400 */
export function channelAdminErrorStatus(e: ChannelAdminError): number {
  return ERROR_STATUS[e.code];
}

/** 统一错误出参:命中 ChannelAdminError 回映射包络;其余返 undefined 由调用侧
 * 原样上抛(Handler 边界 500,不在此吞未知错形) */
export function toEnvelope(e: unknown): NextResponse | undefined {
  if (e instanceof ChannelAdminError) {
    return apiEnvelope(channelAdminErrorStatus(e), e.message);
  }
  return undefined;
}
