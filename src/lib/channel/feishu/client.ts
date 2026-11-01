/**
 * 飞书站务通知客户端(M66):自建应用 app_access_token(按 appId 缓存)+
 * 群聊消息发送(`im/v1/messages`,receive_id_type=chat_id)。
 *
 * 与 M29 免登客户端刻意的差异:token 缓存键带 appId——两个飞书应用凭据不同,
 * 共用键会串号。本模块**不抛异常**:站务通知是旁路,失败只回结构化结果,
 * 由调用方决定记日志/落 last_test/静默。
 */
import { logger } from "@/lib/logger";
import { redis } from "@/lib/redis";

const FEISHU_OPEN = "https://open.feishu.cn/open-apis";
const FEISHU_TIMEOUT_MS = 8_000;
/** 凭证缓存余量:官方有效期 ≤7200s,预留 5min 防临界过期 */
const TTL_MARGIN_SECONDS = 300;

export type Fetcher = (input: string, init?: RequestInit) => Promise<Response>;

export interface FeishuAppCredentials {
  appId: string;
  appSecret: string;
}

interface TokenResponse {
  code?: number;
  msg?: string;
  app_access_token?: string;
  expire?: number;
}

interface SendResponse {
  code?: number;
  msg?: string;
  data?: { message_id?: string };
}

function tokenKey(appId: string): string {
  return `channel:feishu:app_token:${appId}`;
}

async function readJson(res: Response): Promise<unknown> {
  try {
    return await res.json();
  } catch {
    return null;
  }
}

/** 自建应用 app_access_token(Redis 缓存;缓存故障降级直连) */
async function getAppAccessToken(
  cfg: FeishuAppCredentials,
  fetcher: Fetcher,
): Promise<{ token: string | null; error: string | null }> {
  try {
    const cached = await redis.get(tokenKey(cfg.appId));
    if (cached) return { token: cached, error: null };
  } catch {
    // 缓存故障降级直连
  }
  let res: Response;
  try {
    res = await fetcher(`${FEISHU_OPEN}/auth/v3/app_access_token/internal`, {
      method: "POST",
      headers: { "Content-Type": "application/json; charset=utf-8" },
      body: JSON.stringify({ app_id: cfg.appId, app_secret: cfg.appSecret }),
      signal: AbortSignal.timeout(FEISHU_TIMEOUT_MS),
      cache: "no-store",
    });
  } catch (e) {
    return { token: null, error: `获取 app_access_token 网络失败:${String(e)}` };
  }
  const json = (await readJson(res)) as TokenResponse | null;
  if (!json || res.status !== 200 || json.code !== 0 || !json.app_access_token) {
    return {
      token: null,
      error:
        `获取 app_access_token 失败(code=${json?.code ?? res.status}):${json?.msg ?? ""}`.trim(),
    };
  }
  const ttl = Math.max(60, (json.expire ?? 7200) - TTL_MARGIN_SECONDS);
  try {
    await redis.set(tokenKey(cfg.appId), json.app_access_token, "EX", ttl);
  } catch {
    // 缓存写失败不影响本次发送
  }
  return { token: json.app_access_token, error: null };
}

export interface FeishuSendResult {
  ok: boolean;
  error: string | null;
  latencyMs: number;
  messageId: string | null;
}

/** 向群聊发一条消息(msgType=interactive 时 content 为卡片 JSON 字符串) */
export async function sendFeishuChatMessage(
  cfg: FeishuAppCredentials & { chatId: string },
  msgType: "interactive" | "text",
  content: string,
  fetcher: Fetcher = fetch,
): Promise<FeishuSendResult> {
  const startedAt = Date.now();
  const auth = await getAppAccessToken(cfg, fetcher);
  if (!auth.token)
    return { ok: false, error: auth.error, latencyMs: Date.now() - startedAt, messageId: null };

  let res: Response;
  try {
    res = await fetcher(`${FEISHU_OPEN}/im/v1/messages?receive_id_type=chat_id`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        Authorization: `Bearer ${auth.token}`,
      },
      body: JSON.stringify({ receive_id: cfg.chatId, msg_type: msgType, content }),
      signal: AbortSignal.timeout(FEISHU_TIMEOUT_MS),
      cache: "no-store",
    });
  } catch (e) {
    return {
      ok: false,
      error: `发送消息网络失败:${String(e)}`,
      latencyMs: Date.now() - startedAt,
      messageId: null,
    };
  }
  const json = (await readJson(res)) as SendResponse | null;
  const latencyMs = Date.now() - startedAt;
  if (!json || res.status !== 200 || json.code !== 0) {
    logger.warn({
      event: "feishu.chat.send_failed",
      http: res.status,
      code: json?.code ?? null,
    });
    return {
      ok: false,
      error: `发送失败(code=${json?.code ?? res.status}):${json?.msg ?? ""}`.trim(),
      latencyMs,
      messageId: null,
    };
  }
  return { ok: true, error: null, latencyMs, messageId: json.data?.message_id ?? null };
}
