/**
 * 网关工厂(M21 批②,提案 §7;2026-10-09 拍板模式入表):读
 * pay_gateway_config 中 enabled=true 的行——无行=null(收银台关闭)/
 * mock=MockGateway(生产环境忽略,双护栏)/ xunhu=XunhuGateway(凭据
 * 齐备才生效)。每次调用现取配置(缓存键含 updatedAt,admin 保存即换新)。
 */
import { prisma } from "@/lib/db";
import { env } from "@/lib/env";
import { GATEWAY_MOCK, GATEWAY_XUNHU, getPayGatewayRuntimeConfig } from "@/lib/pay/gateway-config";
import { MockGateway } from "@/lib/pay/gateway/mock";
import { XunhuGateway } from "@/lib/pay/gateway/xunhu";
import type { PayGateway } from "@/lib/pay/gateway/types";

/** null = 收银台关闭(调用方按 off 语义渲染入口/拒下单) */
export async function getPayGateway(): Promise<PayGateway | null> {
  const enabled = await prisma.payGatewayConfig.findFirst({ where: { enabled: true } });
  if (!enabled) return null; // 全 false = off(默认态)
  if (enabled.gateway === GATEWAY_MOCK) {
    return env.NODE_ENV === "production" ? null : new MockGateway(); // 生产忽略 mock 行
  }
  if (enabled.gateway === GATEWAY_XUNHU) {
    const cfg = await getPayGatewayRuntimeConfig(GATEWAY_XUNHU);
    if (!cfg) return null; // 凭据缺失(理论不可达,路由层已把关)→ fail-closed
    return new XunhuGateway(cfg);
  }
  return null; // 未知网关标识一律关闭
}
