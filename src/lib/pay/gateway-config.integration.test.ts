/**
 * 支付配置 API + 运行时配置集成测试(M21 批②;依赖 dev compose PG/Redis,
 * 不进 make check/CI)。覆盖:admin-only 鉴权、secret 只写不读(掩码形态
 * 回显、明文不出现在应答)、留空保留原密钥、首次启用必须给 secret、
 * 模式三态切换(off 保凭据/切走再切回 secret 不重输/mock 清凭据列)、
 * runtime 配置的 enabled 行门控与 updatedAt 缓存换新。
 */
import { loadEnvConfig } from "@next/env";
import bcrypt from "bcryptjs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

loadEnvConfig(process.cwd());
process.env.LOG_LEVEL = "silent";

import { prisma } from "@/lib/db";

const { GET: configGET, PUT: configPUT } = await import("@/app/api/pay-config/route");
const { getPayGatewayRuntimeConfig, maskSecret } = await import("@/lib/pay/gateway-config");

const PHONE = "13900000004";
const PASSWORD = "it-admin-pass1";
const ORIGIN = "http://localhost:3000";
const HEADERS: Record<string, string> = {
  "content-type": "application/json",
  origin: ORIGIN,
  "x-forwarded-host": "localhost:3000",
};
const SECRET_A = "aaaa1111aaaa1111aaaa1111aaaa1111";
const SECRET_B = "bbbb2222bbbb2222bbbb2222bbbb2222";

let cookie = "";

function call(
  method: "GET" | "PUT",
  body?: object,
  headers = HEADERS,
  withCookie = true,
): Promise<Response> {
  return (method === "GET" ? configGET : configPUT)(
    new Request(`${ORIGIN}/api/pay-config`, {
      method,
      headers: { ...headers, ...(withCookie && cookie ? { cookie } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}),
    }) as never,
  );
}

beforeAll(async () => {
  await prisma.userAccount.upsert({
    where: { phone: PHONE },
    update: { role: "admin", status: "active", passwordHash: await bcrypt.hash(PASSWORD, 10) },
    create: {
      phone: PHONE,
      nickname: "it-pay-admin",
      role: "admin",
      status: "active",
      passwordHash: await bcrypt.hash(PASSWORD, 10),
    },
  });
  await prisma.payGatewayConfig.deleteMany();
  const login = await loginAs(PHONE);
  cookie = (login.headers.get("set-cookie") ?? "").split(";")[0];
});

afterAll(async () => {
  await prisma.payGatewayConfig.deleteMany();
  await prisma.userAccount.deleteMany({ where: { phone: PHONE } });
  await prisma.$disconnect();
});

async function loginAs(account: string): Promise<Response> {
  const { POST: loginPOST } = await import("@/app/api/auth/login/route");
  return loginPOST(
    new Request(`${ORIGIN}/api/auth/login`, {
      method: "POST",
      headers: HEADERS,
      body: JSON.stringify({ account, password: PASSWORD }),
    }) as never,
  );
}

