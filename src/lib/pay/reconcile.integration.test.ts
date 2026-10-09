/**
 * 支付对账补偿集成测试(M21 批④;依赖 dev compose PG/Redis,不进 CI)。
 * Mock 网关驱动提案 §5.2 主线:sweep 过期未付关单/回调丢失网关已付补发货/
 * 未过期保留观察/只扫当前网关单/off 宁挂起不吞单/查询失败计数成功清零;
 * dailyAudit mock 跳过。测试自清理(mode 恢复无行)。
 */
import { loadEnvConfig } from "@next/env";
import bcrypt from "bcryptjs";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

loadEnvConfig(process.cwd());
process.env.LOG_LEVEL = "silent";

import { prisma } from "@/lib/db";
import { redis } from "@/lib/redis";

const { createOrReuseOrder } = await import("@/lib/pay/order-service");
const { dailyAuditOrders, sweepExpiredOrders } = await import("@/lib/pay/reconcile");
const { savePayGatewayConfig } = await import("@/lib/pay/gateway-config");
const { MockGateway } = await import("@/lib/pay/gateway/mock");

const BUYER = "13900000008";
const PASSWORD = "it-pay-rec-pass1";
const CAT_SLUG = "it-m21-rec-cat";
const PAID_SLUG = "it-m21-rec-post";
const XUNHU_LEFTOVER_NO = "itrecxunhu000001";

let userId = BigInt(0);
let postId = BigInt(0);

async function resetGateway(): Promise<void> {
  await prisma.payGatewayConfig.deleteMany();
  await savePayGatewayConfig({ mode: "mock" }); // vitest NODE_ENV=test 放行
}

/** 每测自清用户域数据(测试间隔离;顺序跑,fileParallelism 已关) */
async function cleanupUserData(): Promise<void> {
  await prisma.contentPostPurchase.deleteMany({ where: { userId } });
  await prisma.payOrderItem.deleteMany({ where: { order: { userId } } });
  await prisma.payOrder.deleteMany({ where: { userId } });
}

async function newPendingOrder(): Promise<string> {
  const r = await createOrReuseOrder({ userId, postId, clientIp: "127.0.0.1" });
  return r.orderNo;
}

function byOrderNo(orderNo: string) {
  return prisma.payOrder.findUniqueOrThrow({ where: { orderNo } });
}

async function expire(orderNo: string): Promise<void> {
  await prisma.payOrder.update({
    where: { orderNo },
    data: { expiresAt: new Date(Date.now() - 60_000) },
  });
}

beforeAll(async () => {
  const passwordHash = await bcrypt.hash(PASSWORD, 10);
  const user = await prisma.userAccount.upsert({
    where: { phone: BUYER },
    update: { role: "user", status: "active", passwordHash },
    create: { phone: BUYER, nickname: "it-pay-rec", role: "user", status: "active", passwordHash },
  });
  userId = user.id;
  const category = await prisma.category.upsert({
    where: { slug: CAT_SLUG },
    update: { sortOrder: 999 },
    create: { slug: CAT_SLUG, name: "M21 对账测试分类", sortOrder: 999 },
  });
  const post = await prisma.post.upsert({
    where: { slug: PAID_SLUG },
    update: { isPurchasable: true, purchasePrice: 3.0 },
    create: {
      slug: PAID_SLUG,
      title: "M21 对账测试文章",
      contentMd: "对账正文",
      categoryId: category.id,
      status: "published",
      publishedAt: new Date(),
      isPurchasable: true,
      purchasePrice: 3.0,
    },
  });
  postId = post.id;
  await resetGateway();
});

afterAll(async () => {
  await cleanupUserData();
  await prisma.payOrder.deleteMany({ where: { orderNo: XUNHU_LEFTOVER_NO } }); // 跨网关遗留单(直插)
  await prisma.post.deleteMany({ where: { slug: PAID_SLUG } });
  await prisma.category.deleteMany({ where: { slug: CAT_SLUG } });
  await prisma.userAccount.deleteMany({ where: { phone: BUYER } });
  await prisma.payGatewayConfig.deleteMany();
  await redis.keys("pay:reconcile:fail:*").then((keys) => keys.map((k) => redis.del(k)));
  await prisma.$disconnect();
  await redis.quit().catch(() => undefined);
});

