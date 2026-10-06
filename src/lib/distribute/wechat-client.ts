/**
 * 微信公众号 API 客户端(M17,api.weixin.qq.com CGI 网关):
 * 批① 交付 token 探针 + 错误归因/人话(测试连接消费);批③ 扩 token Redis 缓存
 * (NX 锁防并发刷新,40001/42001 自愈强刷重试一次)与
 * uploadimg/add_material/draft add|update(multipart 用原生 FormData+Blob 零新依赖)。
 * 契约:所有业务接口响应 {errcode:0}=成功;/cgi-bin/token 失败形态为
 * {errcode,errmsg}(成功无 errcode 字段,取 access_token/expires_in)。
 * 纯 HTTP 客户端:禁 import prisma;网络必 mock 单测(standard/01)。
 */
import { redis } from "../redis";

const WECHAT_API_BASE = "https://api.weixin.qq.com";
const WECHAT_TIMEOUT_MS = 30_000;

/** 错误归因(重试分流与 UI 人话):token=凭证失效可强刷自愈;
 * ip_whitelist=出口 IP 未加白(运维前提,errmsg 自带出口 IP);
 * config=appid/secret 错;media=素材/图片被拒;limit=频控;network=网络层 */
export type WechatErrorKind =
  "token" | "ip_whitelist" | "config" | "media" | "limit" | "network" | "unknown";

export class WechatApiError extends Error {
  constructor(
    public kind: WechatErrorKind,
    public errcode: number,
    message: string,
  ) {
    super(message);
  }
}

/** errcode → kind(已知码小而全,未知归 unknown;码值以官方文档为准) */
const ERR_KIND_BY_CODE: Readonly<Record<number, WechatErrorKind>> = {
  40001: "token", // access_token 无效
  40014: "token", // 不合法的 access_token
  42001: "token", // access_token expired
  40164: "ip_whitelist", // IP 不在白名单
  41002: "config", // appid 缺失
  40013: "config", // appid 不合法
  40125: "config", // secret 不合法
  44002: "media", // POST 内容为空(素材)
  40005: "media", // 不支持的文件类型
  40006: "media", // 文件大小超限
  45009: "limit", // 接口调用频率超限
};

export function classifyWechatErrcode(errcode: number): WechatErrorKind {
  return ERR_KIND_BY_CODE[errcode] ?? "unknown";
}

/** errcode → 人话(UI 直显;ip_whitelist 附操作指引,errmsg 自带出口 IP) */
export function humanizeWechatError(errcode: number, errmsg: string): string {
  switch (classifyWechatErrcode(errcode)) {
    case "token":
      return `微信凭证失效(errcode ${errcode}):${errmsg}`;
    case "ip_whitelist":
      return `服务器 IP 不在公众号白名单:请把本提示中的 IP 加入「公众号后台-设置与开发-基本配置-IP 白名单」后重试(${errmsg})`;
    case "config":
      return `公众号 AppID/AppSecret 不合法(errcode ${errcode}):${errmsg}`;
    case "media":
      return `素材/图片被微信拒绝(errcode ${errcode}):${errmsg}`;
    case "limit":
      return `微信接口频率超限(errcode ${errcode}),请稍后重试:${errmsg}`;
    default:
      return `微信接口错误(errcode ${errcode}):${errmsg}`;
  }
}

interface WxErrorBody {
  errcode?: number;
  errmsg?: string;
}

/** 统一 errcode 门禁:非 0 即抛(已归因 + 人话) */
function throwIfWxError(body: WxErrorBody): void {
  const code = body.errcode ?? 0;
  if (code !== 0) {
    throw new WechatApiError(
      classifyWechatErrcode(code),
      code,
      humanizeWechatError(code, body.errmsg ?? "unknown"),
    );
  }
}

