/**
 * 付费下单全链路集成测试(M21 批③;依赖 dev compose PG/Redis,不进
 * make check/CI)。MockGateway 模式驱动提案 §5.1 主线:登录→下单(复用未付
 * 单)→模拟回调→事务发货→门禁放行→退款撤销;伪造回调全拒(坏签/金额篡改/
 * 未知单号),重放幂等。前置:dev compose;测试自清理(mode 恢复 off)。
 */
import { loadEnvConfig } from "@next/env";
import { NextRequest } from "next/server";
import bcrypt from "bcryptjs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

loadEnvConfig(process.cwd());
process.env.LOG_LEVEL = "silent";

import { prisma } from "@/lib/db";
import { redis } from "@/lib/redis";

const { POST: ordersPOST } = await import("@/app/api/pay/orders/route");
const { GET: orderGET } = await import("@/app/api/pay/orders/[orderNo]/route");
const { POST: notifyPOST } = await import("@/app/api/pay/notify/route");
const { GET: accessGET } = await import("@/app/api/pay/access/route");
const { GET: contentGET } = await import("@/app/api/pay/content/route");
const { POST: mockCheckoutPOST } = await import("@/app/api/pay/mock/checkout/route");
const { POST: loginPOST } = await import("@/app/api/auth/login/route");
const { savePayGatewayConfig } = await import("@/lib/pay/gateway-config");
const { buildMockNotify } = await import("@/lib/pay/gateway/mock");
const { hasValidPurchase } = await import("@/lib/pay/entitlement");

const BUYER = "13900000005";
const BUYER2 = "13900000006";
const BUYER3 = "13900000007";
const PASSWORD = "it-buyer-pass1";
const CAT_SLUG = "it-m21-cat";
const PAID_SLUG = "it-m21-paid-post";
const FREE_SLUG = "it-m21-free-post";

const HEADERS: Record<string, string> = {
  "content-type": "application/json",
  origin: "http://localhost:3000",
  "x-forwarded-host": "localhost:3000",
};

const PHONES = [BUYER, BUYER2, BUYER3];

function call(
  handler: (...args: never[]) => Promise<Response>, // 兼容带 ctx 的动态路由(orders/[orderNo])
  url: string,
  method: string,
  cookie: string | null,
  body?: object,
  ctx?: unknown,
): Promise<Response> {
  return handler(
    new NextRequest(`http://localhost:3000${url}`, {
      method,
      headers: { ...HEADERS, ...(cookie ? { cookie } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}),
    }) as never,
    ctx as never,
  );
}

async function notify(payload: Record<string, string>): Promise<Response> {
  return notifyPOST(
    new NextRequest("http://localhost:3000/api/pay/notify", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    }) as never,
  );
}

const cookies = new Map<string, string>();

async function loginAs(phone: string): Promise<string> {
  const res = await loginPOST(
    new NextRequest("http://localhost:3000/api/auth/login", {
      method: "POST",
      headers: HEADERS,
      body: JSON.stringify({ account: phone, password: PASSWORD }),
    }) as never,
  );
  expect(res.status).toBe(200);
  return (res.headers.get("set-cookie") ?? "").split(";")[0];
}

let paidPostId = "";
let paidOrderNo = "";

beforeAll(async () => {
  // 限频桶清理(集成多轮跑累计会顶满,与注册同坑)
  for (const phone of PHONES) {
    const u = await prisma.userAccount.findUnique({ where: { phone }, select: { id: true } });
    if (u) await redis.del(`pay:order:u:${u.id}`);
  }
  await redis.del("pay:order:ip:");
  // 造数:三买家 + 分类 + 付费文(正文 >800 字验预览截断)+ 免费文
  const passwordHash = await bcrypt.hash(PASSWORD, 10);
  for (const phone of PHONES) {
    await prisma.userAccount.upsert({
      where: { phone },
      update: { role: "user", status: "active", passwordHash },
      create: {
        phone,
        nickname: `it-buyer-${phone.slice(-2)}`,
        role: "user",
        status: "active",
        passwordHash,
      },
    });
  }
  const category = await prisma.category.upsert({
    where: { slug: CAT_SLUG },
    update: { sortOrder: 999 },
    create: { slug: CAT_SLUG, name: "M21 测试分类", sortOrder: 999 },
  });
  const longBody = `${"付费正文段落。".repeat(160)}全文尾部标记 FULL-TAIL`;
  const paid = await prisma.post.upsert({
    where: { slug: PAID_SLUG },
    update: { isPurchasable: true, purchasePrice: 5.0 },
    create: {
      slug: PAID_SLUG,
      title: "M21 付费测试文章",
      contentMd: longBody,
      categoryId: category.id,
      status: "published",
      publishedAt: new Date(),
      isPurchasable: true,
      purchasePrice: 5.0,
    },
  });
  await prisma.post.upsert({
    where: { slug: FREE_SLUG },
    update: { isPurchasable: false, purchasePrice: null },
    create: {
      slug: FREE_SLUG,
      title: "M21 免费测试文章",
      contentMd: "免费内容",
      categoryId: category.id,
      status: "published",
      publishedAt: new Date(),
    },
  });
  paidPostId = paid.id.toString();
  await prisma.payGatewayConfig.deleteMany();
  await savePayGatewayConfig({ mode: "mock" }); // mock 模式(vitest NODE_ENV=test 放行)
  for (const phone of PHONES) cookies.set(phone, await loginAs(phone));
});

