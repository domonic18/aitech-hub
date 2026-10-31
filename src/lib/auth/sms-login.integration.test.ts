/**
 * 手机号验证码登录集成测试(M65;standard/01-testing:*.integration.test.ts 同层,
 * `npm run test:integration`,不进 test:unit/CI——依赖 dev compose 的 PG/Redis)。
 *
 * 覆盖安全红线:admin 禁短信登录(登录端点 403 + 下发端点静默不发)、
 * 合规同意必填、自动建号(昵称/角色/幂等)、错码计数与 15 分钟锁定、
 * 下发冷却。服务商通道整体替身(不打真实短信),验证码口径由 checkVerifyCode 决定。
 *
 * 前置:docker compose up -d postgres redis && npx prisma migrate deploy;测试自清理数据。
 */
import { loadEnvConfig } from "@next/env";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

loadEnvConfig(process.cwd());
process.env.LOG_LEVEL = "silent";

const channel = vi.hoisted(() => ({ sendVerifyCode: vi.fn(), checkVerifyCode: vi.fn() }));
vi.mock("@/lib/sms/config", () => ({
  getActiveSmsChannel: async () => ({
    provider: channel,
    signName: "恒创联众",
    templateCode: "100001",
    dailyLimit: 200,
  }),
}));

import { prisma } from "@/lib/db";
import { redis } from "@/lib/redis";

const { POST: smsLoginPOST } = await import("@/app/api/auth/sms-login/route");
const { POST: smsCodePOST } = await import("@/app/api/auth/sms-code/route");

const ADMIN_PHONE = "13900007101";
const NEW_PHONE = "13900007102";
const SEND_PHONE = "13900007103";
const ADMIN_SEND_PHONE = "13900007104";
const LOCK_PHONE = "13900007105";
const ALL_PHONES = [ADMIN_PHONE, NEW_PHONE, SEND_PHONE, ADMIN_SEND_PHONE, LOCK_PHONE];

const GOOD_CODE = "7658";
const ORIGIN_HEADERS: Record<string, string> = {
  "content-type": "application/json",
  origin: "http://localhost:3000",
  "x-forwarded-host": "localhost:3000",
};

async function callLogin(body: object): Promise<Response> {
  return smsLoginPOST(
    new Request("http://localhost:3000/api/auth/sms-login", {
      method: "POST",
      headers: ORIGIN_HEADERS,
      body: JSON.stringify(body),
    }) as never,
  );
}

async function callSend(body: object): Promise<Response> {
  return smsCodePOST(
    new Request("http://localhost:3000/api/auth/sms-code", {
      method: "POST",
      headers: ORIGIN_HEADERS,
      body: JSON.stringify(body),
    }) as never,
  );
}

function budgetKey(): string {
  const shifted = new Date(Date.now() + 8 * 3600 * 1000);
  return `sms:send:global:d:${shifted.toISOString().slice(0, 10)}`;
}

async function cleanRedis(): Promise<void> {
  const keys = await Promise.all(
    ALL_PHONES.flatMap((p) => [
      redis.del(`sms:send:phone:cd:${p}`),
      redis.del(`sms:send:phone:h:${p}`),
      redis.del(`sms:send:phone:d:${p}`),
      redis.del(`sms:verify:fail:${p}`),
    ]),
  );
  void keys;
}

beforeAll(async () => {
  await prisma.userAccount.deleteMany({ where: { phone: { in: ALL_PHONES } } });
  await prisma.userAccount.create({
    data: { phone: ADMIN_PHONE, nickname: "it-sms-admin", role: "admin", status: "active" },
  });
  await cleanRedis();
});

beforeEach(() => {
  channel.sendVerifyCode.mockReset();
  channel.sendVerifyCode.mockResolvedValue({ ok: true, bizId: "biz-1", requestId: "req-1" });
  channel.checkVerifyCode.mockReset();
  channel.checkVerifyCode.mockImplementation(async ({ code }: { code: string }) =>
    code === GOOD_CODE
      ? { ok: true }
      : { ok: false, reason: "mismatch", code: "OK", message: "验证码不正确或已过期" },
  );
});

afterAll(async () => {
  await prisma.userAccount.deleteMany({ where: { phone: { in: ALL_PHONES } } });
  await cleanRedis();
  await redis.del(budgetKey());
  await prisma.$disconnect();
});

