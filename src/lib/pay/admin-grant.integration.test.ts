/**
 * 人工开通/恢复集成测试(M21 批⑤;依赖 dev compose PG/Redis,不进
 * make check/CI)。覆盖 grant 路由门禁(未登录/跨域/非 admin)、账号双路
 * 检索(手机号/wp_user_id)、manual 开通与退款撤销后 admin_restore 恢复、
 * 幂等重提。写侧走 entitlement 唯一入口,行数与 source 口径一并验证。
 * 前置:dev compose;测试自清理。
 */
import { loadEnvConfig } from "@next/env";
import bcrypt from "bcryptjs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

loadEnvConfig(process.cwd());
process.env.LOG_LEVEL = "silent";

import { prisma } from "@/lib/db";

const { POST: grantPOST } = await import("@/app/api/pay/admin/grant/route");
const { POST: loginPOST } = await import("@/app/api/auth/login/route");
const { revokePurchase } = await import("@/lib/pay/entitlement");

const ADMIN_PHONE = "13900000008";
const USER_PHONE = "13900000009";
const USER_WP_ID = 999001;
const PASSWORD = "it-grant-pass1";
const CAT_SLUG = "it-m21-grant-cat";
const POST_SLUG = "it-m21-grant-post";

const HEADERS: Record<string, string> = {
  "content-type": "application/json",
  origin: "http://localhost:3000",
  "x-forwarded-host": "localhost:3000",
};

function call(
  body: object,
  cookie: string | null,
  origin = "http://localhost:3000",
): Promise<Response> {
  return grantPOST(
    new Request("http://localhost:3000/api/pay/admin/grant", {
      method: "POST",
      headers: { ...HEADERS, origin, ...(cookie ? { cookie } : {}) },
      body: JSON.stringify(body),
    }) as never,
  );
}

const cookies = new Map<string, string>();

async function loginAs(phone: string): Promise<string> {
  const res = await loginPOST(
    new Request("http://localhost:3000/api/auth/login", {
      method: "POST",
      headers: HEADERS,
      body: JSON.stringify({ account: phone, password: PASSWORD }),
    }) as never,
  );
  expect(res.status).toBe(200);
  return (res.headers.get("set-cookie") ?? "").split(";")[0];
}

let userPostId = "";

beforeAll(async () => {
  const passwordHash = await bcrypt.hash(PASSWORD, 10);
  await prisma.userAccount.upsert({
    where: { phone: ADMIN_PHONE },
    update: { role: "admin", status: "active", passwordHash },
    create: {
      phone: ADMIN_PHONE,
      nickname: "it-grant-admin",
      role: "admin",
      status: "active",
      passwordHash,
    },
  });
  await prisma.userAccount.upsert({
    where: { phone: USER_PHONE },
    update: { role: "user", status: "active", passwordHash },
    create: {
      phone: USER_PHONE,
      nickname: "it-grant-user",
      role: "user",
      status: "active",
      passwordHash,
      wpUserId: BigInt(USER_WP_ID),
    },
  });
  const category = await prisma.category.upsert({
    where: { slug: CAT_SLUG },
    update: { sortOrder: 999 },
    create: { slug: CAT_SLUG, name: "M21 开通测试分类", sortOrder: 999 },
  });
  const post = await prisma.post.upsert({
    where: { slug: POST_SLUG },
    update: { isPurchasable: true, purchasePrice: 5.0 },
    create: {
      slug: POST_SLUG,
      title: "M21 开通测试文章",
      contentMd: "付费内容",
      categoryId: category.id,
      status: "published",
      publishedAt: new Date(),
      isPurchasable: true,
      purchasePrice: 5.0,
    },
  });
  userPostId = post.id.toString();
  cookies.set(ADMIN_PHONE, await loginAs(ADMIN_PHONE));
  cookies.set(USER_PHONE, await loginAs(USER_PHONE));
});

afterAll(async () => {
  await prisma.contentPostPurchase.deleteMany({ where: { postId: BigInt(userPostId) } });
  await prisma.post.deleteMany({ where: { slug: POST_SLUG } });
  await prisma.category.deleteMany({ where: { slug: CAT_SLUG } });
  await prisma.userAccount.deleteMany({ where: { phone: { in: [ADMIN_PHONE, USER_PHONE] } } });
  await prisma.$disconnect();
});

