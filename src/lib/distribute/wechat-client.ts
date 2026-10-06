/**
 * 微信公众号 API 客户端(M17,api.weixin.qq.com CGI 网关):
 * 批① 交付 token 探针 + 错误归因/人话(测试连接消费);批③ 扩 token 缓存
 * 与 uploadimg/add_material/draft add|update。
 * 契约:所有业务接口响应 {errcode:0}=成功;/cgi-bin/token 失败形态为
 * {errcode,errmsg}(成功无 errcode 字段,取 access_token/expires_in)。
 * 纯 HTTP 客户端:禁 import prisma;网络必 mock 单测(standard/01)。
 */

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

async function getWxJson<T extends WxErrorBody>(url: string): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, { signal: AbortSignal.timeout(WECHAT_TIMEOUT_MS) });
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
