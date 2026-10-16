/**
 * 飞书免登全链集成测试(standard/01-testing:*.integration.test.ts 同层;
 * `npm run test:integration`,不进 test:unit/make check/CI——依赖 dev compose
 * 的 PG/Redis)。**零真网**:global fetch 桩按 open.feishu.cn 路径分流返回
 * 定型响应,M29 批②「mock 兑换」验收主线:配置+绑定 → status 下发 appId →
 * exchange 兑换发既有会话 Cookie → session 复核;未绑定 403 / 未启用 403 /
 * 限频 429 / bind 自绑+解绑幂等。admin_feishu_config 是共享单例行,测试前
 * 快照、afterAll 原样恢复。
 */
import { loadEnvConfig } from "@next/env";
import { afterAll, beforeAll, afterEach, describe, expect, it, vi } from "vitest";

loadEnvConfig(process.cwd());
process.env.LOG_LEVEL = "silent"; // pino 模块导入时读 LOG_LEVEL,须先静音再引路由

import { prisma } from "@/lib/db";
import { redis } from "@/lib/redis";
import { NextRequest } from "next/server";

import { encryptSecret } from "@/lib/crypto/secret-box";
import { readFullSessionUser } from "@/lib/auth/issuer";
import { env } from "@/lib/env";

const { GET: statusGET } = await import("@/app/api/auth/feishu/status/route");
const { POST: exchangePOST } = await import("@/app/api/auth/feishu/exchange/route");
const {
  GET: bindGET,
  POST: bindPOST,
  DELETE: bindDELETE,
} = await import("@/app/api/admin/feishu/bind/route");

const SITE_ORIGIN = new URL(env.NEXT_PUBLIC_SITE_URL).origin;
const ADMIN_PHONE = "13900000011";
const IP = "203.0.113.77"; // TEST-NET-3 专用测试 IP,避免撞真实限频桶

/** 飞书侧定型桩:按路径分流;user_info 的 union 可在用例内切换 */
let fakeUnion = { union_id: "ou_e2e_bound", open_id: "ou_e2e_open", name: "e2e管理员" };
const fetchStub = vi.fn(async (url: string): Promise<Response> => {
  const body = url.includes("authen/v2/oauth/token")
    ? { code: 0, data: { access_token: "UT_e2e" } }
    : url.includes("authen/v1/user_info")
      ? { code: 0, data: fakeUnion }
      : url.includes("app_access_token/internal")
        ? { app_access_token: "AT_e2e", expire: 7200 }
        : { code: 0 };
  return new Response(JSON.stringify(body), { status: 200 });
});

function req(
  path: string,
  init: { method?: string; body?: object; cookie?: string; ip?: string } = {},
) {
  return new NextRequest(`http://localhost:3000${path}`, {
    method: init.method ?? "GET",
    headers: {
      "content-type": "application/json",
      origin: SITE_ORIGIN,
      "x-forwarded-host": "localhost:3000",
      "x-forwarded-for": init.ip ?? IP,
      ...(init.cookie ? { cookie: init.cookie } : {}),
    },
    ...(init.body ? { body: JSON.stringify(init.body) } : {}),
  });
}

let configSnapshot: {
  appId: string;
  appSecretEnc: string | null;
  appSecretMask: string | null;
  enabled: boolean;
} | null = null;

beforeAll(async () => {
  vi.stubGlobal("fetch", fetchStub);
  const row = await prisma.adminFeishuConfig.findUnique({ where: { id: 1 } });
  configSnapshot = row
    ? {
        appId: row.appId,
        appSecretEnc: row.appSecretEnc,
        appSecretMask: row.appSecretMask,
        enabled: row.enabled,
      }
    : null;
  await prisma.userAccount.upsert({
    where: { phone: ADMIN_PHONE },
    update: { role: "admin", status: "active" },
    create: {
      phone: ADMIN_PHONE,
      nickname: "e2e-feishu-admin",
      role: "admin",
      status: "active",
      passwordHash: "$2b$10$e2e.no-login-needed",
    },
  });
});

afterEach(async () => {
  await redis.del("feishu:app_token", `auth:feishu:exch:${IP}`);
});

afterAll(async () => {
  // 共享单例行原样恢复(测试前无行则删行)
  if (configSnapshot) {
    await prisma.adminFeishuConfig.update({ where: { id: 1 }, data: configSnapshot });
  } else {
    await prisma.adminFeishuConfig.deleteMany({ where: { id: 1 } });
  }
  const user = await prisma.userAccount.findUnique({ where: { phone: ADMIN_PHONE } });
  if (user) {
    await prisma.adminFeishuBinding.deleteMany({ where: { userId: user.id } });
  }
  await prisma.userAccount.deleteMany({ where: { phone: ADMIN_PHONE } });
  await redis.del("feishu:app_token", `auth:feishu:exch:${IP}`);
  await prisma.$disconnect();
  vi.unstubAllGlobals();
});

async function saveConfig(enabled: boolean): Promise<void> {
  await prisma.adminFeishuConfig.upsert({
    where: { id: 1 },
    update: {
      appId: "cli_e2e",
      appSecretEnc: encryptSecret("secret_e2e"),
      appSecretMask: "se****",
      enabled,
    },
    create: {
      id: 1,
      appId: "cli_e2e",
      appSecretEnc: encryptSecret("secret_e2e"),
      appSecretMask: "se****",
      enabled,
    },
  });
}