describe("合规:必须显式同意", () => {
  it("缺 agreed → 400 且不触达服务商", async () => {
    const res = await callLogin({ phone: NEW_PHONE, code: GOOD_CODE });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { message: string }).message).toContain("用户协议与隐私政策");
    expect(channel.checkVerifyCode).not.toHaveBeenCalled();
  });
});

describe("admin 禁短信登录", () => {
  it("登录端点:验证码通过仍 403,不发会话", async () => {
    const res = await callLogin({ phone: ADMIN_PHONE, code: GOOD_CODE, agreed: true });
    expect(res.status).toBe(403);
    expect(((await res.json()) as { message: string }).message).toContain("不支持短信登录");
    expect(res.headers.get("set-cookie")).toBeNull();
  });

  it("下发端点:恒定成功应答但不调用服务商(不花钱、不泄漏角色)", async () => {
    const res = await callSend({ phone: ADMIN_PHONE });
    expect(res.status).toBe(200);
    expect(((await res.json()) as { message: string }).message).toBe("验证码已发送,5 分钟内有效");
    expect(channel.sendVerifyCode).not.toHaveBeenCalled();
  });
});

describe("登录 / 注册合一", () => {
  it("新号码 → 自动建号(role=user,昵称用户+尾号4),下发会话 Cookie", async () => {
    const res = await callLogin({ phone: NEW_PHONE, code: GOOD_CODE, agreed: true });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { role: string; nickname: string; isNew: boolean } };
    expect(body.data).toMatchObject({ role: "user", nickname: "用户7102", isNew: true });
    expect(res.headers.get("set-cookie") ?? "").toContain("ah_at=");

    const user = await prisma.userAccount.findUnique({ where: { phone: NEW_PHONE } });
    expect(user?.username).toBeNull();
    expect(user?.role).toBe("user");
    expect(user?.status).toBe("active");
  });

  it("同号再登 → 幂等登录,不重复建号", async () => {
    const res = await callLogin({ phone: NEW_PHONE, code: GOOD_CODE, agreed: true });
    expect(res.status).toBe(200);
    expect(((await res.json()) as { data: { isNew: boolean } }).data.isNew).toBe(false);
    expect(await prisma.userAccount.count({ where: { phone: NEW_PHONE } })).toBe(1);
  });
});

describe("错码与锁定", () => {
  it("错码 → 400;连错 5 次后锁定 429(正确码也进不来)", async () => {
    for (let i = 0; i < 5; i++) {
      const res = await callLogin({ phone: LOCK_PHONE, code: "0000", agreed: true });
      expect(res.status).toBe(400);
      expect(((await res.json()) as { message: string }).message).toBe("验证码不正确或已过期");
    }
    const locked = await callLogin({ phone: LOCK_PHONE, code: GOOD_CODE, agreed: true });
    expect(locked.status).toBe(429);
    expect(((await locked.json()) as { message: string }).message).toContain("15 分钟");
  });
});

describe("下发频控", () => {
  it("首次下发成功并记账;60 秒内置冷却 → 429 且不再调用服务商", async () => {
    const first = await callSend({ phone: SEND_PHONE });
    expect(first.status).toBe(200);
    expect(channel.sendVerifyCode).toHaveBeenCalledTimes(1);
    expect(channel.sendVerifyCode.mock.calls[0][0]).toMatchObject({
      phone: SEND_PHONE,
      signName: "恒创联众",
      templateCode: "100001",
    });
    expect(await redis.get(`sms:send:phone:cd:${SEND_PHONE}`)).toBe("1");

    const second = await callSend({ phone: SEND_PHONE });
    expect(second.status).toBe(429);
    expect(channel.sendVerifyCode).toHaveBeenCalledTimes(1);
  });

  it("服务商失败 → 归还预算占位(不多记账)", async () => {
    await redis.del(`sms:send:phone:cd:${ADMIN_SEND_PHONE}`);
    channel.sendVerifyCode.mockResolvedValue({
      ok: false,
      reason: "provider_error",
      code: "isv.SMS_SERVICE_ERROR",
      message: "服务异常",
    });
    const before = Number((await redis.get(budgetKey())) ?? 0);
    const res = await callSend({ phone: ADMIN_SEND_PHONE });
    expect(res.status).toBe(503);
    expect(Number((await redis.get(budgetKey())) ?? 0)).toBe(before);
  });
});
