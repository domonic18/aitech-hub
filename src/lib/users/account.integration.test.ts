/**
 * 账号中心 API 集成测试(M22 批②;依赖 dev compose PG/Redis,不进
 * make check/CI)。覆盖:session 扩返回契约(批④ FAB 消费面)、profile
 * PATCH 门禁(未登录/跨域/边界)与落库、password 旧验/弱拒/成功、avatar
 * 类型与大小门禁 + avatarPath 落库。前置:dev compose;测试自清理。
 */
import { loadEnvConfig } from "@next/env";
import { NextRequest } from "next/server";
import bcrypt from "bcryptjs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

loadEnvConfig(process.cwd());
process.env.LOG_LEVEL = "silent";

import { prisma } from "@/lib/db";

const { GET: sessionGET } = await import("@/app/api/auth/session/route");
const { PATCH: profilePATCH } = await import("@/app/api/account/profile/route");
const { POST: passwordPOST } = await import("@/app/api/account/password/route");
const { POST: avatarPOST } = await import("@/app/api/account/avatar/route");
const { POST: loginPOST } = await import("@/app/api/auth/login/route");

const USER_PHONE = "13900000019";
const PASSWORD = "it-acct-pass1";
const NEW_PASSWORD = "it-acct-pass2";

const HEADERS: Record<string, string> = {
  "content-type": "application/json",
  origin: "http://localhost:3000",
  "x-forwarded-host": "localhost:3000",
};

const cookies = new Map<string, string>();

let userId = BigInt(0);

beforeAll(async () => {
  const passwordHash = await bcrypt.hash(PASSWORD, 10);
  const user = await prisma.userAccount.upsert({
    where: { phone: USER_PHONE },
    update: { role: "user", status: "active", passwordHash },
    create: {
      phone: USER_PHONE,
      nickname: "it-acct-user",
      role: "user",
      status: "active",
      passwordHash,
    },
  });
  userId = user.id;
  const res = await loginPOST(
    new NextRequest("http://localhost:3000/api/auth/login", {
      method: "POST",
      headers: HEADERS,
      body: JSON.stringify({ account: USER_PHONE, password: PASSWORD }),
    }) as never,
  );
  expect(res.status).toBe(200);
  for (const part of (res.headers.get("set-cookie") ?? "").split(";")) {
    const [k, v] = part.trim().split("=");
    if (k && v && k.startsWith("ah_")) cookies.set(k, v);
  }
});

afterAll(async () => {
  await prisma.userAccount.delete({ where: { id: userId } }).catch(() => undefined);
  await prisma.$disconnect();
});

const COOKIE = () => [...cookies.entries()].map(([k, v]) => `${k}=${v}`).join("; ");

describe("GET /api/auth/session(M22 扩返回契约)", () => {
  it("已登录返回 nickname/avatarPath/assistantVisible 三字段", async () => {
    const res = await sessionGET(
      new NextRequest("http://localhost:3000/api/auth/session", {
        headers: { cookie: COOKIE() },
      }) as never,
    );
    const body = (await res.json()) as {
      data: { user: Record<string, unknown> | null };
    };
    expect(body.data.user).toMatchObject({
      role: "user",
      nickname: "it-acct-user",
      assistantVisible: true,
    });
    expect("avatarPath" in (body.data.user ?? {})).toBe(true);
  });
});

describe("PATCH /api/account/profile", () => {
  it("未登录 401 / 跨域 403", async () => {
    const r1 = await profilePATCH(
      new NextRequest("http://localhost:3000/api/account/profile", {
        method: "PATCH",
        headers: HEADERS,
        body: JSON.stringify({ nickname: "新昵称", bio: "" }),
      }) as never,
    );
    expect(r1.status).toBe(401);
    const r2 = await profilePATCH(
      new NextRequest("http://localhost:3000/api/account/profile", {
        method: "PATCH",
        headers: { ...HEADERS, origin: "https://evil.example.com", cookie: COOKIE() },
        body: JSON.stringify({ nickname: "新昵称", bio: "" }),
      }) as never,
    );
    expect(r2.status).toBe(403);
  });

  it("昵称过短 400;合法更新落库", async () => {
    const bad = await profilePATCH(
      new NextRequest("http://localhost:3000/api/account/profile", {
        method: "PATCH",
        headers: { ...HEADERS, cookie: COOKIE() },
        body: JSON.stringify({ nickname: "短", bio: "" }),
      }) as never,
    );
    expect(bad.status).toBe(400);

    const ok = await profilePATCH(
      new NextRequest("http://localhost:3000/api/account/profile", {
        method: "PATCH",
        headers: { ...HEADERS, cookie: COOKIE() },
        body: JSON.stringify({ nickname: "改过的昵称", bio: "自我介绍" }),
      }) as never,
    );
    expect(ok.status).toBe(200);
    const row = await prisma.userAccount.findUnique({ where: { id: userId } });
    expect(row?.nickname).toBe("改过的昵称");
    expect(row?.bio).toBe("自我介绍");
  });
});