async function adminCookie(): Promise<string> {
  const { issueSession, sessionCookie } = await import("@/lib/auth/issuer");
  const user = await prisma.userAccount.findUniqueOrThrow({ where: { phone: ADMIN_PHONE } });
  const { token } = await issueSession({ sub: user.id.toString(), role: user.role });
  return `${sessionCookie(token).name}=${token}`;
}

describe("飞书免登全链(dev compose 真实 PG/Redis + 飞书桩)", () => {
  it("status:凭证齐(未启用也行)→ appId+enabled 透传;行删除未配置 → 403 fail-closed", async () => {
    await saveConfig(false);
    const res = await statusGET();
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      code: number;
      data: { enabled: boolean; appId: string };
    };
    expect(body.code).toBe(0);
    expect(body.data).toEqual({ enabled: false, appId: "cli_e2e" });

    await prisma.adminFeishuConfig.deleteMany({ where: { id: 1 } });
    const blank = await statusGET();
    expect(blank.status).toBe(403);
    await saveConfig(false); // 后续用例依赖配置行在位,恢复
  });

  it("exchange:enabled+白名单命中 → 200+会话 Cookie,readFullSessionUser 复核 admin", async () => {
    await saveConfig(true);
    const user = await prisma.userAccount.findUniqueOrThrow({ where: { phone: ADMIN_PHONE } });
    await prisma.adminFeishuBinding.upsert({
      where: { userId: user.id },
      update: { unionId: "ou_e2e_bound", openId: "ou_e2e_open", feishuName: "e2e管理员" },
      create: {
        userId: user.id,
        unionId: "ou_e2e_bound",
        openId: "ou_e2e_open",
        feishuName: "e2e管理员",
      },
    });
    const res = await exchangePOST(
      req("/api/auth/feishu/exchange", { method: "POST", body: { code: "authcode-1" } }),
    );
    expect(res.status).toBe(200);
    const cookie = res.headers.get("set-cookie") ?? "";
    expect(cookie).toContain("HttpOnly");
    const token = cookie.split(";")[0]?.split("=")[1] ?? "";
    const claims = await readFullSessionUser(`${cookie.split(";")[0]?.split("=")[0]}=${token}`);
    expect(claims?.role).toBe("admin");
    expect(claims?.sub).toBe(user.id.toString());
  });

  it("exchange:未绑定身份 → 403 模糊提示(不给探测面)", async () => {
    fakeUnion = { union_id: "ou_e2e_stranger", open_id: "ou_other", name: "外人" };
    const res = await exchangePOST(
      req("/api/auth/feishu/exchange", { method: "POST", body: { code: "authcode-2" } }),
    );
    expect(res.status).toBe(403);
    const body = (await res.json()) as { message: string };
    expect(body.message).not.toContain("ou_e2e");
  });

  it("exchange:未启用 → 403;限频桶满 → 429", async () => {
    fakeUnion = { union_id: "ou_e2e_bound", open_id: "ou_e2e_open", name: "e2e管理员" };
    await saveConfig(false);
    const off = await exchangePOST(
      req("/api/auth/feishu/exchange", { method: "POST", body: { code: "c" }, ip: "203.0.113.78" }),
    );
    expect(off.status).toBe(403);

    await saveConfig(true);
    await redis.set(`auth:feishu:exch:${IP}`, "30", "EX", 600);
    const limited = await exchangePOST(
      req("/api/auth/feishu/exchange", { method: "POST", body: { code: "c" } }),
    );
    expect(limited.status).toBe(429);
  });

  it("bind:密码会话自绑 → GET 可见 → DELETE 幂等解绑", async () => {
    const cookie = await adminCookie();
    const post = await bindPOST(
      req("/api/admin/feishu/bind", { method: "POST", body: { code: "bind-code" }, cookie }),
    );
    expect(post.status).toBe(200);
    const gotRes = await bindGET(req("/api/admin/feishu/bind", { cookie }));
    const got = (await gotRes.json()) as {
      code: number;
      data: { feishuName: string | null } | null;
    };
    expect(got.code).toBe(0);
    expect(got.data?.feishuName).toBe("e2e管理员");

    const del = await bindDELETE(req("/api/admin/feishu/bind", { method: "DELETE", cookie }));
    expect(del.status).toBe(200);
    const del2 = await bindDELETE(req("/api/admin/feishu/bind", { method: "DELETE", cookie }));
    expect(del2.status).toBe(200); // 幂等
    const afterRes = await bindGET(req("/api/admin/feishu/bind", { cookie }));
    expect(((await afterRes.json()) as { data: unknown }).data).toBeNull();
  });

  it("bind:未登录 401;跨站 Origin 403", async () => {
    const anon = await bindGET(req("/api/admin/feishu/bind"));
    expect(anon.status).toBe(401);
    const cross = new NextRequest("http://localhost:3000/api/admin/feishu/bind", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: "https://evil.example.com",
        host: "localhost:3000",
      },
      body: JSON.stringify({ code: "x" }),
    });
    const res = await bindPOST(cross);
    expect(res.status).toBe(403);
  });
});
