/**
 * 邮箱令牌纯函数单测(签发/消费含 DB,由集成测试覆盖闭环)。
 */
import { createHash } from "node:crypto";

import { describe, expect, it, vi } from "vitest";

// email-verify.ts 经 prisma 传递 import env(导入期校验);CI 无 .env,按仓库惯例 mock 掉
vi.mock("@/lib/env", () => ({
  env: { AUTH_SECRET: "test-secret-0123456789-abcdef" },
}));

import { EMAIL_TOKEN_TTL_MINUTES, TOKEN_PURPOSES, hashEmailToken } from "./email-verify";

describe("hashEmailToken(M21 批⓪,与 user_verification_token.token_hash char(64) 对齐)", () => {
  it("与 node:crypto sha256 hex 直接对齐且确定", () => {
    const token = "a".repeat(64);
    expect(hashEmailToken(token)).toBe(createHash("sha256").update(token, "utf8").digest("hex"));
    expect(hashEmailToken(token)).toBe(hashEmailToken(token));
  });

  it("输出 64 位 hex;不同输入不碰撞", () => {
    expect(hashEmailToken("x")).toMatch(/^[0-9a-f]{64}$/);
    expect(hashEmailToken("a")).not.toBe(hashEmailToken("b"));
  });
});

describe("常量契约", () => {
  it("TTL 30 分钟(D1 决议:验证链接 30 分钟内有效)", () => {
    expect(EMAIL_TOKEN_TTL_MINUTES).toBe(30);
  });

  it("purpose 枚举三态(注册认证/绑定/找回)", () => {
    expect(TOKEN_PURPOSES).toEqual(["register_verify", "bind_email", "password_reset"]);
  });
});
