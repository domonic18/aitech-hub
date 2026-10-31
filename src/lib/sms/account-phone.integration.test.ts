/**
 * 账号中心手机号绑定/换绑集成测试(M65 P1;standard/01-testing:*.integration.test.ts
 * 同层,`npm run test:integration`,不进 test:unit/CI——依赖 dev compose 的 PG/Redis)。
 *
 * 覆盖红线:未登录拒绝、admin 禁绑、两步换绑不可跳步(第一步标记)、第一步目标号
 * 由服务端取(客户端传号无效)、新号占用落库时拒绝、同号拒绝、错码不改库。
 * 服务商通道整体替身,模板编码由场景决定(100004 绑新号 / 100005 验当前号 /
 * 100002 改绑)。
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

import { ACCESS_COOKIE_NAME } from "@/lib/auth/session";
import { issueSession, revokeSession } from "@/lib/auth/issuer";
import { prisma } from "@/lib/db";
import { redis } from "@/lib/redis";

const { POST: phoneCodePOST } = await import("@/app/api/account/phone/code/route");
const { POST: phoneVerifyPOST } = await import("@/app/api/account/phone/verify/route");

const PHONE_CUR = "13900007202";
const PHONE_NEW = "13900007203";
const PHONE_TAKEN = "13900007204";
const PHONE_ADMIN = "13900007205";
const PHONE_SKIP = "13900007206";
const PHONE_BIND = "13900007201";
const PHONE_WRONG = "13900007207";
const ALL_PHONES = [
  PHONE_CUR,
  PHONE_NEW,
  PHONE_TAKEN,
  PHONE_ADMIN,
  PHONE_SKIP,
  PHONE_BIND,
  PHONE_WRONG,
];
const USERNAMES = [
  "it-phone-bind",
  "it-phone-rebind",
  "it-phone-taken",
  "it-phone-skip",
  "it-phone-wrong",
];

const GOOD_CODE = "7658";
const ORIGIN_HEADERS: Record<string, string> = {
  "content-type": "application/json",
  origin: "http://localhost:3000",
  "x-forwarded-host": "localhost:3000",
};

const issuedJtis: string[] = [];

function url(path: string): string {
  return `http://localhost:3000${path}`;
}

async function callCode(body: object, cookie?: string): Promise<Response> {
  return phoneCodePOST(
    new Request(url("/api/account/phone/code"), {
      method: "POST",
      headers: { ...ORIGIN_HEADERS, ...(cookie ? { cookie } : {}) },
      body: JSON.stringify(body),
    }) as never,
  );
}

async function callVerify(body: object, cookie?: string): Promise<Response> {
  return phoneVerifyPOST(
    new Request(url("/api/account/phone/verify"), {
      method: "POST",
      headers: { ...ORIGIN_HEADERS, ...(cookie ? { cookie } : {}) },
      body: JSON.stringify(body),
    }) as never,
  );
}

async function loginAs(userId: bigint, role = "user"): Promise<string> {
  const { token, jti } = await issueSession({ sub: userId.toString(), role });
  issuedJtis.push(jti);
  return `${ACCESS_COOKIE_NAME}=${token}`;
}

async function cleanRedis(userIds: bigint[] = []): Promise<void> {
  for (const p of ALL_PHONES) {
    await redis.del(`sms:send:phone:cd:${p}`);
    await redis.del(`sms:send:phone:h:${p}`);
    await redis.del(`sms:send:phone:d:${p}`);
    await redis.del(`sms:verify:fail:${p}`);
  }
  for (const id of userIds) await redis.del(`sms:phone:rebind:${id.toString()}`);
}

let bindUserId: bigint;
let rebindUserId: bigint;
let takenUserId: bigint;
let skipUserId: bigint;
let wrongUserId: bigint;
let adminUserId: bigint;

beforeAll(async () => {
  await prisma.userAccount.deleteMany({
    where: { OR: [{ phone: { in: ALL_PHONES } }, { username: { in: USERNAMES } }] },
  });
  bindUserId = (await prisma.userAccount.create({ data: { username: USERNAMES[0]! } })).id;
  rebindUserId = (
    await prisma.userAccount.create({ data: { username: USERNAMES[1]!, phone: PHONE_CUR } })
  ).id;
  takenUserId = (
    await prisma.userAccount.create({ data: { username: USERNAMES[2]!, phone: PHONE_TAKEN } })
  ).id;
  skipUserId = (
    await prisma.userAccount.create({ data: { username: USERNAMES[3]!, phone: PHONE_SKIP } })
  ).id;
  wrongUserId = (await prisma.userAccount.create({ data: { username: USERNAMES[4]! } })).id;
  adminUserId = (await prisma.userAccount.create({ data: { phone: PHONE_ADMIN, role: "admin" } }))
    .id;
  await cleanRedis([bindUserId, rebindUserId, takenUserId, skipUserId, wrongUserId, adminUserId]);
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
  await prisma.userAccount.deleteMany({
    where: { OR: [{ phone: { in: ALL_PHONES } }, { username: { in: USERNAMES } }] },
  });
  await cleanRedis([bindUserId, rebindUserId, takenUserId, skipUserId, wrongUserId, adminUserId]);
  for (const jti of issuedJtis) await revokeSession(jti);
  await redis.del(
    `sms:send:global:d:${new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10)}`,
  );
  await prisma.$disconnect();
});

describe("守卫与场景校验", () => {
  it("未登录 → 401,不触达服务商", async () => {
    const res = await callCode({ scene: "bind", phone: PHONE_BIND });
    expect(res.status).toBe(401);
    expect(channel.sendVerifyCode).not.toHaveBeenCalled();
  });

  it("admin 账号 → 403 且不发码", async () => {
    const cookie = await loginAs(adminUserId, "admin");
    const res = await callCode({ scene: "bind", phone: PHONE_BIND }, cookie);
    expect(res.status).toBe(403);
    expect(((await res.json()) as { message: string }).message).toContain("管理员账号");
    expect(channel.sendVerifyCode).not.toHaveBeenCalled();
  });

  it("已绑定用户走 bind 场景 → 400 提示改用换绑", async () => {
    const cookie = await loginAs(rebindUserId);
    const res = await callCode({ scene: "bind", phone: PHONE_NEW }, cookie);
    expect(res.status).toBe(400);
    expect(((await res.json()) as { message: string }).message).toContain("更换手机号");
  });

  it("未绑定用户走 rebind_old → 400 提示改用绑定", async () => {
    const cookie = await loginAs(bindUserId);
    const res = await callCode({ scene: "rebind_old" }, cookie);
    expect(res.status).toBe(400);
    expect(((await res.json()) as { message: string }).message).toContain("绑定手机号");
  });

  it("新号与当前号相同 → 400,不发码", async () => {
    const cookie = await loginAs(rebindUserId);
    const res = await callCode({ scene: "rebind_new", phone: PHONE_CUR }, cookie);
    // 未过第一步,先撞 flow_required;置标记后再验同号分支
    expect(res.status).toBe(409);
    await redis.set(`sms:phone:rebind:${rebindUserId.toString()}`, "1", "EX", 60);
    const same = await callCode({ scene: "rebind_new", phone: PHONE_CUR }, cookie);
    expect(same.status).toBe(400);
    expect(((await same.json()) as { message: string }).message).toContain("相同");
    await redis.del(`sms:phone:rebind:${rebindUserId.toString()}`);
  });
});

describe("绑定:未绑定账号直达新号", () => {
  it("发码走 100004 发往新号;验码后落库", async () => {
    const cookie = await loginAs(bindUserId);
    const send = await callCode({ scene: "bind", phone: PHONE_BIND }, cookie);
    expect(send.status).toBe(200);
    expect(channel.sendVerifyCode.mock.calls[0][0]).toMatchObject({
      phone: PHONE_BIND,
      templateCode: "100004",
    });

    const verify = await callVerify({ scene: "bind", phone: PHONE_BIND, code: GOOD_CODE }, cookie);
    expect(verify.status).toBe(200);
    expect(((await verify.json()) as { data: { phone: string } }).data.phone).toBe("139****7201");

    const user = await prisma.userAccount.findUnique({ where: { id: bindUserId } });
    expect(user?.phone).toBe(PHONE_BIND);
  });

  it("错码 → 400 且不改库", async () => {
    const cookie = await loginAs(wrongUserId);
    const res = await callVerify({ scene: "bind", phone: PHONE_WRONG, code: "0000" }, cookie);
    expect(res.status).toBe(400);
    expect(((await res.json()) as { message: string }).message).toBe("验证码不正确或已过期");
    const user = await prisma.userAccount.findUnique({ where: { id: wrongUserId } });
    expect(user?.phone).toBeNull();
  });
});

describe("换绑:两步不可跳", () => {
  it("第一步发往服务端记录的当前号(客户端传号无效),模板 100005", async () => {
    const cookie = await loginAs(rebindUserId);
    const res = await callCode({ scene: "rebind_old", phone: PHONE_NEW }, cookie);
    expect(res.status).toBe(200);
    expect(channel.sendVerifyCode.mock.calls[0][0]).toMatchObject({
      phone: PHONE_CUR,
      templateCode: "100005",
    });
  });

  it("跳过第一步直接 rebind_new → 409;完整两步后落库并消费标记", async () => {
    const cookie = await loginAs(rebindUserId);

    const jumped = await callCode({ scene: "rebind_new", phone: PHONE_NEW }, cookie);
    expect(jumped.status).toBe(409);
    expect(((await jumped.json()) as { message: string }).message).toContain("当前绑定的手机号");
    expect(channel.sendVerifyCode).not.toHaveBeenCalled();

    const step1 = await callVerify({ scene: "rebind_old", code: GOOD_CODE }, cookie);
    expect(step1.status).toBe(200);
    expect(((await step1.json()) as { data: { step: string } }).data.step).toBe("rebind_new");
    expect(channel.checkVerifyCode.mock.calls[0][0]).toMatchObject({ phone: PHONE_CUR });

    await redis.del(`sms:send:phone:cd:${PHONE_NEW}`);
    const step2Send = await callCode({ scene: "rebind_new", phone: PHONE_NEW }, cookie);
    expect(step2Send.status).toBe(200);
    expect(channel.sendVerifyCode.mock.calls.at(-1)?.[0]).toMatchObject({
      phone: PHONE_NEW,
      templateCode: "100002",
    });

    const step2 = await callVerify(
      { scene: "rebind_new", phone: PHONE_NEW, code: GOOD_CODE },
      cookie,
    );
    expect(step2.status).toBe(200);
    const user = await prisma.userAccount.findUnique({ where: { id: rebindUserId } });
    expect(user?.phone).toBe(PHONE_NEW);
    expect(await redis.get(`sms:phone:rebind:${rebindUserId.toString()}`)).toBeNull();
  });
});

describe("新号占用", () => {
  it("落库时发现已被他人绑定 → 409,原号码不变", async () => {
    const cookie = await loginAs(skipUserId);
    await redis.set(`sms:phone:rebind:${skipUserId.toString()}`, "1", "EX", 60);
    const res = await callVerify(
      { scene: "rebind_new", phone: PHONE_TAKEN, code: GOOD_CODE },
      cookie,
    );
    expect(res.status).toBe(409);
    expect(((await res.json()) as { message: string }).message).toContain("已绑定其他账号");
    const user = await prisma.userAccount.findUnique({ where: { id: skipUserId } });
    expect(user?.phone).toBe(PHONE_SKIP);
    const owner = await prisma.userAccount.findUnique({ where: { id: takenUserId } });
    expect(owner?.phone).toBe(PHONE_TAKEN);
  });
});
