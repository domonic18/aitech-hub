/**
 * 飞书 OpenAPI 客户端(M29 批①):自建应用 app_access_token / jsapi_ticket
 * 各带 Redis 缓存(按返回有效期预留 5min 余量;缓存故障降级直连不阻断);
 * H5 签名 verifyStr 拼接顺序冻结(jsapi_ticket→noncestr→timestamp→url)取
 * sha1;免登授权码兑换 = OIDC access_token → user_info 取 unionId/openId。
 * fetcher 参数注入保证零真网单测;超时 8s;飞书 code!==0 / 非 200 一律
 * FeishuError("upstream"),细节进日志不外吐。
 */
import { createHash, randomBytes } from "node:crypto";

import { logger } from "@/lib/logger";
import { redis } from "@/lib/redis";

import { FeishuError } from "./feishu-errors";

const FEISHU_OPEN = "https://open.feishu.cn/open-apis";
const FEISHU_TIMEOUT_MS = 8_000;
/** 凭证缓存余量:官方有效期(≤7200s)内预留 5min,防临界过期 */
const TTL_MARGIN_SECONDS = 300;
const APP_TOKEN_KEY = "feishu:app_token";
const TICKET_KEY = "feishu:jsapi_ticket";

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

/** jsapi_ticket(h5sdk.config 签名材料;POST /jssdk/ticket/get) */
export async function getJsapiTicket(
  cfg: FeishuCredentials,
  fetcher: Fetcher = fetch,
): Promise<string> {
  try {
    const cached = await redis.get(TICKET_KEY);
    if (cached) return cached;
  } catch {
    // 缓存故障降级直连
  }
  const token = await getAppAccessToken(cfg, fetcher);
  const json = await requestJson<{
    data?: { ticket?: string; expire_sec?: number };
    ticket?: string;
    expire_sec?: number;
  }>(fetcher, `${FEISHU_OPEN}/jssdk/ticket/get`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ app_id: cfg.appId }),
  });
  const ticket = json.data?.ticket ?? json.ticket;
  if (!ticket) throw new FeishuError("upstream", "飞书未返回 jsapi_ticket");
  const ttl = Math.max(60, (json.data?.expire_sec ?? json.expire_sec ?? 7200) - TTL_MARGIN_SECONDS);
  try {
    await redis.set(TICKET_KEY, ticket, "EX", ttl);
  } catch {
    // 缓存故障不影响本次
  }
  return ticket;
}

export interface JsSign {
  appId: string;
  timestamp: string;
  nonceStr: string;
  signature: string;
}

/** H5 签名:verifyStr 四段顺序冻结(与 h5sdk.config 入参同值,10 分钟有效) */
export function signJsapi(cfg: FeishuCredentials, ticket: string, url: string): JsSign {
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const nonceStr = randomBytes(8).toString("hex");
  const signature = createHash("sha1")
    .update(`jsapi_ticket=${ticket}&noncestr=${nonceStr}&timestamp=${timestamp}&url=${url}`)
    .digest("hex");
  return { appId: cfg.appId, timestamp, nonceStr, signature };
}

export interface FeishuIdentity {
  unionId: string;
  openId: string;
  name: string;
}

/** 免登授权码兑换身份(授权码 5 分钟单次有效):OIDC access_token → user_info。
 * union_id 为绑定键(fail-closed:缺失即拒,应用需开通「获取用户 union ID」权限)。 */
export async function exchangeFeishuIdentity(
  cfg: FeishuCredentials,
  code: string,
  fetcher: Fetcher = fetch,
): Promise<FeishuIdentity> {
  const appToken = await getAppAccessToken(cfg, fetcher);
  const at = await requestJson<{ data?: { access_token?: string } }>(
    fetcher,
    `${FEISHU_OPEN}/authen/v1/oidc/access_token`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        Authorization: `Bearer ${appToken}`,
      },
      body: JSON.stringify({ grant_type: "authorization_code", code }),
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
