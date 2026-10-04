/**
 * 应用密钥箱(M8 批⑥,arch/04 §4):主密钥 HKDF-SHA256 从 AUTH_SECRET 派生,
 * AES-256-GCM 加密用户在后台录入的凭据(Cookie 池/模型 API Key)。密钥不入库、
 * 不新增环境变量;AUTH_SECRET 轮换即密钥轮换(存量密文不可解,需重录)。
 * 密文线格式 base64(iv[12]|tag[16]|ciphertext),与 M8 批⑤ Cookie 池格式一致。
 * salt/info 为冻结常量:上线后变更等同密钥轮换。
 */
import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from "node:crypto";

import { env } from "../env";

const HKDF_SALT = "aitech-hub"; // 冻结常量,禁改
const HKDF_INFO = "aitech-app-secrets-v1"; // 冻结常量,禁改

let cachedKey: Buffer | null = null;

/** 32 字节主密钥(hkdfSync 同步确定,web/worker 多进程派生结果一致) */
function masterKey(): Buffer {
  if (!cachedKey) {
    cachedKey = Buffer.from(hkdfSync("sha256", env.AUTH_SECRET, HKDF_SALT, HKDF_INFO, 32));
  }
  return cachedKey;
}

/** 加密:明文 → base64(iv|tag|ciphertext) */
export function encryptSecret(plaintext: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", masterKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), ciphertext]).toString("base64");
}

/** 解密;任何失败(坏 base64/密钥轮换/密文损坏)返回 null,由调用方决定降级语义 */
export function decryptSecret(payload: string): string | null {
  try {
    const blob = Buffer.from(payload, "base64");
    if (blob.length < 28) return null;
    const decipher = createDecipheriv("aes-256-gcm", masterKey(), blob.subarray(0, 12));
    decipher.setAuthTag(blob.subarray(12, 28));
    return Buffer.concat([decipher.update(blob.subarray(28)), decipher.final()]).toString("utf8");
  } catch {
    return null;
  }
}

/** 脱敏回显:≤8 字符全掩码,否则前 3 + 尾 4(sk-****f2a8 形态) */
export function maskSecret(secret: string): string {
  if (secret.length <= 8) return "****";
  return `${secret.slice(0, 3)}****${secret.slice(-4)}`;
}
