/**
 * B站直连 HTTP 适配(M25,TS 直连——原型实证零签名可拉,方案 §2):
 * 首页暖取 cookie(buvid 等,worker 常驻进程级复用)→ search/card 复用;
 * 风控判定收敛在 contract.expectEnvelopeOk + HTTP 412;超时 10s。
 * 重试纪律不在此层(调用方按 constants 退避),本层单次调用语义。
 */
import {
  expectEnvelopeOk,
  parseCard,
  parseSearchPage,
  type CardInfo,
  type ParsedSearchPage,
} from "./contract";
import { BiliApiUnavailableError, BiliRiskControlError } from "./errors";

const BILI_API = "https://api.bilibili.com";
const BILI_HOME = "https://www.bilibili.com/";
const TIMEOUT_MS = 10_000;

const BROWSER_HEADERS: Record<string, string> = {
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
  Referer: "https://www.bilibili.com/",
  Accept: "application/json, text/plain, */*",
};

/** 进程级 cookie jar:暖取一次全程复用;失败不拦任务——部分接口无 cookie 也可用,
 *  真被门时走 412 退避(重置 cookie 帮不了 IP 级风控,不做过热设计) */
let cookieJar: string | null = null;

async function ensureCookies(): Promise<string> {
  if (cookieJar !== null) return cookieJar;
  try {
    const res = await fetch(BILI_HOME, {
      headers: BROWSER_HEADERS,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    cookieJar = res.headers
      .getSetCookie()
      .map((c) => c.split(";")[0])
      .filter(Boolean)
      .join("; ");
  } catch {
    cookieJar = "";
  }
  return cookieJar;
}

async function biliGetJson(url: string): Promise<unknown> {
  const cookie = await ensureCookies();
  const res = await fetch(url, {
    headers: cookie ? { ...BROWSER_HEADERS, Cookie: cookie } : BROWSER_HEADERS,
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (res.status === 412) {
    throw new BiliRiskControlError("HTTP 412");
  }
  if (!res.ok) {
    throw new BiliApiUnavailableError(`HTTP ${res.status}`);
  }
  try {
    return await res.json();
  } catch {
    throw new BiliApiUnavailableError("响应非 JSON");
  }
}

export interface SearchParams {
  keyword: string;
  /** 排序:click 播放优先(原型口径)| pubdate 最新;缺省 click */
  order?: "click" | "pubdate";
  page?: number;
  pageSize?: number;
  /** 发布时间窗(秒级 epoch,含端点);双窗口由调用方传 */
  beginSec?: number;
  endSec?: number;
}

/** 视频搜索(code=0 后 data.result[];envelope 风控/契约错误向上抛) */
export async function biliSearchVideo(params: SearchParams): Promise<ParsedSearchPage> {
  const url = new URL(`${BILI_API}/x/web-interface/search/type`);
  url.searchParams.set("search_type", "video");
  url.searchParams.set("keyword", params.keyword);
  url.searchParams.set("order", params.order ?? "click");
  url.searchParams.set("page", String(params.page ?? 1));
  url.searchParams.set("page_size", String(params.pageSize ?? 20));
  if (params.beginSec !== undefined && params.endSec !== undefined) {
    url.searchParams.set("pubtime_begin_s", String(params.beginSec));
    url.searchParams.set("pubtime_end_s", String(params.endSec));
  }
  const json = await biliGetJson(url.toString());
  expectEnvelopeOk(json);
  return parseSearchPage(json);
}

/** UP 资料卡(mid → name/fans/archive_count;失败由调用方兜底,fans/archives 留空) */
export async function biliCard(mid: string): Promise<CardInfo> {
  const url = new URL(`${BILI_API}/x/web-interface/card`);
  url.searchParams.set("mid", mid);
  url.searchParams.set("photo", "true");
  const json = await biliGetJson(url.toString());
  expectEnvelopeOk(json);
  return parseCard(json);
}
