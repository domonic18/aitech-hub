/**
 * 认证流集成测试(standard/01-testing:*.integration.test.ts 同层;`npm run test:integration`,
 * 不进 test:unit/make check/CI——依赖 dev compose 的 PG/Redis)。
 * 覆盖 M4 验收主线:登录发 Cookie → 会话查询 → 错密 5 次锁号 → 登出吊销(旧 Cookie 复放被拒)。
 * 单测已 mock Redis/PG;这里用真实服务验证装配正确性(键名/计数语义/吊销路径)。
 * 前置:docker compose up -d postgres redis && npx prisma migrate deploy;测试自清理数据。
 */
import { loadEnvConfig } from "@next/env";
import bcrypt from "bcryptjs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

loadEnvConfig(process.cwd());
// pino 在模块导入时读 LOG_LEVEL,须先静音再引路由
process.env.LOG_LEVEL = "silent";

import { prisma } from "@/lib/db";
import { redis } from "@/lib/redis";

const { POST: loginPOST } = await import("@/app/api/auth/login/route");
const { GET: sessionGET } = await import("@/app/api/auth/session/route");
const { POST: logoutPOST } = await import("@/app/api/auth/logout/route");

const PHONE = "13900000002";
const PASSWORD = "it-admin-pass1";
const LOCK_KEY = `auth:fail:acct:${PHONE}`;

const ORIGIN_HEADERS: Record<string, string> = {
  "content-type": "application/json",
  origin: "http://localhost:3000",
  "x-forwarded-host": "localhost:3000",
};

async function callLogin(body: object): Promise<Response> {
  return loginPOST(
    new Request("http://localhost:3000/api/auth/login", {
      method: "POST",
      headers: ORIGIN_HEADERS,
      body: JSON.stringify(body),
    }) as never,
  );
}

function withCookie(extra: { cookie?: string } = {}): Record<string, string> {
  return { ...ORIGIN_HEADERS, ...(extra.cookie ? { cookie: extra.cookie } : {}) };
}

async function callSession(cookie?: string): Promise<Response> {
  return sessionGET(
    new Request("http://localhost:3000/api/auth/session", {
      headers: withCookie({ cookie }),
    }) as never,
  );
}

async function callLogout(cookie: string): Promise<Response> {
  return logoutPOST(
    new Request("http://localhost:3000/api/auth/logout", {
      method: "POST",
      headers: withCookie({ cookie }),
    }) as never,
  );
}

beforeAll(async () => {
  await prisma.userAccount.upsert({
    where: { phone: PHONE },
    update: { role: "admin", status: "active", passwordHash: await bcrypt.hash(PASSWORD, 10) },
    create: {
      phone: PHONE,
      nickname: "it-admin",
      role: "admin",
      status: "active",
      passwordHash: await bcrypt.hash(PASSWORD, 10),
    },
  });
  await redis.del(LOCK_KEY);
});

afterAll(async () => {
  await prisma.userAccount.deleteMany({ where: { phone: PHONE } });
  await redis.del(LOCK_KEY);
  await prisma.$disconnect();
});

describe("认证流(dev compose 真实 PG/Redis)", () => {
  it("错密 5 次 → 第 6 次锁号 429(提示语模糊,正确密码也被锁)", async () => {
    for (let i = 0; i < 5; i++) {
      const res = await callLogin({ phone: PHONE, password: "nope-wrong-1" });
      expect(res.status).toBe(401);
    }
    const locked = await callLogin({ phone: PHONE, password: PASSWORD });
    expect(locked.status).toBe(429);
    const body = (await locked.json()) as { message: string };
    expect(body.message).not.toMatch(/密码|锁定|账号/); // 不泄漏锁定原因
  });

  it("清锁后正确密码 → 200 + httpOnly Cookie + 失败计数清零", async () => {
    await redis.del(LOCK_KEY);
    const res = await callLogin({ phone: PHONE, password: PASSWORD });
    expect(res.status).toBe(200);
    const setCookie = res.headers.get("set-cookie") ?? "";
    expect(setCookie).toContain("ah_at=");
    expect(setCookie.toLowerCase()).toContain("httponly");
    expect(await redis.get(LOCK_KEY)).toBeNull(); // 登录成功清空失败计数
  });

  it("Cookie 换会话身份;登出吊销后旧 Cookie 复放被拒(jti 双查)", async () => {
    const login = await callLogin({ phone: PHONE, password: PASSWORD });
    const cookie = (login.headers.get("set-cookie") ?? "").split(";")[0];

    const session = await callSession(cookie);
    const { data } = (await session.json()) as { data: { user: { sub: string; role: string } } };
    expect(data.user?.role).toBe("admin");
    expect(data.user?.sub).toBeTruthy();

    const user = await prisma.userAccount.findUnique({ where: { phone: PHONE } });
    expect(data.user?.sub).toBe(user!.id.toString());

    expect((await callLogout(cookie)).status).toBe(200);
    const replayed = await callSession(cookie);
    const body = (await replayed.json()) as { data: { user: unknown } };
    expect(body.data.user).toBeNull(); // jti 已吊销,验签虽过仍拒
  });

  it("跨域登录被 Origin 校验拒绝", async () => {
    const res = await callLoginWithOrigin("https://evil.example.com");
    expect(res.status).toBe(403);
  });
});

async function callLoginWithOrigin(origin: string): Promise<Response> {
  return loginPOST(
    new Request("http://localhost:3000/api/auth/login", {
      method: "POST",
      headers: { ...ORIGIN_HEADERS, origin },
      body: JSON.stringify({ phone: PHONE, password: PASSWORD }),
    }) as never,
  );
}