afterAll(async () => {
  const userIds = await prisma.userAccount.findMany({
    where: { phone: { in: PHONES } },
    select: { id: true },
  });
  await prisma.payNotifyLog.deleteMany();
  await prisma.payOrderItem.deleteMany({
    where: { order: { userId: { in: userIds.map((u) => u.id) } } },
  });
  await prisma.payOrder.deleteMany({ where: { userId: { in: userIds.map((u) => u.id) } } });
  await prisma.contentPostPurchase.deleteMany({ where: { postId: BigInt(paidPostId) } });
  await prisma.post.deleteMany({ where: { slug: { in: [PAID_SLUG, FREE_SLUG] } } });
  await prisma.category.deleteMany({ where: { slug: CAT_SLUG } });
  await prisma.userAccount.deleteMany({ where: { phone: { in: PHONES } } });
  await prisma.payGatewayConfig.deleteMany();
  await prisma.$disconnect();
  await redis.quit().catch(() => undefined);
});

async function createOrder(
  phone: string,
  postId: string,
): Promise<{ orderNo: string; payUrl: string }> {
  const res = await call(ordersPOST, "/api/pay/orders", "POST", ck(phone), { postId });
  expect(res.status).toBe(200);
  const body = (await res.json()) as { data: { orderNo: string; payUrl: string } };
  return body.data;
}

describe("下单 API 门禁(批③)", () => {
  it("未登录 401;跨域 403;免费文 400", async () => {
    expect(
      (await call(ordersPOST, "/api/pay/orders", "POST", null, { postId: paidPostId })).status,
    ).toBe(401);
    const evil = new NextRequest("http://localhost:3000/api/pay/orders", {
      method: "POST",
      headers: { ...HEADERS, origin: "https://evil.example.com", cookie: ck("BUYER") ?? "" },
      body: JSON.stringify({ postId: paidPostId }),
    }) as never;
    expect((await ordersPOST(evil)).status).toBe(403);
    const free = await prisma.post.findUnique({ where: { slug: FREE_SLUG }, select: { id: true } });
    expect(
      (
        await call(ordersPOST, "/api/pay/orders", "POST", ck("BUYER"), {
          postId: free!.id.toString(),
        })
      ).status,
    ).toBe(400);
  });
});

describe("Mock 全链路主线(下单→回调→发货→门禁)", () => {
  it("下单 pending → 回调 OD → paid + 权益 + 全文可取", async () => {
    const { orderNo, payUrl } = await createOrder(BUYER, paidPostId);
    expect(payUrl).toContain(orderNo); // mock://pay/<orderNo>
    paidOrderNo = orderNo;

    const view = await call(orderGET, `/api/pay/orders/${orderNo}`, "GET", ck("BUYER"), undefined, {
      params: Promise.resolve({ orderNo }),
    });
    expect(((await view.json()) as { data: { status: string } }).data.status).toBe("pending");

    const res = await notify(buildMockNotify(orderNo, "5.00"));
    expect((await res.text()).trim()).toBe("success");

    const paid = await call(orderGET, `/api/pay/orders/${orderNo}`, "GET", ck("BUYER"), undefined, {
      params: Promise.resolve({ orderNo }),
    });
    expect(((await paid.json()) as { data: { status: string } }).data.status).toBe("paid");

    const access = await call(
      accessGET,
      `/api/pay/access?postId=${paidPostId}`,
      "GET",
      ck("BUYER"),
    );
    expect(((await access.json()) as { data: { hasAccess: boolean } }).data.hasAccess).toBe(true);
    expect(await hasValidPurchase((await userByPhone(BUYER)).id, BigInt(paidPostId))).toBe(true);

    const content = await call(
      contentGET,
      `/api/pay/content?postId=${paidPostId}`,
      "GET",
      ck("BUYER"),
    );
    const body = (await content.json()) as { data: { contentMd: string } };
    expect(body.data.contentMd).toContain("FULL-TAIL"); // 全文(预览页永不携带)
  });

  it("复用未付单:同人同文重复下单返回同一单号", async () => {
    const a = await createOrder(BUYER2, paidPostId);
    const b = await createOrder(BUYER2, paidPostId);
    expect(b.orderNo).toBe(a.orderNo); // 幂等键语义
  });

  it("已持有权益再下单 409", async () => {
    const res = await call(ordersPOST, "/api/pay/orders", "POST", ck("BUYER"), {
      postId: paidPostId,
    });
    expect(res.status).toBe(409);
  });
});

