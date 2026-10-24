/**
 * 浏览器侧 job 轮询内核(M47 批B4):同步弹窗/复制按钮/同步台账/媒体外链
 * 转存/批量骨架五处曾手写同构「sleep→fetch→包络校验→终态判定」循环,预算、
 * 进度回调各自漂移。暂时态(!ok/坏包络/非终态)继续;isTerminal 命中返回
 * data;预算耗尽返回 null;网络异常不吞,交调用方外层 catch 收止(同原副本)。
 */
import { type ApiEnvelope } from "@/lib/http/response";

export async function pollJobUntil<T>(
  url: string,
  opts: {
    pollMs: number;
    pollMax: number;
    /** 终态判定(completed/failed 或域内变体,如「completed 且带 result」) */
    isTerminal: (data: T) => boolean;
    /** 每次有效非终态数据回调(进度文案;省略 = 轮询期静默) */
    onPoll?: (data: T) => void;
  },
): Promise<T | null> {
  for (let i = 0; i < opts.pollMax; i += 1) {
    await new Promise((r) => setTimeout(r, opts.pollMs));
    const poll = await fetch(url);
    if (!poll.ok) continue;
    const body = (await poll.json().catch(() => null)) as ApiEnvelope<T> | null;
    if (body?.code !== 0 || !body?.data) continue;
    if (opts.isTerminal(body.data)) return body.data;
    opts.onPoll?.(body.data);
  }
  return null;
}
