/**
 * 热榜 HTTP 取数共用件(M34 批③):浏览器 UA + 单源超时 + JSON 容错。
 * 上游反爬口径差异(Referer 等)由各 fetcher 自带头;失败统一抛 HotlistError。
 */
import { HOTLIST_FETCH_TIMEOUT_MS } from "../constants";

import { HotlistError } from "./types";

export const BROWSER_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

/** GET JSON(超时 AbortSignal;非 2xx / 非 JSON 均抛 HotlistError) */
export async function getJson(url: string, headers: Record<string, string>): Promise<unknown> {
  const res = await fetch(url, {
    headers,
    signal: AbortSignal.timeout(HOTLIST_FETCH_TIMEOUT_MS),
  });
  if (!res.ok) throw new HotlistError(`HTTP ${res.status}`);
  try {
    return await res.json();
  } catch {
    throw new HotlistError("响应非 JSON");
  }
}