async function getWxJson<T extends WxErrorBody>(url: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, { ...init, signal: AbortSignal.timeout(WECHAT_TIMEOUT_MS) });
  } catch (e) {
    throw new WechatApiError(
      "network",
      0,
      `微信接口网络失败:${e instanceof Error ? e.message : String(e)}`,
    );
  }
  if (!res.ok) throw new WechatApiError("network", 0, `微信接口 HTTP ${res.status}`);
  try {
    return (await res.json()) as T;
  } catch {
    throw new WechatApiError("network", 0, "微信接口响应不是 JSON");
  }
}

export interface WechatTokenFetch {
  accessToken: string;
  expiresIn: number;
}

/** 实调 /cgi-bin/token(测试连接探针;批③起 worker 侧经 Redis 缓存复用):
 * secret 走 query 是微信 CGI 既有契约,仅服务端内存拼 URL 不落日志 */
export async function fetchWechatToken(
  appid: string,
  appSecret: string,
): Promise<WechatTokenFetch> {
  const url =
    `${WECHAT_API_BASE}/cgi-bin/token?grant_type=client_credential` +
    `&appid=${encodeURIComponent(appid)}&secret=${encodeURIComponent(appSecret)}`;
  const body = await getWxJson<WxErrorBody & { access_token?: string; expires_in?: number }>(url);
  throwIfWxError(body);
  if (!body.access_token || !body.expires_in) {
    throw new WechatApiError("unknown", 0, "微信 token 响应缺 access_token/expires_in(契约漂移)");
  }
  return { accessToken: body.access_token, expiresIn: body.expires_in };
}

// ── 业务接口(M17 批③):token 缓存 + 自愈重试 ───────────────────────

/** 凭证参数(sync 管线从运行时配置解出后传入;本模块不碰 prisma) */
export interface WechatCredentials {
  appid: string;
  appSecret: string;
}

const TOKEN_CACHE_KEY = "distribute:wechat:token";
const TOKEN_LOCK_KEY = "distribute:wechat:token:lock";
const TOKEN_LOCK_MS = 10_000;
const TOKEN_WAIT_ROUNDS = 25; // 25 × 200ms = 5s:持锁刷新通常 1s 内完成
const TOKEN_WAIT_INTERVAL_MS = 200;
/** 提前量:expires_in 7200s,缓存 ~7000s,避开边界与各端时钟漂移 */
const TOKEN_EXPIRY_SLACK_S = 200;

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** token 取用(Redis 缓存复用,token 日获取上限是微信硬频控):
 * miss/force 时抢 NX 锁刷新;未抢到锁轮询等持锁者写入(竞争源仅 web 探针+
 * worker 并发 1,锁是兜底)。缓存键不带 appid——单配置单例,换号后 40001
 * 自愈路径会 DEL 强刷。 */
async function fetchTokenCached(appid: string, appSecret: string, force = false): Promise<string> {
  if (!force) {
    const cached = await redis.get(TOKEN_CACHE_KEY);
    if (cached) return cached;
  }
  const locked = await redis.set(TOKEN_LOCK_KEY, "1", "PX", TOKEN_LOCK_MS, "NX");
  if (locked) {
    try {
      const { accessToken, expiresIn } = await fetchWechatToken(appid, appSecret);
      await redis.set(
        TOKEN_CACHE_KEY,
        accessToken,
        "EX",
        Math.max(60, expiresIn - TOKEN_EXPIRY_SLACK_S),
      );
      return accessToken;
    } finally {
      await redis.del(TOKEN_LOCK_KEY);
    }
  }
  for (let i = 0; i < TOKEN_WAIT_ROUNDS; i++) {
    await sleep(TOKEN_WAIT_INTERVAL_MS);
    const t = await redis.get(TOKEN_CACHE_KEY);
    if (t) return t;
  }
  throw new WechatApiError("token", 0, "access_token 刷新等待超时(并发竞争),请重试");
}

function isTokenErrcode(e: unknown): boolean {
  return (
    e instanceof WechatApiError &&
    (e.errcode === 40001 || e.errcode === 40014 || e.errcode === 42001)
  );
}