describe("POST /api/account/password", () => {
  it("旧密码错误 400", async () => {
    const res = await passwordPOST(
      new NextRequest("http://localhost:3000/api/account/password", {
        method: "POST",
        headers: { ...HEADERS, cookie: COOKIE() },
        body: JSON.stringify({ oldPassword: "wrong-old-pass", newPassword: NEW_PASSWORD }),
      }) as never,
    );
    expect(res.status).toBe(400);
  });

  it("新密码过短 400(validatePassword 边界)", async () => {
    const res = await passwordPOST(
      new NextRequest("http://localhost:3000/api/account/password", {
        method: "POST",
        headers: { ...HEADERS, cookie: COOKIE() },
        body: JSON.stringify({ oldPassword: PASSWORD, newPassword: "short" }),
      }) as never,
    );
    expect(res.status).toBe(400);
  });

  it("合法修改成功:hash 更新且新密码可登录", async () => {
    const res = await passwordPOST(
      new NextRequest("http://localhost:3000/api/account/password", {
        method: "POST",
        headers: { ...HEADERS, cookie: COOKIE() },
        body: JSON.stringify({ oldPassword: PASSWORD, newPassword: NEW_PASSWORD }),
      }) as never,
    );
    expect(res.status).toBe(200);
    const row = await prisma.userAccount.findUnique({ where: { id: userId } });
    expect(row?.passwordHash && bcrypt.compareSync(NEW_PASSWORD, row.passwordHash)).toBe(true);
    // 还原旧密码,免影响后续用例/重复跑
    await prisma.userAccount.update({
      where: { id: userId },
      data: { passwordHash: await bcrypt.hash(PASSWORD, 10) },
    });
  });
});

describe("POST /api/account/avatar", () => {
  // multipart 头:fetch 由 FormData body 自动补 content-type(带边界),禁手动带 json content-type
  const FORM_HEADERS = (extra: Record<string, string> = {}) => ({
    origin: "http://localhost:3000",
    "x-forwarded-host": "localhost:3000",
    ...extra,
  });

  it("未登录 401", async () => {
    const form = new FormData();
    form.append("file", new Blob([new Uint8Array(16)], { type: "image/png" }), "a.png");
    const res = await avatarPOST(
      new NextRequest("http://localhost:3000/api/account/avatar", {
        method: "POST",
        headers: FORM_HEADERS(),
        body: form,
      }) as never,
    );
    expect(res.status).toBe(401);
  });

  it("类型不在白名单 415;超 2MB 413", async () => {
    const formGif = new FormData();
    formGif.append("file", new Blob([new Uint8Array(16)], { type: "image/gif" }), "a.gif");
    const r1 = await avatarPOST(
      new NextRequest("http://localhost:3000/api/account/avatar", {
        method: "POST",
        headers: FORM_HEADERS({ cookie: COOKIE() }),
        body: formGif,
      }) as never,
    );
    expect(r1.status).toBe(415);

    const formBig = new FormData();
    formBig.append(
      "file",
      new Blob([new Uint8Array(2 * 1024 * 1024 + 1)], { type: "image/png" }),
      "big.png",
    );
    const r2 = await avatarPOST(
      new NextRequest("http://localhost:3000/api/account/avatar", {
        method: "POST",
        headers: FORM_HEADERS({ cookie: COOKIE() }),
        body: formBig,
      }) as never,
    );
    expect(r2.status).toBe(413);
  });

  it("合法上传:avatarPath 落库为站内 uploads 路径", async () => {
    const form = new FormData();
    form.append("file", new Blob([new Uint8Array(64)], { type: "image/png" }), "me.png");
    const res = await avatarPOST(
      new NextRequest("http://localhost:3000/api/account/avatar", {
        method: "POST",
        headers: FORM_HEADERS({ cookie: COOKIE() }),
        body: form,
      }) as never,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { avatarPath: string } };
    expect(body.data.avatarPath).toMatch(/^\/wp-content\/uploads\//);
    const row = await prisma.userAccount.findUnique({ where: { id: userId } });
    expect(row?.avatarPath).toBe(body.data.avatarPath);
  });
});
