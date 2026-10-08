/**
 * SMTP 配置 API + 发送门控集成测试(M21 批⓪;standard/01:*.integration.test.ts
 * 依赖 dev compose 的 PG/Redis,不进 make check/CI)。覆盖:admin-only 鉴权
 * (未登录 401)、password 永不回传(视图只给 passwordSet)、留空保留原密码、
 * 首次配置必须给密码、Origin 校验、sendMail 的未配置/未启用跳过与启用后真实
 * 出网(127.0.0.1:1 快速 ECONNREFUSED,不打真实 SMTP)。测试自清理数据。
 */
import { loadEnvConfig } from "@next/env";
import bcrypt from "bcryptjs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

loadEnvConfig(process.cwd());
process.env.LOG_LEVEL = "silent";

import { prisma } from "@/lib/db";

const { GET: configGET, PUT: configPUT } = await import("@/app/api/email-config/route");
const { POST: loginPOST } = await import("@/app/api/auth/login/route");
const { sendMail } = await import("@/lib/email/mailer");

const PHONE = "13900000003";
const PASSWORD = "it-admin-pass1";
const ORIGIN = "http://localhost:3000";
const HEADERS: Record<string, string> = {
  "content-type": "application/json",
  origin: ORIGIN,
  "x-forwarded-host": "localhost:3000",
};

let cookie = "";

function call(
  method: "GET" | "PUT",
  body?: object,
  headers = HEADERS,
  withCookie = true,
): Promise<Response> {
  return (method === "GET" ? configGET : configPUT)(
    new Request(`${ORIGIN}/api/email-config`, {
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
      nickname: "it-email-admin",
      role: "admin",
      status: "active",
      passwordHash: await bcrypt.hash(PASSWORD, 10),
    },
  });
  await prisma.emailConfig.deleteMany();
  const login = await loginPOST(
    new Request(`${ORIGIN}/api/auth/login`, {
      method: "POST",
      headers: HEADERS,
      body: JSON.stringify({ account: PHONE, password: PASSWORD }),
    }) as never,
  );
  cookie = (login.headers.get("set-cookie") ?? "").split(";")[0];
});

afterAll(async () => {
  await prisma.emailConfig.deleteMany();
  await prisma.userAccount.deleteMany({ where: { phone: PHONE } });
  await prisma.$disconnect();
});

describe("SMTP 配置 API(admin-only,password 只写不读)", () => {
  it("未登录 GET/PUT 401;跨域 PUT 403", async () => {
    expect((await call("GET", undefined, HEADERS, false)).status).toBe(401);
    expect((await call("PUT", { host: "h" }, HEADERS, false)).status).toBe(401);
    const cross = await call(
      "PUT",
      { host: "h" },
      { ...HEADERS, origin: "https://evil.example.com" },
    );
    expect(cross.status).toBe(403);
  });

  it("首次配置缺密码 400;带密码创建 → passwordSet:true 且明文不出现在应答", async () => {
    const noPass = await call("PUT", {
      host: "smtp.example.com",
      port: 465,
      username: "noreply@example.com",
      fromAddr: "一起AI <noreply@example.com>",
      enabled: false,
    });
    expect(noPass.status).toBe(400);

    const created = await call("PUT", {
      host: "smtp.example.com",
      port: 465,
      username: "noreply@example.com",
      password: "smtp-secret-1",
      fromAddr: "一起AI <noreply@example.com>",
      enabled: false,
    });
    expect(created.status).toBe(200);
    const view = (await created.json()) as { data: Record<string, unknown> };
    expect(view.data).toMatchObject({ host: "smtp.example.com", port: 465, passwordSet: true });
    expect(JSON.stringify(view)).not.toContain("smtp-secret-1");

    const got = await call("GET");
    expect(((await got.json()) as { data: { passwordSet: boolean } }).data.passwordSet).toBe(true);
  });

  it("留空密码更新保留原值(字段仍可改);非法端口/发件人 400", async () => {
    const updated = await call("PUT", {
      host: "smtp2.example.com",
      port: 587,
      username: "noreply@example.com",
      fromAddr: "一起AI <noreply@example.com>",
      enabled: true,
    });
    expect(updated.status).toBe(200);
    const row = await prisma.emailConfig.findFirst();
    expect(row).toMatchObject({ host: "smtp2.example.com", port: 587, enabled: true });
    expect(row?.password).toBe("smtp-secret-1"); // 留空 = 保留

    expect(
      (
        await call("PUT", {
          host: "h",
          port: 70000,
          username: "u",
          fromAddr: "a@b.c",
          enabled: false,
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await call("PUT", {
          host: "h",
          port: 465,
          username: "u",
          fromAddr: "不含邮箱",
          enabled: false,
        })
      ).status,
    ).toBe(400);
  });
});

describe("sendMail 门控(不触真实 SMTP)", () => {
  it("无配置行 → skipped;enabled=false → skipped", async () => {
    await prisma.emailConfig.deleteMany();
    expect(await sendMail({ to: "a@b.c", subject: "s", text: "t" })).toEqual({ skipped: true });

    await prisma.emailConfig.create({
      data: {
        host: "smtp.example.com",
        port: 465,
        username: "u",
        password: "p",
        fromAddr: "noreply@example.com",
        enabled: false,
      },
    });
    expect(await sendMail({ to: "a@b.c", subject: "s", text: "t" })).toEqual({ skipped: true });
  });

  it("enabled=true 真实出网(127.0.0.1:1 → ECONNREFUSED,证明未跳过)", async () => {
    await prisma.emailConfig.deleteMany();
    await prisma.emailConfig.create({
      data: {
        host: "127.0.0.1",
        port: 1,
        username: "u",
        password: "p",
        fromAddr: "noreply@example.com",
        enabled: true,
      },
    });
    await expect(sendMail({ to: "a@b.c", subject: "s", text: "t" })).rejects.toThrow(
      /ECONNREFUSED|connect/i,
    );
  });
});
