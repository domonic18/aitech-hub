/**
 * 支付对账补偿(M21 批④,提案 §5.2):worker pay-reconcile 队列两个入口——
 * sweep 每 5 分钟收敛近过期/已过期 pending 单(先查单再动状态:回调丢失而
 * 网关已付则补发货,确认未付且过 TTL 才关单;查询失败等下一拍自然退避,
 * 连续 3 次升告警级日志);dailyAudit 每日 04:13 对近 7 天 paid 单查单比对
 * 流水锚,不一致只告警不动账(钱域人工裁决)。两路都只扫当前生效网关的单
 * (gateway 字段过滤)——模式切换后旧网关单查询口径不符,留原网关启用时再
 * 收敛;收银台 off 不关单(查不了单,宁挂起不吞单)。
 */
import { prisma } from "@/lib/db";
import { GATEWAY_MOCK } from "@/lib/pay/gateway-config";
import { getPayGateway } from "@/lib/pay/gateway";
import type { GatewayQueryResult } from "@/lib/pay/gateway/types";
import { logger } from "@/lib/logger";
import { markOrderPaidAndGrant } from "@/lib/pay/order-service";
import { redis } from "@/lib/redis";

const SWEEP_BATCH = 50; // 规模现实:旧站 1.5 年 33 单,上限纯防御
const NEAR_WINDOW_MS = 10 * 60_000; // 10min 内到期视为邻近(5min tick × 2 拍覆盖)
const FAIL_ALERT_THRESHOLD = 3;
const FAIL_TTL_SECONDS = 3600;
const AUDIT_WINDOW_DAYS = 7;
const AUDIT_BATCH = 500;

export type SweepSummary = {
  skipped?: "gateway_off";
  scanned: number;
  paid: number;
  closed: number;
  errors: number;
};

/**
 * sweep(每 5 分钟):近过期/已过期 pending 单先查单——paid 补发货(同回调
 * 口径,updateMany 护栏;查询通道 HTTPS 服务端直连,金额防篡改由回调验签
 * 承担,查询响应无金额字段);unpaid 且过 TTL 关单(关单前必先查单,§5.2);
 * refunded 双回调皆失,口径不明只告警。
 */
export async function sweepExpiredOrders(): Promise<SweepSummary> {
  const summary: SweepSummary = { scanned: 0, paid: 0, closed: 0, errors: 0 };
  const gateway = await getPayGateway();
  if (!gateway) return { ...summary, skipped: "gateway_off" };

  const now = new Date();
  const candidates = await prisma.payOrder.findMany({
    where: {
      status: "pending",
      gateway: gateway.name, // 只扫当前网关的单(模式切换后旧网关单不误判)
      expiresAt: { lte: new Date(now.getTime() + NEAR_WINDOW_MS) },
    },
    select: {
      id: true,
      orderNo: true,
      userId: true,
      expiresAt: true,
      items: { select: { postId: true } },
    },
    orderBy: { expiresAt: "asc" },
    take: SWEEP_BATCH,
  });
  summary.scanned = candidates.length;

  for (const order of candidates) {
    const failKey = `pay:reconcile:fail:${order.orderNo}`;
    try {
      const q = await gateway.query(order.orderNo);
      await redis.del(failKey); // 查询成功清连续失败计数

      if (q.status === "paid") {
        const postId = order.items[0]?.postId;
        if (postId === undefined) {
          // 理论不可达(下单必建单行);无单行无法发货,留痕人工介入
          summary.errors += 1;
          logger.error({ event: "pay.order_items_missing", orderNo: order.orderNo });
          continue;
        }
        const migrated = await markOrderPaidAndGrant({
          orderId: order.id,
          userId: order.userId,
          postId,
          transactionId: q.transactionId,
          openOrderId: q.openOrderId,
        });
        if (migrated) {
          summary.paid += 1;
          logger.info({ event: "pay.order_paid", orderNo: order.orderNo, via: "reconcile" });
        }
      } else if (q.status === "unpaid") {
        if (order.expiresAt <= now) {
          // 竞态护栏:查单后回调先至则 updateMany 落空,不动已迁移状态
          const bumped = await prisma.payOrder.updateMany({
            where: { id: order.id, status: "pending" },
            data: { status: "closed", closedAt: now },
          });
          if (bumped.count > 0) {
            summary.closed += 1;
            logger.info({
              event: "pay.order_closed",
              orderNo: order.orderNo,
              reason: "expired_unpaid",
            });
          }
        }
        // 未过期:保留观察,下一拍再看
      } else {
        // 本地 pending 网关报 refunded:动账口径不明,人工裁决
        summary.errors += 1;
        logger.error({
          event: "pay.reconcile_mismatch",
          orderNo: order.orderNo,
          localStatus: "pending",
          gatewayStatus: q.status,
        });
      }
    } catch (e) {
      summary.errors += 1;
      const consecutive = await redis.incr(failKey);
      if (consecutive === 1) await redis.expire(failKey, FAIL_TTL_SECONDS);
      // 连续失败升告警级(≥3);事件+单号,不记签名/密钥原文(§6 #9)
      const payload = {
        event: "pay.reconcile_error",
        orderNo: order.orderNo,
        consecutive,
        error: String(e),
      };
      if (consecutive >= FAIL_ALERT_THRESHOLD) logger.error(payload);
      else logger.warn(payload);
    }
  }
  return summary;
}

export type DailyAuditSummary = {
  skipped?: "gateway_off" | "mock_no_external_truth";
  checked: number;
  mismatches: number;
  errors: number;
};

/** 单单比对(纯函数,单测钉口径):不一致返回原因,一致返回 null */
export function findAuditMismatch(localTxnId: string | null, q: GatewayQueryResult): string | null {
  if (q.status !== "paid") return `gateway_status_${q.status}`;
  if (!localTxnId) return "local_txn_missing";
  // 网关响应缺流水字段不作不等证据(查询口径缺失≠对不上)
  if (q.transactionId && q.transactionId !== localTxnId) return "transaction_id_differs";
  return null;
}

/** 日对账(每日 04:13):近 7 天 paid 单查单比对流水锚;只告警不动账 */
export async function dailyAuditOrders(): Promise<DailyAuditSummary> {
  const summary: DailyAuditSummary = { checked: 0, mismatches: 0, errors: 0 };
  const gateway = await getPayGateway();
  if (!gateway) return { ...summary, skipped: "gateway_off" };
  if (gateway.name === GATEWAY_MOCK) return { ...summary, skipped: "mock_no_external_truth" };

  const orders = await prisma.payOrder.findMany({
    where: {
      status: "paid",
      gateway: gateway.name,
      paidAt: { gte: new Date(Date.now() - AUDIT_WINDOW_DAYS * 24 * 3_600_000) },
    },
    select: { orderNo: true, gatewayTransactionId: true },
    orderBy: { id: "asc" },
    take: AUDIT_BATCH,
  });
  summary.checked = orders.length;

  for (const order of orders) {
    try {
      const q = await gateway.query(order.orderNo);
      const reason = findAuditMismatch(order.gatewayTransactionId, q);
      if (reason) {
        summary.mismatches += 1;
        logger.error({
          event: "pay.reconcile_mismatch",
          orderNo: order.orderNo,
          reason,
          localStatus: "paid",
          gatewayStatus: q.status,
        });
      }
    } catch (e) {
      summary.errors += 1;
      logger.warn({
        event: "pay.reconcile_error",
        orderNo: order.orderNo,
        phase: "daily_audit",
        error: String(e),
      });
    }
  }
  return summary;
}
