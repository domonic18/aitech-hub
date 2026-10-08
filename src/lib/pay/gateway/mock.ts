/**
 * Mock 网关(M21 批②,提案 §7):dev/test 全链路用,表内 mock 行 enabled
 * 时工厂注入(生产环境忽略该行)——不出网、零凭据,可模拟 paid 回调
 * (集成测试验收主线:下单→回调→发货→门禁放行)。签名用固定 mock secret
 * 走与线上一致的 makeSign/verifySign 路径,验签分支(坏签/错金额/重放
 * 全拒)同样可测。
 */
import { makeSign, verifySign } from "@/lib/pay/sign";
import type {
  GatewayCreateInput,
  GatewayCreateResult,
  GatewayNotifyResult,
  GatewayQueryResult,
  PayGateway,
} from "@/lib/pay/gateway/types";

export const MOCK_SECRET = "mock-secret-local-only";

/** 构造一条模拟回调(集成测试/本地联调用):status 同网关枚举 OD/WP/CD */
export function buildMockNotify(
  orderNo: string,
  totalFee: string,
  status = "OD",
  overrides: Partial<Record<string, string>> = {},
): Record<string, string> {
  const payload: Record<string, string> = {
    status,
    trade_order_id: orderNo,
    total_fee: totalFee,
    transaction_id: `mock_txn_${orderNo}`,
    open_order_id: `mock_open_${orderNo}`,
    appid: "mock-appid",
    time: String(Math.floor(Date.now() / 1000)),
    nonce_str: "mocknonce0000000",
    attach: "",
    ...overrides,
  };
  payload.hash = makeSign(payload, MOCK_SECRET);
  return payload;
}

export class MockGateway implements PayGateway {
  readonly name = "mock";
  private paid = new Set<string>();

  async create(input: GatewayCreateInput): Promise<GatewayCreateResult> {
    return {
      payUrl: `mock://pay/${input.orderNo}`,
      qrUrl: undefined,
      openOrderId: `mock_open_${input.orderNo}`,
      raw: { errno: 0, errmsg: "ok", url: `mock://pay/${input.orderNo}` },
    };
  }

  async query(orderNo: string): Promise<GatewayQueryResult> {
    return {
      status: this.paid.has(orderNo) ? "paid" : "unpaid",
      transactionId: `mock_txn_${orderNo}`,
      openOrderId: `mock_open_${orderNo}`,
      raw: { errcode: 0, data: { status: this.paid.has(orderNo) ? "OD" : "WP" } },
    };
  }

  /** 模拟支付完成(测试驱动状态);返回是否新标记(幂等) */
  markPaid(orderNo: string): boolean {
    if (this.paid.has(orderNo)) return false;
    this.paid.add(orderNo);
    return true;
  }

  verifyNotify(payload: Record<string, string>): GatewayNotifyResult {
    return {
      valid: verifySign(payload, MOCK_SECRET),
      status: payload.status ?? "",
      orderNo: payload.trade_order_id ?? "",
      totalFee: payload.total_fee ?? "",
      transactionId: payload.transaction_id || undefined,
      openOrderId: payload.open_order_id || undefined,
    };
  }
}
