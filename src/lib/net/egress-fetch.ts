/**
 * 经系统出口代理取数(M58 批③ 自 leaderboard/registry 提取,批④ 社区源复用):
 * 境内直连不可达的源(Hugging Face / V2EX 等)在 system_proxy_config 配置后
 * 统一走代理;未配置退回直连(失败如实计源错误,不假装成功)。
 * 用 undici 显式 dispatcher,不改进程全局 dispatcher——全局代理会波及站内
 * 其它出站请求。
 *
 * 代理隧道不可达时兜底直连一次(2026-10-30 E2E 实测:出口隧道挂掉期间
 * community:v2ex / leaderboard:huggingface 连续 UND_ERR_CONNECT_TIMEOUT,
 * 而容器内直连分别可达;隧道是通道而非目标,通道挂掉不该把可达源一起判死)。
 * 只兜网络层异常——HTTP 4xx/5xx 是目标站的真实答复,照旧如实计失败。
 */
import { logger } from "@/lib/logger";

import { getEgressProxyRuntime } from "../telegram/egress-proxy";

export async function fetchViaEgress(url: string, init: RequestInit): Promise<Response> {
  const egress = await getEgressProxyRuntime();
  if (egress === null) return fetch(url, init);
  const { fetch: undiciFetch, ProxyAgent } = await import("undici");
  const dispatcher = new ProxyAgent(egress.proxyUrl);
  try {
    // 只透传 GET 必需字段:Next 的 RequestInit 与 undici 在 body 流类型上不兼容
    const res = await undiciFetch(url, {
      method: init.method,
      headers: init.headers as Record<string, string>,
      signal: init.signal,
      dispatcher,
    });
    return res as unknown as Response;
  } catch (e) {
    // 调用方 signal 已到期(本轮到点):不再重试,照实上抛交源健康度记账
    if (init.signal instanceof AbortSignal && init.signal.aborted) throw e;
    logger.warn({ event: "net.egress_proxy_failed", url, error: String(e) });
    return fetch(url, init);
  }
}
