/**
 * 虎皮椒网关实现(M21 批②,提案 §2.x 契约 + §7):凭据/域名从
 * pay_gateway_config 表来(工厂注入,2026-10-08 拍板不入 env)。
 * 下单响应验签后才取二维码/跳转链(§6 #11,旧代码既有实践);回调验签
 * 常量时间;查询响应对 errcode 判定(data 为嵌套结构,平铺签名算法不适
 * 用,通道 HTTPS 服务端直连无明文伪造面;入账以回调验签为准)。
 * 主备域名切换:仅网络层失败(请求抛错/非 200)切备用重试一次——业务
 * errno≠0 不重试,防同单号重复下单歧义。
 */
import { randomBytes } from "node:crypto";

import { makeSign, verifySign } from "@/lib/pay/sign";
import type {
  GatewayCreateInput,
  GatewayCreateResult,
  GatewayNotifyResult,
  GatewayQueryResult,
  GatewayQueryStatus,
  PayGateway,
} from "@/lib/pay/gateway/types";
import type { PayGatewayRuntimeConfig } from "@/lib/pay/gateway-config";

const CREATE_PATH = "/payment/do.html";
const QUERY_PATH = "/payment/query.html";
const TIMEOUT_MS = 10_000;

export class XunhuGateway implements PayGateway {
  readonly name = "xunhu";

  constructor(private readonly cfg: PayGatewayRuntimeConfig) {}

  async create(input: GatewayCreateInput): Promise<GatewayCreateResult> {
    const params = buildCreateParams(this.cfg, input);
    let raw: Record<string, unknown>;
    try {
      raw = await postForm(`${this.cfg.apiBase}${CREATE_PATH}`, params);
    } catch (e) {
      if (!this.cfg.apiBaseBackup) throw e; // 无备用域,原样上抛
      raw = await postForm(`${this.cfg.apiBaseBackup}${CREATE_PATH}`, params); // 同参同签
    }
    return parseCreateResponse(raw, this.cfg.appSecret);
  }

  async query(orderNo: string): Promise<GatewayQueryResult> {
    const params = buildQueryParams(this.cfg, orderNo);
    const raw = await postForm(`${this.cfg.apiBase}${QUERY_PATH}`, params);
    return parseQueryResponse(raw);
  }

  verifyNotify(payload: Record<string, string>): GatewayNotifyResult {
    return {
      valid: verifySign(payload, this.cfg.appSecret),
      status: payload.status ?? "",
      orderNo: payload.trade_order_id ?? "",
      totalFee: payload.total_fee ?? "",
      transactionId: payload.transaction_id || undefined,
      openOrderId: payload.open_order_id || undefined,
    };
  }
}

// ── 纯函数(单测钉行为)──────────────────────────────────────

function nonce(): string {
  return randomBytes(8).toString("hex"); // 16 位
}

/** 统一下单参数(§2.2):version=1.1、type=WAP;time 秒级;hash 最后生成 */
export function buildCreateParams(
  cfg: PayGatewayRuntimeConfig,
  input: GatewayCreateInput,
): Record<string, string> {
  const params: Record<string, string> = {
    version: "1.1",
    appid: cfg.appId,
    trade_order_id: input.orderNo,
    total_fee: input.amount,
    title: input.title,
    time: String(Math.floor(Date.now() / 1000)),
    nonce_str: nonce(),
    type: "WAP",
    wap_url: cfg.wapUrl,
    wap_name: "一起AI",
    notify_url: input.notifyUrl,
    return_url: input.returnUrl,
  };
  params.hash = makeSign(params, cfg.appSecret);
  return params;
}

/** 查询参数(§2.5 实证白名单):多一个字段都会破坏签名(40029) */
export function buildQueryParams(
  cfg: PayGatewayRuntimeConfig,
  orderNo: string,
): Record<string, string> {
  const params: Record<string, string> = {
    appid: cfg.appId,
    out_trade_order: orderNo,
    time: String(Math.floor(Date.now() / 1000)),
    nonce_str: nonce(),
  };
  params.hash = makeSign(params, cfg.appSecret);
  return params;
}

/** 下单响应解析:先验签(平铺参数),errno=0 才取链接 */
export function parseCreateResponse(raw: unknown, secret: string): GatewayCreateResult {
  const res = raw as Record<string, unknown>;
  const flat: Record<string, string> = {};
  for (const [k, v] of Object.entries(res)) {
    if (typeof v === "string" || typeof v === "number") flat[k] = String(v);
  }
  if (!verifySign(flat, secret)) {
    throw new Error("虎皮椒下单响应验签失败(拒绝取链接,防篡改/钓鱼)");
  }
  if (String(res.errno) !== "0") {
    throw new Error(`虎皮椒下单失败: ${String(res.errmsg ?? "unknown")}`);
  }
  return {
    payUrl: String(res.url ?? ""),
    qrUrl: res.url_qrcode ? String(res.url_qrcode) : undefined,
    openOrderId: res.openid ? String(res.openid) : undefined, // 历史命名:openid=虎皮椒订单号
    raw: res,
  };
}

/** 网关状态映射(§2.5):OD 已付 / WP 未付 / CD 已退款;未知状态拒绝静默 */
export function mapGatewayStatus(status: string): GatewayQueryStatus {
  switch (status) {
    case "OD":
      return "paid";
    case "WP":
      return "unpaid";
    case "CD":
      return "refunded";
    default:
      throw new Error(`虎皮椒查询返回未知状态: ${status}`);
  }
}

export function parseQueryResponse(raw: unknown): GatewayQueryResult {
  const res = raw as Record<string, unknown>;
  if (String(res.errcode) !== "0") {
    throw new Error(`虎皮椒查询失败: ${String(res.errmsg ?? "unknown")}`);
  }
  const data = (res.data ?? {}) as Record<string, unknown>;
  return {
    status: mapGatewayStatus(String(data.status ?? "")),
    transactionId: data.transaction_id ? String(data.transaction_id) : undefined,
    openOrderId: data.open_order_id ? String(data.open_order_id) : undefined,
    raw: res,
  };
}

// ── HTTP 层(薄;单测以纯函数为主,网络层由集成/联调覆盖)────────

async function postForm(
  url: string,
  params: Record<string, string>,
): Promise<Record<string, unknown>> {
  const body = new URLSearchParams(params);
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: body.toString(),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`虎皮椒 HTTP ${res.status}: ${url}`);
  return (await res.json()) as Record<string, unknown>;
}
