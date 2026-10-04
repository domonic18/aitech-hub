/**
 * 密钥箱单测(批⑥):HKDF 派生确定性、AES-256-GCM roundtrip、
 * 异密钥/坏密文失败语义(null 不 throw)、maskSecret 边界。
 * env 经 vi.mock 注入固定 AUTH_SECRET(不触真实 .env)。
 */
import { describe, expect, it, vi } from "vitest";

const AUTH = vi.hoisted(() => "unit-test-auth-secret-0123456789");
vi.mock("../env", () => ({ env: { AUTH_SECRET: AUTH } }));

import { decryptSecret, encryptSecret, maskSecret } from "./secret-box";

describe("secret-box 加解密", () => {
  it("roundtrip:同 AUTH_SECRET 派生确定,密文可解回", () => {
    const secret = "sk-live-abcdef1234567890";
    expect(decryptSecret(encryptSecret(secret))).toBe(secret);
  });

  it("随机 iv:同明文两次密文互异且均可解", () => {
    const c1 = encryptSecret("ping");
    const c2 = encryptSecret("ping");
    expect(c1).not.toBe(c2);
    expect(decryptSecret(c1)).toBe("ping");
    expect(decryptSecret(c2)).toBe("ping");
  });

  it("异 AUTH_SECRET(密钥轮换)/坏 base64/翻转字节 → null 不 throw", async () => {
    const ciphertext = encryptSecret("jar-a");
    vi.doMock("../env", () => ({ env: { AUTH_SECRET: "rotated-secret-9876543210abc" } }));
    vi.resetModules();
    const rotated = (await import("./secret-box")) as typeof import("./secret-box");
    expect(rotated.decryptSecret(ciphertext)).toBeNull();
    vi.doMock("../env", () => ({ env: { AUTH_SECRET: AUTH } }));
    vi.resetModules();
    const orig = (await import("./secret-box")) as typeof import("./secret-box");
    expect(orig.decryptSecret("not-base64!!!")).toBeNull();
    const blob = Buffer.from(orig.encryptSecret("x"), "base64");
    blob[blob.length - 1] ^= 0xff; // GCM tag 校验失败
    expect(orig.decryptSecret(blob.toString("base64"))).toBeNull();
    expect(orig.decryptSecret("")).toBeNull(); // <28 字节
  });

  it("超短密文(<28B)→ null", () => {
    expect(decryptSecret(Buffer.alloc(10, 7).toString("base64"))).toBeNull();
  });
});

describe("maskSecret 脱敏", () => {
  it("≤8 字符全掩码;长串前 3 + 尾 4", () => {
    expect(maskSecret("short")).toBe("****");
    expect(maskSecret("12345678")).toBe("****");
    expect(maskSecret("sk-abcdef-f2a8")).toBe("sk-****f2a8");
  });
});