describe("人工开通/恢复 API 门禁(批⑤)", () => {
  it("未登录 401;跨域 403;非 admin 登录仍 401", async () => {
    expect(
      (await call({ account: USER_PHONE, postSlug: POST_SLUG, action: "manual" }, null)).status,
    ).toBe(401);
    expect(
      (
        await call(
          { account: USER_PHONE, postSlug: POST_SLUG, action: "manual" },
          cookies.get(ADMIN_PHONE) ?? null,
          "https://evil.example.com",
        )
      ).status,
    ).toBe(403);
    expect(
      (
        await call(
          { account: USER_PHONE, postSlug: POST_SLUG, action: "manual" },
          cookies.get(USER_PHONE) ?? null,
        )
      ).status,
    ).toBe(401);
  });

  it("非法 action/空账号 400;查无用户 404;查无文章 404", async () => {
    const admin = cookies.get(ADMIN_PHONE) ?? null;
    expect(
      (await call({ account: USER_PHONE, postSlug: POST_SLUG, action: "order" }, admin)).status,
    ).toBe(400);
    expect((await call({ account: "", postSlug: POST_SLUG, action: "manual" }, admin)).status).toBe(
      400,
    );
    expect(
      (await call({ account: "13999999999", postSlug: POST_SLUG, action: "manual" }, admin)).status,
    ).toBe(404);
    expect(
      (await call({ account: USER_PHONE, postSlug: "no-such-post", action: "manual" }, admin))
        .status,
    ).toBe(404);
  });
});

describe("人工开通/恢复主线(dev compose 真实 PG)", () => {
  it("manual 手机号开通 → purchase 落行(source=manual,orderId=null)", async () => {
    const res = await call(
      { account: USER_PHONE, postSlug: POST_SLUG, action: "manual" },
      cookies.get(ADMIN_PHONE) ?? null,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { code: number; data: { message: string } };
    expect(body.code).toBe(0);
    expect(body.data.message).toContain("开通");

    const row = await prisma.contentPostPurchase.findUnique({
      where: {
        userId_postId: {
          userId: (await byPhone(USER_PHONE)).id,
          postId: BigInt(userPostId),
        },
      },
    });
    expect(row).toMatchObject({ source: "manual", orderId: null, revokedAt: null });
  });

  it("重提幂等:仍单行,grantedAt 刷新不报错", async () => {
    const before = await prisma.contentPostPurchase.findFirst({
      where: { postId: BigInt(userPostId) },
    });
    const res = await call(
      { account: USER_PHONE, postSlug: POST_SLUG, action: "manual" },
      cookies.get(ADMIN_PHONE) ?? null,
    );
    expect(res.status).toBe(200);
    const rows = await prisma.contentPostPurchase.findMany({
      where: { postId: BigInt(userPostId) },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.grantedAt.getTime()).toBeGreaterThanOrEqual(before!.grantedAt.getTime());
  });

  it("退款撤销后 admin_restore 恢复:revokedAt 清空,source 置 admin_restore", async () => {
    const user = await byPhone(USER_PHONE);
    await revokePurchase(prisma, { userId: user.id, postId: BigInt(userPostId), reason: "refund" });
    const revoked = await prisma.contentPostPurchase.findUnique({
      where: { userId_postId: { userId: user.id, postId: BigInt(userPostId) } },
    });
    expect(revoked?.revokedAt).not.toBeNull();

    const res = await call(
      { account: USER_PHONE, postSlug: POST_SLUG, action: "admin_restore" },
      cookies.get(ADMIN_PHONE) ?? null,
    );
    expect(res.status).toBe(200);
    const row = await prisma.contentPostPurchase.findUnique({
      where: { userId_postId: { userId: user.id, postId: BigInt(userPostId) } },
    });
    expect(row).toMatchObject({ source: "admin_restore", revokedAt: null, revokedReason: null });
  });

  it("wp_user_id 检索同路可开通(账号双路)", async () => {
    const res = await call(
      { account: String(USER_WP_ID), postSlug: POST_SLUG, action: "manual" },
      cookies.get(ADMIN_PHONE) ?? null,
    );
    expect(res.status).toBe(200);
    const user = await byPhone(USER_PHONE);
    const row = await prisma.contentPostPurchase.findUnique({
      where: { userId_postId: { userId: user.id, postId: BigInt(userPostId) } },
    });
    expect(row?.revokedAt).toBeNull();
  });
});

async function byPhone(phone: string) {
  const u = await prisma.userAccount.findUnique({ where: { phone }, select: { id: true } });
  expect(u).not.toBeNull();
  return u!;
}