describe("支付配置 API(admin-only,模式即总闸,secret 只写不读)", () => {
  it("未登录 GET/PUT 401;跨域 PUT 403", async () => {
    expect((await call("GET", undefined, HEADERS, false)).status).toBe(401);
    expect((await call("PUT", { mode: "off" }, HEADERS, false)).status).toBe(401);
    expect(
      (await call("PUT", { mode: "off" }, { ...HEADERS, origin: "https://evil.example.com" }))
        .status,
    ).toBe(403);
  });

  it("xunhu 首启无 secret 400;带 secret 保存成功 → mode+掩码回显,明文不出现在应答", async () => {
    const noSecret = await call("PUT", {
      mode: "xunhu",
      appId: "1234567890",
      apiBase: "https://api.dpweixin.com",
    });
    expect(noSecret.status).toBe(400);

    const created = await call("PUT", {
      mode: "xunhu",
      appId: "1234567890",
      appSecret: SECRET_A,
      apiBase: "https://api.dpweixin.com",
      apiBaseBackup: "https://api.xunhupay.com",
      notifyUrl: "https://17aitech.com/api/pay/notify",
      returnUrl: "https://17aitech.com/pay/done",
      orderTtlMin: 45,
    });
    expect(created.status).toBe(200);
    const view = (await created.json()) as { data: Record<string, unknown> };
    expect(view.data).toMatchObject({
      mode: "xunhu",
      appId: "1234567890",
      apiBase: "https://api.dpweixin.com",
      notifyUrl: "https://17aitech.com/api/pay/notify",
      returnUrl: "https://17aitech.com/pay/done",
      orderTtlMin: 45,
      secretSet: true,
      secretMask: maskSecret(SECRET_A),
    });
    expect(JSON.stringify(view)).not.toContain(SECRET_A);
  });

  it("切 off 凭据行保留(enabled 全 false);留空 secret 保留原值;http apiBase 400", async () => {
    const off = await call("PUT", { mode: "off" });
    expect(off.status).toBe(200);
    const offView = (await off.json()) as { data: { mode: string; secretSet: boolean } };
    expect(offView.data.mode).toBe("off");
    expect(offView.data.secretSet).toBe(true); // 凭据保留,先填后开
    expect(await prisma.payGatewayConfig.findFirst({ where: { enabled: true } })).toBeNull();
    const kept = await prisma.payGatewayConfig.findUnique({ where: { gateway: "xunhu" } });
    expect(kept?.appSecret).toBe(SECRET_A);

    // off 态更新凭据字段(照常入库)+ http apiBase 被拒
    expect((await call("PUT", { mode: "off", apiBase: "http://api.dpweixin.com" })).status).toBe(
      400,
    );
    expect(
      (
        await call("PUT", {
          mode: "off",
          appId: "1234567890",
          apiBase: "https://api.dpweixin.com",
          orderTtlMin: 60,
        })
      ).status,
    ).toBe(200);
    expect(
      (await prisma.payGatewayConfig.findUnique({ where: { gateway: "xunhu" } }))?.orderTtlMin,
    ).toBe(60);
  });

  it("xunhu→mock→xunhu:mock 行启用且凭据列清空;切回 xunhu 不重输 secret 仍生效", async () => {
    const toMock = await call("PUT", { mode: "mock", orderTtlMin: 20 });
    expect(toMock.status).toBe(200);
    const mockView = (await toMock.json()) as { data: { mode: string } };
    expect(mockView.data.mode).toBe("mock");
    const mockRow = await prisma.payGatewayConfig.findUnique({ where: { gateway: "mock" } });
    expect(mockRow?.enabled).toBe(true);
    expect(mockRow?.appSecret).toBe(""); // mock 零凭据语义
    expect(mockRow?.orderTtlMin).toBe(20);
    const xunhuOff = await prisma.payGatewayConfig.findUnique({ where: { gateway: "xunhu" } });
    expect(xunhuOff?.enabled).toBe(false);
    expect(xunhuOff?.appSecret).toBe(SECRET_A); // 切走不动凭据

    const back = await call("PUT", {
      mode: "xunhu",
      appId: "1234567890",
      apiBase: "https://api.dpweixin.com",
      // secret 不传 = 保留原值(切回无需重输)
    });
    expect(back.status).toBe(200);
    expect(((await back.json()) as { data: { mode: string } }).data.mode).toBe("xunhu");
    expect(
      (await prisma.payGatewayConfig.findUnique({ where: { gateway: "xunhu" } }))?.appSecret,
    ).toBe(SECRET_A);
    expect(
      await prisma.payGatewayConfig.findFirst({ where: { enabled: true, gateway: "mock" } }),
    ).toBeNull();
  });
});

describe("运行时配置(enabled 行门控 + updatedAt 缓存换新)", () => {
  it("off → null;mode=xunhu 后取到含 secret 的运行时配置与全量链路字段", async () => {
    await call("PUT", { mode: "off" });
    expect(await getPayGatewayRuntimeConfig("xunhu")).toBeNull();

    await call("PUT", {
      mode: "xunhu",
      appId: "1234567890",
      appSecret: SECRET_B, // 换密钥(整串重输语义)
      apiBase: "https://api.dpweixin.com",
    });
    const cfg = await getPayGatewayRuntimeConfig("xunhu");
    expect(cfg).toMatchObject({
      appId: "1234567890",
      appSecret: SECRET_B,
      apiBase: "https://api.dpweixin.com",
    });
    expect(cfg?.apiBaseBackup).toBeUndefined(); // 空串归一为 undefined
    expect(cfg?.notifyUrl).toBe(""); // PUT 全量替换语义:未传字段回落 schema 缺省
    expect(cfg?.returnUrl).toBe("");
    expect(cfg?.orderTtlMin).toBe(30);
    expect(cfg?.wapUrl).toBeTruthy();
  });
});