/** 业务调用统一入口:缓存 token → 失效(40001/40014/42001)DEL 强刷重试一次 */
async function withToken<T>(
  creds: WechatCredentials,
  run: (token: string) => Promise<T>,
): Promise<T> {
  let token = await fetchTokenCached(creds.appid, creds.appSecret);
  try {
    return await run(token);
  } catch (e) {
    if (!isTokenErrcode(e)) throw e;
    await redis.del(TOKEN_CACHE_KEY);
    token = await fetchTokenCached(creds.appid, creds.appSecret, true);
    return await run(token);
  }
}

/** multipart 上传(字段名固定 media;微信 CGI 既有契约) */
function mediaForm(bytes: Uint8Array, filename: string, mime: string): FormData {
  const form = new FormData();
  form.append("media", new Blob([bytes as BlobPart], { type: mime }), filename);
  return form;
}

/** 正文图转存 uploadimg:回 mmbiz 永久 URL(直接进正文;不占素材库永久额度) */
export async function wechatUploadImage(
  creds: WechatCredentials,
  bytes: Uint8Array,
  filename: string,
  mime: string,
): Promise<string> {
  return withToken(creds, async (token) => {
    const body = await getWxJson<WxErrorBody & { url?: string }>(
      `${WECHAT_API_BASE}/cgi-bin/media/uploadimg?access_token=${token}`,
      { method: "POST", body: mediaForm(bytes, filename, mime) },
    );
    throwIfWxError(body);
    if (!body.url) throw new WechatApiError("unknown", 0, "uploadimg 响应缺 url(契约漂移)");
    return body.url;
  });
}

/** 封面永久素材 add_material?type=image:回 media_id(草稿 thumb 必须永久素材)+ 展示 URL */
export async function wechatAddCoverMaterial(
  creds: WechatCredentials,
  bytes: Uint8Array,
  filename: string,
  mime: string,
): Promise<{ mediaId: string; url: string }> {
  return withToken(creds, async (token) => {
    const body = await getWxJson<WxErrorBody & { media_id?: string; url?: string }>(
      `${WECHAT_API_BASE}/cgi-bin/material/add_material?type=image&access_token=${token}`,
      { method: "POST", body: mediaForm(bytes, filename, mime) },
    );
    throwIfWxError(body);
    if (!body.media_id) {
      throw new WechatApiError("unknown", 0, "add_material 响应缺 media_id(契约漂移)");
    }
    return { mediaId: body.media_id, url: body.url ?? "" };
  });
}

/** 草稿图文(article 结构与官方 draft/add 契约同形;字段名保留下划线原样透传) */
export interface WechatDraftArticle {
  title: string;
  author?: string;
  digest?: string;
  content: string;
  content_source_url?: string;
  thumb_media_id: string;
  need_open_comment?: 0 | 1;
  only_fans_can_comment?: 0 | 1;
}

/** 新建草稿(draft/add,articles 为数组):回草稿 media_id */
export async function wechatDraftAdd(
  creds: WechatCredentials,
  article: WechatDraftArticle,
): Promise<string> {
  return withToken(creds, async (token) => {
    const body = await getWxJson<WxErrorBody & { media_id?: string }>(
      `${WECHAT_API_BASE}/cgi-bin/draft/add?access_token=${token}`,
      { method: "POST", body: JSON.stringify({ articles: [article] }) },
    );
    throwIfWxError(body);
    if (!body.media_id)
      throw new WechatApiError("unknown", 0, "draft/add 响应缺 media_id(契约漂移)");
    return body.media_id;
  });
}

/** 更新草稿(draft/update,articles 为单对象 + index 定位):重推已同步文章走此路径 */
export async function wechatDraftUpdate(
  creds: WechatCredentials,
  mediaId: string,
  article: WechatDraftArticle,
): Promise<void> {
  await withToken(creds, async (token) => {
    const body = await getWxJson<WxErrorBody>(
      `${WECHAT_API_BASE}/cgi-bin/draft/update?access_token=${token}`,
      { method: "POST", body: JSON.stringify({ media_id: mediaId, index: 0, articles: article }) },
    );
    throwIfWxError(body);
  });
}
