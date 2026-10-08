/**
 * 支付网关抽象(M21 批②,提案 §7;requirement line 105 既定):业务层
 * (order-service/notify/reconcile)只依赖本接口,日后换官方微信支付新增
 * 实现即可,表结构与业务层零改动(pay_order.gateway 字段区分来源)。
 */

export interface GatewayCreateInput {
  orderNo: string; // 商户订单号(幂等键,≤32 字母数字 _-*)
  amount: string; // 元,字符串(Decimal 字符串化,禁 float)
  title: string; // 商品标题(≤42 汉字,无表情/%)
  notifyUrl: string; // 异步回调(必填;入账唯一依据)
  returnUrl: string; // 支付完成前端跳转(仅展示用,不作为入账依据)
  clientIp?: string;
}

export interface GatewayCreateResult {
  payUrl: string; // H5 跳转链
  qrUrl?: string; // PC 二维码链(虎皮椒 5 分钟有效)
  openOrderId?: string; // 网关内部单号(查询/对账备用锚)
  raw: unknown; // 原始响应(排障用;含密钥字段不存在)
}

export type GatewayQueryStatus = "paid" | "unpaid" | "refunded";

export interface GatewayQueryResult {
  status: GatewayQueryStatus;
  transactionId?: string; // 微信/支付宝流水号(对账锚点)
  openOrderId?: string;
  raw: unknown;
}

export interface GatewayNotifyResult {
  valid: boolean; // 验签结果(常量时间比较)
  status: string; // 网关原文状态:OD/WP/CD/RD/UD
  orderNo: string;
  totalFee: string;
  transactionId?: string;
  openOrderId?: string;
}

export interface PayGateway {
  readonly name: string; // 'xunhu' | 'mock' | ...
  create(input: GatewayCreateInput): Promise<GatewayCreateResult>;
  query(orderNo: string): Promise<GatewayQueryResult>;
  verifyNotify(payload: Record<string, string>): GatewayNotifyResult;
}
