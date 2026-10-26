/**
 * 系统出口代理单例(M33 批B,plan M33):采集网关全部出站走家宽代理
 * (全局单点,用户定调;B 站/抖音一并过境)。镜像 auth/feishu-config 形态:
 * system_proxy_config(id=1)get-or-create;proxyUrl write-only + 脱敏回显
 * (secret-box AES-256-GCM,AUTH_SECRET 派生——轮换使密文失效需重录)。
 * 网关零密钥不变:worker 解密后随网关请求携带,网关不落盘不打日志;
 * 代理断连=基建错误(网关 EgressError→503),不冷却任何 cookie jar。
 */
import { z } from "zod";

import { TEST_STATUS_FAIL, TEST_STATUS_OK } from "@/lib/ai/constants";
import { decryptSecret, encryptSecret } from "@/lib/crypto/secret-box";
import { prisma } from "@/lib/db";
import { logger } from "@/lib/logger";

/** 单例行锚点(全库唯一 id;消费方禁再裸写 id:1) */
export const PROXY_CONFIG_ID = 1;

/** 代理 URL 白名单形态(http(s)/socks4/5;socks5h=远端 DNS) */
const PROXY_URL_PATTERN = /^(https?|socks[45]h?):\/\/\S+$/;

/** 脱敏回显:scheme://host:port 形(用户名/密码段剥除,永不回显) */
export function maskProxyUrl(url: string): string {
  try {
    const parsed = new URL(url);
    const port = parsed.port ? `:${parsed.port}` : "";
    return `${parsed.protocol}//${parsed.hostname}${port}`;
  } catch {
    return "****";
  }
}

/** 脱敏视图(永不含 proxyUrlEnc;日期 ISO 字符串——过 RSC 边界不失真) */
export interface EgressProxyConfigView {
  proxyUrlMask: string | null;
  enabled: boolean;
  lastTestedAt: string | null;
  lastTestStatus: string | null;
  lastTestError: string | null;
  lastTestLatencyMs: number | null;
  updatedAt: string | null;
}

/** 单例取用;首次访问落默认行(未配置/禁用,等管理员配置) */
export async function getEgressProxyConfigAdmin(): Promise<EgressProxyConfigView> {
  const row =
    (await prisma.systemProxyConfig.findUnique({ where: { id: PROXY_CONFIG_ID } })) ??
    (await prisma.systemProxyConfig.create({ data: { id: PROXY_CONFIG_ID } }));
  return {
    proxyUrlMask: row.proxyUrlMask,
    enabled: row.enabled,
    lastTestedAt: row.lastTestedAt?.toISOString() ?? null,
    lastTestStatus: row.lastTestStatus,
    lastTestError: row.lastTestError,
    lastTestLatencyMs: row.lastTestLatencyMs,
    updatedAt: row.updatedAt.toISOString(),
  };
}

export const EgressProxyUpdateSchema = z.object({
  /** 空/缺省 = 保留旧 URL;非空 = 换址重加密(http(s)/socks4/5 URL) */
  proxyUrl: z
    .string()
    .trim()
    .max(500)
    .refine((v) => PROXY_URL_PATTERN.test(v), "代理 URL 须为 http(s):// 或 socks4/5:// 形态")
    .optional()
    .nullable(),
  enabled: z.boolean(),
});

export type EgressProxyUpdateInput = z.infer<typeof EgressProxyUpdateSchema>;

/** 更新单例;proxyUrl 空/缺省 = 保留旧值,非空 = 换址重加密 */
export async function updateEgressProxyConfig(input: EgressProxyUpdateInput): Promise<void> {
  await getEgressProxyConfigAdmin(); // 确保单例行存在(首访落默认行)
  const url = input.proxyUrl?.trim() ? input.proxyUrl.trim() : null;
  await prisma.systemProxyConfig.update({
    where: { id: PROXY_CONFIG_ID },
    data: {
      ...(url ? { proxyUrlEnc: encryptSecret(url), proxyUrlMask: maskProxyUrl(url) } : {}),
      enabled: input.enabled,
    },
  });
  logger.info({
    event: "egress_proxy.updated",
    urlChanged: url !== null,
    enabled: input.enabled,
  });
}

/** 运行时取数(URL 已解密;仅供 worker 随网关请求携带与探针,禁回传客户端禁日志)。
 * 未配置/停用/解密失败(AUTH_SECRET 轮换)一律 null = 直连,调用方零分叉;
 * 细节只进日志。 */
export interface EgressProxyRuntime {
  proxyUrl: string;
}

export async function getEgressProxyRuntime(): Promise<EgressProxyRuntime | null> {
  const row = await prisma.systemProxyConfig.findUnique({ where: { id: PROXY_CONFIG_ID } });
  if (!row || !row.enabled || !row.proxyUrlEnc) return null;
  const url = decryptSecret(row.proxyUrlEnc);
  if (url === null) {
    logger.warn({ event: "egress_proxy.decrypt_failed" });
    return null;
  }
  return { proxyUrl: url };
}

/** 探针结果落库(lastTest 四件套) */
export async function recordEgressProxyTest(r: {
  ok: boolean;
  latencyMs: number;
  detail: string;
}): Promise<void> {
  await prisma.systemProxyConfig.update({
    where: { id: PROXY_CONFIG_ID },
    data: {
      lastTestedAt: new Date(),
      lastTestStatus: r.ok ? TEST_STATUS_OK : TEST_STATUS_FAIL,
      lastTestError: r.ok ? null : r.detail.slice(0, 500),
      lastTestLatencyMs: r.latencyMs,
    },
  });
  logger.info({ event: "egress_proxy.probe", ok: r.ok, latencyMs: r.latencyMs });
}