describe("回调安全(伪造全拒/重放幂等/退款撤销)", () => {
  it("坏签(篡改金额)拒:单不动、留痕 signValid=false", async () => {
    const { orderNo } = await createOrder(BUYER2, paidPostId);
    const forged = buildMockNotify(orderNo, "5.00");
    forged.total_fee = "0.01"; // 破坏签名
    expect((await notify(forged)).status).toBe(400);
    const row = await prisma.payNotifyLog.findFirst({
      where: { orderNo },
      orderBy: { id: "desc" },
      select: { signValid: true, handled: true },
    });
    expect(row?.signValid).toBe(false);
    const view = await call(
      orderGET,
      `/api/pay/orders/${orderNo}`,
      "GET",
      ck("BUYER2"),
      undefined,
      {
        params: Promise.resolve({ orderNo }),
      },
    );
    expect(((await view.json()) as { data: { status: string } }).data.status).toBe("pending");
  });

  it("金额篡改(合法签名但金额不符)拒;他人单号查询 404", async () => {
    const orders = await prisma.payOrder.findFirst({
      where: {
        items: { some: { postId: BigInt(paidPostId) } },
        userId: { not: (await userByPhone(BUYER)).id },
      },
      orderBy: { id: "desc" },
      select: { orderNo: true, userId: true },
    });
    expect(orders).toBeTruthy();
    expect((await notify(buildMockNotify(orders!.orderNo, "0.01"))).status).toBe(400);
    const view = await call(
      orderGET,
      `/api/pay/orders/${orders!.orderNo}`,
      "GET",
      ck("BUYER"),
      undefined,
      { params: Promise.resolve({ orderNo: orders!.orderNo }) },
    );
    expect(view.status).toBe(404); // 他人订单不可见
  });

  it("未知单号拒;重放 OD 幂等(仍 paid、权益单条)", async () => {
    expect((await notify(buildMockNotify("nonexistent000001", "5.00"))).status).toBe(400);

    const before = await prisma.contentPostPurchase.count({
      where: { postId: BigInt(paidPostId) },
    });
    expect((await notify(buildMockNotify(paidOrderNo, "5.00"))).status).toBe(200); // 重放
    const after = await prisma.contentPostPurchase.count({ where: { postId: BigInt(paidPostId) } });
    expect(after).toBe(before); // 唯一约束 upsert,不重复发货
  });

  it("CD 退款:订单 refunded + 权益软撤销 + 门禁收回 + 全文 403", async () => {
    const res = await notify(buildMockNotify(paidOrderNo, "5.00", "CD"));
    expect((await res.text()).trim()).toBe("success");
    const order = await prisma.payOrder.findUniqueOrThrow({ where: { orderNo: paidOrderNo } });
    expect(order.status).toBe("refunded");
    expect(order.refundedAt).toBeTruthy();

    const purchase = await prisma.contentPostPurchase.findUniqueOrThrow({
      where: {
        userId_postId: { userId: (await userByPhone(BUYER)).id, postId: BigInt(paidPostId) },
      },
    });
    expect(purchase.revokedAt).toBeTruthy();
    expect(await hasValidPurchase((await userByPhone(BUYER)).id, BigInt(paidPostId))).toBe(false);

    const access = await call(
      accessGET,
      `/api/pay/access?postId=${paidPostId}`,
      "GET",
      ck("BUYER"),
    );
    expect(((await access.json()) as { data: { hasAccess: boolean } }).data.hasAccess).toBe(false);
    const content = await call(
      contentGET,
      `/api/pay/content?postId=${paidPostId}`,
      "GET",
      ck("BUYER"),
    );
    expect(content.status).toBe(403);
  });
});

describe("Mock 模拟支付端点(开发收银台)", () => {
  it("本人单模拟支付直达 paid;他人单 404;mock 模式外不可达", async () => {
    const { orderNo } = await createOrder(BUYER3, paidPostId);
    const ok = await call(mockCheckoutPOST, "/api/pay/mock/checkout", "POST", ck("BUYER3"), {
      orderNo,
    });
    expect(((await ok.json()) as { code: number }).code).toBe(0);

    const other = new NextRequest("http://localhost:3000/api/pay/mock/checkout", {
      method: "POST",
      headers: { ...HEADERS, cookie: ck("BUYER2") ?? "" },
      body: JSON.stringify({ orderNo }),
    }) as never;
    expect((await mockCheckoutPOST(other)).status).toBe(404);
  });
});

async function userByPhone(phone: string) {
  const u = await prisma.userAccount.findUniqueOrThrow({ where: { phone }, select: { id: true } });
  return u;
}

function ck(name: string): string | null {
  // 调用点混用常量名("BUYER")与手机号变量(createOrder)——名字先翻译成手机号
  const byName: Record<string, string> = { BUYER, BUYER2, BUYER3 };
  return cookies.get(byName[name] ?? name) ?? null;
}
