/**
 * 登录可见门禁集成测试(M21 补齐批;依赖 dev compose PG/Redis,不进
 * make check/CI)。仿旧站 unlock_type=1:免费但须登录——匿名 access 未见/
 * content 401,登录后 access 放行 + content 下发全文;付费文登录未购仍 403
 * (档位不串)。前置:dev compose;测试自清理。
 */
import { loadEnvConfig } from "@next/env";
import { NextRequest } from "next/server";
import bcrypt from "bcryptjs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

loadEnvConfig(process.cwd());
process.env.LOG_LEVEL = "silent";

import { prisma } from "@/lib/db";
import { redis } from "@/lib/redis";

const { GET: accessGET } = await import("@/app/api/pay/access/route");
const { GET: contentGET } = await import("@/app/api/pay/content/route");
const { POST: loginPOST } = await import("@/app/api/auth/login/route");

const PHONE = "13900000010";
const PASSWORD = "it-gate-pass1";
const CAT_SLUG = "it-m21-gate-cat";
const LOGIN_SLUG = "it-m21-login-post";
const PAID_SLUG = "it-m21-paid-gate-post";

const HEADERS: Record<string, string> = {
  origin: "http://localhost:3000",
  "x-forwarded-host": "localhost:3000",
};

async function callGet(
  handler: (req: never) => Promise<Response>,
  postId: string,
  cookie: string | null,
): Promise<Response> {
  return handler(
    new NextRequest(`http://localhost:3000/api/pay/gate?postId=${postId}`, {
      headers: { ...HEADERS, ...(cookie ? { cookie } : {}) },
    }) as never,
  );
}

let loginPostId = "";
let paidPostId = "";

beforeAll(async () => {
  const passwordHash = await bcrypt.hash(PASSWORD, 10);
  await prisma.userAccount.upsert({
    where: { phone: PHONE },
    update: { role: "user", status: "active", passwordHash },
    create: {
      phone: PHONE,
      nickname: "it-gate-user",
      role: "user",
      status: "active",
      passwordHash,
    },
  });
  const category = await prisma.category.upsert({
    where: { slug: CAT_SLUG },
    update: { sortOrder: 999 },
    create: { slug: CAT_SLUG, name: "M21 门禁测试分类", sortOrder: 999 },
  });
  const loginPost = await prisma.post.upsert({
    where: { slug: LOGIN_SLUG },
    update: { isLoginRequired: true, isPurchasable: false },
    create: {
      slug: LOGIN_SLUG,
      title: "M21 登录可见测试文章",
      contentMd: "登录可见正文 LOGIN-ONLY-TAIL",
      categoryId: category.id,
      status: "published",
      publishedAt: new Date(),
      isLoginRequired: true,
    },
  });
  await prisma.post.upsert({
    where: { slug: PAID_SLUG },
    update: { isPurchasable: true, purchasePrice: 5, isLoginRequired: false },
    create: {
      slug: PAID_SLUG,
      title: "M21 付费门禁测试文章",
      contentMd: "付费正文 PAID-TAIL",
      categoryId: category.id,
      status: "published",
      publishedAt: new Date(),
      isPurchasable: true,
      purchasePrice: 5,
    },
  });
  const paidPost = await prisma.post.findUniqueOrThrow({
    where: { slug: PAID_SLUG },
    select: { id: true },
  });
  paidPostId = paidPost.id.toString();
  loginPostId = loginPost.id.toString();
  await redis.del(`auth:fail:acct:${PHONE}`);
});

afterAll(async () => {
  const postIds = await prisma.post.findMany({
    where: { slug: { in: [LOGIN_SLUG, PAID_SLUG] } },
    select: { id: true },
  });
  await prisma.contentPostPurchase.deleteMany({
    where: { postId: { in: postIds.map((p) => p.id) } },
  });
  await prisma.post.deleteMany({ where: { slug: { in: [LOGIN_SLUG, PAID_SLUG] } } });
  await prisma.category.deleteMany({ where: { slug: CAT_SLUG } });
  await prisma.userAccount.deleteMany({ where: { phone: PHONE } });
  await redis.del(`auth:fail:acct:${PHONE}`);
  await prisma.$disconnect();
  await redis.quit().catch(() => undefined);
});

describe("登录可见门禁(补齐批,dev compose 真实 PG/Redis)", () => {
  let cookie: string;

  it("前置登录取 Cookie", async () => {
    const res = await loginPOST(
      new NextRequest("http://localhost:3000/api/auth/login", {
        method: "POST",
        headers: { ...HEADERS, "content-type": "application/json" },
        body: JSON.stringify({ account: PHONE, password: PASSWORD }),
      }) as never,
    );
    expect(res.status).toBe(200);
    cookie = (res.headers.get("set-cookie") ?? "").split(";")[0];
  });

  it("匿名:access 未见 + content 401(登录可见文与付费文同拒)", async () => {
    for (const postId of [loginPostId, paidPostId]) {
      const res = await callGet(accessGET, postId, null);
      const body = (await res.json()) as { data: { loggedIn: boolean; hasAccess: boolean } };
      expect(res.status).toBe(200);
      expect(body.data).toMatchObject({ loggedIn: false, hasAccess: false });
      expect((await callGet(contentGET, postId, null)).status).toBe(401);
    }
  });

  it("登录可见文:登录后 access 放行 + content 下发全文(无需购买)", async () => {
    const res = await callGet(accessGET, loginPostId, cookie);
    const body = (await res.json()) as { data: { loggedIn: boolean; hasAccess: boolean } };
    expect(body.data).toMatchObject({ loggedIn: true, hasAccess: true });

    const content = await callGet(contentGET, loginPostId, cookie);
    expect(content.status).toBe(200);
    const cb = (await content.json()) as { data: { contentMd: string } };
    expect(cb.data.contentMd).toContain("LOGIN-ONLY-TAIL");
    expect(content.headers.get("cache-control")).toContain("no-store");
  });

  it("付费文:同一登录用户未购仍拒(access 未见 + content 403)——档位不串", async () => {
    const res = await callGet(accessGET, paidPostId, cookie);
    const body = (await res.json()) as { data: { hasAccess: boolean } };
    expect(body.data.hasAccess).toBe(false);
    expect((await callGet(contentGET, paidPostId, cookie)).status).toBe(403);
  });
});
