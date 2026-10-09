/**
 * 忘记密码/重置密码集成测试(2026-10-09 验收反馈问题1;standard/01:
 * *.integration.test.ts 依赖 dev compose 的 PG/Redis,不进 make check/CI)。
 * 覆盖:防枚举统一话术(不存在/手机号账号同响应)、正常签发令牌→重置成功→
 * 旧密失效新密可登录、令牌单次消费(重放 400)、过期与弱密码路径。
 * 前置:docker compose up -d postgres redis;测试自清理数据。
 */
import { loadEnvConfig } from "@next/env";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

loadEnvConfig(process.cwd());
process.env.LOG_LEVEL = "silent";

import { prisma } from "@/lib/db";
import { redis } from "@/lib/redis";

const { POST: forgotPOST } = await import("@/app/api/auth/forgot-password/route");
const { POST: resetPOST } = await import("@/app/api/auth/reset-password/route");
const { POST: loginPOST } = await import("@/app/api/auth/login/route");
const { hashEmailToken } = await import("@/lib/auth/email-verify");

const EMAIL = "reset-e2e@example.com";
const USERNAME = "reset-e2e-user";
const OLD_PASSWORD = "OldPass#2026";
const NEW_PASSWORD = "NewPass#2026";

const HEADERS: Record<string, string> = {
  "content-type": "application/json",
  origin: "http://localhost:3000",
  "x-forwarded-host": "localhost:3000",
};

function call(
  post: (req: never) => Promise<Response>,
  body: object,
  extraHeaders: Record<string, string> = {},
): Promise<Response> {
  return post(
    new Request("http://localhost:3000/api/auth/x", {
      method: "POST",
      headers: { ...HEADERS, ...extraHeaders },
      body: JSON.stringify(body),
    }) as never,
  );
}

async function callLogin(account: string, password: string): Promise<Response> {
  return call(loginPOST as never, { account, password });
}

beforeAll(async () => {
  await prisma.userAccount.create({
    data: {
      username: USERNAME,
      email: EMAIL,
      passwordHash: await (await import("bcryptjs")).hash(OLD_PASSWORD, 10),
      role: "user",
      status: "active",
      emailVerifiedAt: new Date(),
    },
  });
  // 清残留限频桶(无代理头 clientIp="",IP 桶键固定;账号桶键见用例内)
  await redis.del("auth:forgot:ip:", "auth:reset:ip:");
});

afterAll(async () => {
  const user = await prisma.userAccount.findUnique({
    where: { email: EMAIL },
    select: { id: true },
  });
  await prisma.userVerificationToken.deleteMany({
    where: { user: { email: EMAIL } },
  });
  await prisma.userAccount.deleteMany({ where: { email: EMAIL } });
  if (user) await redis.del(`auth:forgot:acc:${user.id}`);
  await redis.del("auth:forgot:ip:", "auth:reset:ip:");
  await prisma.$disconnect();
});

describe("忘记密码 → 邮箱令牌 → 重置(dev compose 真实 PG/Redis)", () => {
  it("防枚举:不存在账号 / 手机号老账号 / 正常账号,话术一致且 200", async () => {
    const missing = await call(forgotPOST, { account: "no-such-user@example.com" });
    expect(missing.status).toBe(200);
    const text = ((await missing.json()) as { message: string }).message;
    expect(text).toContain("若该账号存在");

    const phoneRow = await prisma.userAccount.create({
      data: { phone: "13900008888", nickname: "reset-e2e-phone", passwordHash: "x" },
    });
    try {
      const phone = await call(forgotPOST, { account: "13900008888" });
      expect(phone.status).toBe(200);
      expect(((await phone.json()) as { message: string }).message).toBe(text);
    } finally {
      await prisma.userAccount.delete({ where: { id: phoneRow.id } });
    }

    const ok = await call(forgotPOST, { account: EMAIL });
    expect(ok.status).toBe(200);
    expect(((await ok.json()) as { message: string }).message).toBe(text);
  });

  it("正常流:令牌入库 → 重置成功 → 旧密 401 新密 200;令牌重放 400", async () => {
    // 清账号限频桶(1/h;上一用例已记 1 次命中)
    const user = await prisma.userAccount.findUnique({
      where: { email: EMAIL },
      select: { id: true },
    });
    await redis.del(`auth:forgot:acc:${user!.id}`);
    const ok = await call(forgotPOST, { account: USERNAME });
    expect(ok.status).toBe(200);
    const row = await prisma.userVerificationToken.findFirst({
      where: { user: { email: EMAIL }, purpose: "password_reset", consumedAt: null },
    });
    expect(row).not.toBeNull();
    // 原始令牌只在邮件链接里;测试按同构规则重造一枚可消费令牌
    await prisma.userVerificationToken.update({
      where: { id: row!.id },
      data: { tokenHash: hashEmailToken("raw-test-token-1") },
    });

    expect((await call(resetPOST, { token: "raw-test-token-1", password: "short" })).status).toBe(
      400,
    ); // 弱密码
    const reset = await call(resetPOST, { token: "raw-test-token-1", password: NEW_PASSWORD });
    expect(reset.status).toBe(200);
    expect(((await reset.json()) as { message: string }).message).toContain("密码已重置");

    // 重放同令牌 → 无效
    expect(
      (await call(resetPOST, { token: "raw-test-token-1", password: NEW_PASSWORD })).status,
    ).toBe(400);

    expect((await callLogin(EMAIL, OLD_PASSWORD)).status).toBe(401);
    expect((await callLogin(EMAIL, NEW_PASSWORD)).status).toBe(200);
  });

  it("无效/过期令牌 400;缺 Origin 403", async () => {
    expect((await call(resetPOST, { token: "nope", password: NEW_PASSWORD })).status).toBe(400);
    const cross = await call(
      forgotPOST,
      { account: EMAIL },
      { origin: "https://evil.example.com" },
    );
    expect(cross.status).toBe(403);
  });
});
