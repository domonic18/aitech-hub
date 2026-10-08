/**
 * PAT 纯函数单测(签发/校验含 DB,由 e2e 用例 10 覆盖闭环)。
 */
import { createHash } from "node:crypto";

import { describe, expect, it, vi } from "vitest";

// pat.ts 经 logger 传递 import env(导入期校验);CI 无 .env,按仓库惯例 mock 掉
vi.mock("@/lib/env", () => ({
  env: { AUTH_SECRET: "test-secret-0123456789-abcdef" },
}));

import { hashToken, parseBearer, PAT_PREFIX } from "./pat";

describe("hashToken", () => {
  it("与 node:crypto sha256 hex 直接对齐且确定", () => {
    const token = `${PAT_PREFIX}abc123`;
    expect(hashToken(token)).toBe(createHash("sha256").update(token, "utf8").digest("hex"));
    expect(hashToken(token)).toBe(hashToken(token));
  });

  it("输出 64 位 hex(与 user_pat.token_hash char(64) 对齐)", () => {
    expect(hashToken("x")).toMatch(/^[0-9a-f]{64}$/);
  });

  it("不同输入不碰撞(前缀相同仅随机段不同)", () => {
    expect(hashToken(`${PAT_PREFIX}a`)).not.toBe(hashToken(`${PAT_PREFIX}b`));
  });
});

describe("parseBearer", () => {
  it("标准形态剥出值;scheme 大小写不敏感;多空白容忍", () => {
    expect(parseBearer("Bearer ahp_x")).toBe("ahp_x");
    expect(parseBearer("bearer ahp_x")).toBe("ahp_x");
    expect(parseBearer("BEARER   ahp_x")).toBe("ahp_x");
  });

  it("非 Bearer / 空值 / 值缺失 → null", () => {
    expect(parseBearer(null)).toBeNull();
    expect(parseBearer("")).toBeNull();
    expect(parseBearer("Basic dXNlcjpwYXNz")).toBeNull();
    expect(parseBearer("Bearer")).toBeNull();
    expect(parseBearer("Bearer ")).toBeNull();
  });
});
