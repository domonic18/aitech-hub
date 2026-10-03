/**
 * Bearer PAT(Personal Access Token)域(M5-c,requirement §3.6):
 * 「API 为核,MCP 为壳」的鉴权底座。库中只存 sha256 哈希,明文仅签发时
 * 返回一次;校验联查 user(role=admin 且 status=active),禁用用户即失全
 * 部令牌。last_used_at 异步补写,失败不影响请求。
 */
import { createHash, randomBytes } from "node:crypto";

import { prisma } from "@/lib/db";
import { logger } from "@/lib/logger";

import { ADMIN_ROLE } from "./constants";

/** 令牌前缀:泄露可扫描识别(git 扫描/日志脱敏),不承载语义 */
export const PAT_PREFIX = "ahp_";

/** sha256 hex(64 位,与 user_pat.token_hash char(64) 对齐)——纯函数 */
export function hashToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

/** 解析 Authorization 头为 bearer 值;非 Bearer 形态返回 null——纯函数 */
export function parseBearer(header: string | null): string | null {
  const m = /^Bearer\s+(\S+)$/i.exec(header ?? "");
  return m ? m[1]! : null;
}

export interface IssuedPat {
  /** 库中 id(十进制串,BigInt 出参 toString 纪律) */
  id: string;
  /** 明文令牌,仅此一次返回 */
  token: string;
}

/** 签发:明文 = 前缀 + 32 字节随机 base64url;库只落哈希 */
export async function issuePat(userId: bigint, name: string): Promise<IssuedPat> {
  const token = PAT_PREFIX + randomBytes(32).toString("base64url");
  const row = await prisma.userPat.create({
    data: { userId, name, tokenHash: hashToken(token) },
    select: { id: true },
  });
  logger.info({ event: "pat.issued", patId: row.id.toString(), userId: userId.toString() });
  return { id: row.id.toString(), token };
}

export interface PatActor {
  /** 持有人 user id(十进制串) */
  sub: string;
  patId: string;
}

/**
 * 校验 Authorization 头 → PAT actor;任一环不过返回 null:
 * Bearer 形态 → ahp_ 前缀 → 哈希命中 → 未吊销 → 持有人 admin 且 active。
 * last_used_at 尽力补写(失败仅 warn,不阻塞请求)。
 */
export async function verifyPatToken(header: string | null): Promise<PatActor | null> {
  const token = parseBearer(header);
  if (token === null || !token.startsWith(PAT_PREFIX)) return null;
  const row = await prisma.userPat.findFirst({
    where: { tokenHash: hashToken(token), revokedAt: null },
    select: {
      id: true,
      user: { select: { id: true, role: true, status: true } },
    },
  });
  if (!row || row.user.role !== ADMIN_ROLE || row.user.status !== "active") return null;
  void prisma.userPat
    .update({ where: { id: row.id }, data: { lastUsedAt: new Date() } })
    .catch((err: unknown) => logger.warn({ event: "pat.touch_failed", error: String(err) }));
  return { sub: row.user.id.toString(), patId: row.id.toString() };
}

/** 吊销(幂等):已吊销再吊销无副作用;返回是否本次实际吊销 */
export async function revokePat(id: bigint): Promise<boolean> {
  const r = await prisma.userPat.updateMany({
    where: { id, revokedAt: null },
    data: { revokedAt: new Date() },
  });
  if (r.count > 0) logger.info({ event: "pat.revoked", patId: id.toString() });
  return r.count > 0;
}

export interface PatRow {
  id: string;
  name: string;
  createdAt: Date;
  lastUsedAt: Date | null;
  revokedAt: Date | null;
}

/** 管理列表(单管理员期全量):生效在前,其余按创建倒序 */
export async function listPats(): Promise<PatRow[]> {
  const rows = await prisma.userPat.findMany({
    orderBy: [{ revokedAt: "asc" }, { createdAt: "desc" }],
    select: { id: true, name: true, createdAt: true, lastUsedAt: true, revokedAt: true },
  });
  return rows.map((r) => ({ ...r, id: r.id.toString() }));
}

/** 路由边界按 id 吊销:十进制串校验,区分不存在/已吊销/本次吊销 */
export async function revokePatById(id: string): Promise<"revoked" | "already" | "missing"> {
  if (!/^\d{1,19}$/.test(id)) return "missing";
  const big = BigInt(id);
  const exists = await prisma.userPat.findUnique({ where: { id: big }, select: { id: true } });
  if (!exists) return "missing";
  return (await revokePat(big)) ? "revoked" : "already";
}
