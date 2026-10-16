/**
 * 飞书 OpenAPI 客户端(M29 批①;2026-10-16 免登修复):自建应用
 * app_access_token 带 Redis 缓存(按返回有效期预留 5min 余量;缓存故障降级
 * 直连不阻断);免登授权码兑换 = OAuth v2 token(client_id/secret 直换,
 * 旧 authen/v1/oidc 已废弃)→ user_info 取 unionId/openId。fetcher 参数
 * 注入保证零真网单测;超时 8s;飞书 code!==0 / 非 200 一律
 * FeishuError("upstream"),细节进日志不外吐。
 */
import { logger } from "@/lib/logger";
import { redis } from "@/lib/redis";

import { FeishuError } from "./feishu-errors";

const FEISHU_OPEN = "https://open.feishu.cn/open-apis";
const FEISHU_TIMEOUT_MS = 8_000;
/** 凭证缓存余量:官方有效期(≤7200s)内预留 5min,防临界过期 */
const TTL_MARGIN_SECONDS = 300;
const APP_TOKEN_KEY = "feishu:app_token";

export type Fetcher = (input: string, init?: RequestInit) => Promise<Response>;

export interface FeishuCredentials {
  appId: string;
  appSecret: string;
}

interface FeishuEnvelope {
  code?: number;
  msg?: string;
}

/** 统一请求:超时/网络/非 JSON/code!==0 全部归一 FeishuError("upstream") */
async function requestJson<T>(fetcher: Fetcher, url: string, init: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetcher(url, {
      ...init,
      signal: AbortSignal.timeout(FEISHU_TIMEOUT_MS),
      cache: "no-store",
    });
  } catch (e) {
    throw new FeishuError("upstream", `飞书接口网络失败:${String(e)}`);
  }
  let json: unknown;
  try {
    json = await res.json();
  } catch {
    throw new FeishuError("upstream", `飞书接口响应非 JSON(HTTP ${res.status})`);
  }
  const env = json as FeishuEnvelope;
  if (res.status !== 200 || (env.code !== undefined && env.code !== 0)) {
    logger.warn({
      event: "feishu.api.fail",
      url,
      http: res.status,
      code: env.code ?? null,
      msg: env.msg ?? "",
    });
    throw new FeishuError(
      "upstream",
      `飞书接口失败(code=${env.code ?? res.status}):${env.msg ?? ""}`.trim(),
    );
  }
  return json as T;
}

/** 自建应用 app_access_token(单应用单键;官方 expire ≤7200s) */
export async function getAppAccessToken(
  cfg: FeishuCredentials,
  fetcher: Fetcher = fetch,
): Promise<string> {
  try {
    const cached = await redis.get(APP_TOKEN_KEY);
    if (cached) return cached;
  } catch {
    // 缓存故障降级直连
  }
  const json = await requestJson<{ app_access_token?: string; expire?: number }>(
    fetcher,
    `${FEISHU_OPEN}/auth/v3/app_access_token/internal`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json; charset=utf-8" },
      body: JSON.stringify({ app_id: cfg.appId, app_secret: cfg.appSecret }),
    },
  );
  const token = json.app_access_token;
  if (!token) throw new FeishuError("upstream", "飞书未返回 app_access_token(检查凭证)");
  const ttl = Math.max(60, (json.expire ?? 7200) - TTL_MARGIN_SECONDS);
  try {
    await redis.set(APP_TOKEN_KEY, token, "EX", ttl);
  } catch {
    // 缓存故障不影响本次
  }
  return token;
}

export interface FeishuIdentity {
  unionId: string;
  openId: string;
  name: string;
}

/** 免登授权码兑换身份(授权码 5 分钟单次有效):OAuth v2 token 端点以
 * client_id/client_secret 直换 user_access_token(H5 免登 code 非重定向流,
 * 不携带 redirect_uri;2026-10-16 自已废弃的 authen/v1/oidc 迁移)→
 * user_info 取身份。union_id 为绑定键(fail-closed:缺失即拒,应用需开通
 * 「获取用户 union ID」权限)。 */
export async function exchangeFeishuIdentity(
  cfg: FeishuCredentials,
  code: string,
  fetcher: Fetcher = fetch,
): Promise<FeishuIdentity> {
  const at = await requestJson<{ data?: { access_token?: string } }>(
    fetcher,
    `${FEISHU_OPEN}/authen/v2/oauth/token`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json; charset=utf-8" },
      body: JSON.stringify({
        grant_type: "authorization_code",
        client_id: cfg.appId,
        client_secret: cfg.appSecret,
        code,
      }),
    },
  );
  const userToken = at.data?.access_token;
  if (!userToken)
    throw new FeishuError("upstream", "飞书未返回 user_access_token(授权码无效或已用过)");

  const ui = await requestJson<{ data?: { union_id?: string; open_id?: string; name?: string } }>(
    fetcher,
    `${FEISHU_OPEN}/authen/v1/user_info`,
    { method: "GET", headers: { Authorization: `Bearer ${userToken}` } },
  );
  const unionId = ui.data?.union_id;
  const openId = ui.data?.open_id;
  if (!unionId || !openId) {
    throw new FeishuError(
      "invalid",
      "飞书未返回 union_id/open_id(检查应用权限范围与 union ID 权限)",
    );
  }
  return { unionId, openId, name: (ui.data?.name ?? "").slice(0, 100) };
}
