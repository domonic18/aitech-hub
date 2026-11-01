/**
 * pino 结构化日志(arch/05-services §6):一期不接日志平台,docker compose logs 排障。
 * 安全红线:密钥/密码/验证码类字段经 redact 兜底;业务侧仍应只记事件不记敏感值
 * (手机号走 maskPhone,IP 记 sha256 短哈希不记明文,与统计口径一致)。
 */
import pino from "pino";

import { env } from "@/lib/env";

export const logger = pino({
  level: process.env.LOG_LEVEL ?? "info",
  redact: {
    paths: ["password", "passwordHash", "*.password", "*.passwordHash", "*.code", "code"],
    censor: "[redacted]",
  },
});

/**
 * 统一日志出口(2026-11-01 批D):业务代码只经这三个函数打日志,不再手搓
 * `console.*(JSON.stringify({ event, ... }))` —— 此前字段名不统一(error 有时是
 * String(e)、有时是 e.message),降到文件日志时无法按字段检索。
 * 约定:第一个参数是稳定事件名(点分命名),其余进字段;Error 实例自动取 message。
 * 脚本目录(scripts/)沿用 console,不在此列。
 */
type LogFields = Record<string, unknown>;

function normalizeFields(fields: LogFields): LogFields {
  const out: LogFields = {};
  for (const [key, value] of Object.entries(fields)) {
    if (value === undefined) continue;
    out[key] = value instanceof Error ? value.message : value;
  }
  return out;
}

export function logInfo(event: string, fields: LogFields = {}): void {
  logger.info({ ...normalizeFields(fields), event });
}

export function logWarn(event: string, fields: LogFields = {}): void {
  logger.warn({ ...normalizeFields(fields), event });
}

export function logError(event: string, fields: LogFields = {}): void {
  logger.error({ ...normalizeFields(fields), event });
}

/** IP 短哈希(sha256 前 16 位,salt 用 AUTH_SECRET);日志与统计同口径不落明文 IP */
export async function ipHash(ip: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(`${env.AUTH_SECRET}:${ip}`),
  );
  return Array.from(new Uint8Array(digest))
    .slice(0, 8)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