describe("pay-reconcile sweep(M21 批④,§5.2)", () => {
  it("过期未付:查单确认后关单(closedAt 落库,不发货)", async () => {
    await cleanupUserData();
    const orderNo = await newPendingOrder();
    await expire(orderNo);

    const r = await sweepExpiredOrders();
    expect(r.closed).toBe(1);
    const order = await byOrderNo(orderNo);
    expect(order.status).toBe("closed");
    expect(order.closedAt).toBeTruthy();
    expect(await prisma.contentPostPurchase.count({ where: { userId, postId } })).toBe(0);
  });

  it("回调丢失但网关已付:补发货(同回调口径),重跑幂等不重复发", async () => {
    await cleanupUserData();
    const orderNo = await newPendingOrder();
    await expire(orderNo);
    new MockGateway().markPaid(orderNo); // 模拟「用户已付,回调丢失」

    const r = await sweepExpiredOrders();
    expect(r.paid).toBe(1);
    const order = await byOrderNo(orderNo);
    expect(order.status).toBe("paid");
    expect(order.gatewayTransactionId).toBe(`mock_txn_${orderNo}`);
    const p = await prisma.contentPostPurchase.findUniqueOrThrow({
      where: { userId_postId: { userId, postId } },
    });
    expect(p.revokedAt).toBeNull();
    expect(p.orderId).toBe(order.id);

    expect((await sweepExpiredOrders()).paid).toBe(0); // 已 paid 不再进候选
    expect(await prisma.contentPostPurchase.count({ where: { userId, postId } })).toBe(1);
  });

  it("未过期 pending:保留观察(不进候选)", async () => {
    await cleanupUserData();
    await newPendingOrder(); // TTL ≈30min,10min 邻近窗外

    const r = await sweepExpiredOrders();
    expect(r.scanned).toBe(0);
  });

  it("只扫当前网关的单:mock 生效时 xunhu 遗留单不动", async () => {
    await cleanupUserData();
    await prisma.payOrder.create({
      data: {
        orderNo: XUNHU_LEFTOVER_NO,
        userId,
        status: "pending",
        amount: "3.00",
        gateway: "xunhu",
        expiresAt: new Date(Date.now() - 60_000),
        items: { create: { postId, title: "遗留单", unitPrice: "3.00" } },
      },
    });

    const r = await sweepExpiredOrders();
    expect(r.scanned).toBe(0); // 模式切换后旧网关单留原网关启用时再收敛
    expect((await byOrderNo(XUNHU_LEFTOVER_NO)).status).toBe("pending");
  });

  it("收银台 off:跳过不动单(查不了单,宁挂起不吞单)", async () => {
    await cleanupUserData();
    const orderNo = await newPendingOrder();
    await expire(orderNo);
    await prisma.payGatewayConfig.deleteMany(); // off

    const r = await sweepExpiredOrders();
    expect(r.skipped).toBe("gateway_off");
    expect((await byOrderNo(orderNo)).status).toBe("pending");
    await resetGateway(); // 恢复 mock,不污染后续测试
  });

  it("查询失败:连续计数留存,成功后清零", async () => {
    await cleanupUserData();
    await resetGateway();
    const orderNo = await newPendingOrder();
    await expire(orderNo);
    const spy = vi.spyOn(MockGateway.prototype, "query");
    spy.mockRejectedValueOnce(new Error("mock timeout"));
    spy.mockRejectedValueOnce(new Error("mock timeout"));

    expect((await sweepExpiredOrders()).errors).toBe(1);
    expect((await sweepExpiredOrders()).errors).toBe(1);
    expect(await redis.get(`pay:reconcile:fail:${orderNo}`)).toBe("2"); // 下一拍自然退避
    expect((await sweepExpiredOrders()).errors).toBe(0); // 第三拍真查询成功
    expect(await redis.get(`pay:reconcile:fail:${orderNo}`)).toBeNull(); // 计数清零
    spy.mockRestore();
  });
});

describe("pay-reconcile dailyAudit(M21 批④)", () => {
  it("mock 模式跳过(无外部真相可对)", async () => {
    const r = await dailyAuditOrders();
    expect(r.skipped).toBe("mock_no_external_truth");
    expect(r.checked).toBe(0);
  });
});
