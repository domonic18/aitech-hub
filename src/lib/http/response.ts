/**
 * API 响应包络(arch/05-services §4):{ code, message, data }。
 * code=0 → HTTP 200;其余 code 同时作为 HTTP 状态码。Route Handler 共用,防形态漂移。
 * 形态经 ApiEnvelope 导出:客户端/测试不得自行手写同形接口(M5-a 评审 W3)。
 */
import { NextResponse } from "next/server";

export interface ApiEnvelope<T = unknown> {
  code: number;
  message: string;
  data: T;
}

export function apiEnvelope(
  code: number,
  message: string,
  data: unknown = null,
  /** 业务成功但异步受理(如上传后 sharp 管线)可指定 202;默认 code=0 → 200 */
  okStatus: 200 | 202 = 200,
  /** 额外响应头(M47 批B3:付费正文/公开时间线要 no-store,此前两处被迫
   *  手写同形 JSON,包络漂移防线的破口) */
  headers?: HeadersInit,
): NextResponse {
  return NextResponse.json({ code, message, data } satisfies ApiEnvelope, {
    status: code === 0 ? okStatus : code,
    ...(headers ? { headers } : {}),
  });
}
