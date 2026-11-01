/**
 * 在线用户 presence(M28 批②,requirement §3.5 扩展):承接旧站 WP statistics
 * 「当前在线人数 + 谁在线、停留在哪个页面」。纯 Redis ZSET 零新表:
 * member=`vhash|<u|g>:<标识>|path`(vhash 定长 32 hex 切片解析;标识第二段
 * `u:`/`g:` 前缀区分登录/访客,label 不含 '|'——写入侧已清洗;path 居末段,
 * 含 '|' 不受影响),score=最后活跃毫秒时间戳。标识:登录用户=用户名(缺省
 * 邮箱),未登录=明文 IP——仅存本内存键(5 分钟滑窗 + 键兜底 TTL 24h),
 * 不入任何表,仅 admin 统计页可见(2026-10-14 用户定调,承接 WP 展示口径)。
 * beacon 每次心跳顺带 ZADD + 5 分钟滑窗清理。读侧 getOnlinePresence 供
 * admin 统计页:窗口成员按 vhash 归并到「最后活跃页面」(每人只算一条)。
 * 入口在 service.ts ingestView(去 bot/管理员之后,fire-and-forget)。
 */
import { redis } from "@/lib/redis";

import { ONLINE_KEY, ONLINE_KEY_TTL_SECONDS } from "./keys";

/** 在线判定窗口:最后活跃 5 分钟内视为在线 */
const ONLINE_WINDOW_SECONDS = 300;

/** 标识上限(路由侧已截,此处防御性再截;防超长 label 撑大 ZSET member) */
const IDENT_MAX = 100;

export interface PresenceIdent {
  /** user=登录(用户名/邮箱);guest=未登录(IP) */
  kind: "user" | "guest";
  label: string;
}

/** 访客心跳:ZADD + 滑窗清理一管道原子发出;失败由调用方告警(可接受少计) */
export async function touchPresence(
  vhash: string,
  path: string,
  ident: PresenceIdent,
): Promise<void> {
  const now = Date.now();
  const cutoff = now - ONLINE_WINDOW_SECONDS * 1000;
  const label = ident.label.replace(/\|/g, "").slice(0, IDENT_MAX);
  const member = `${vhash}|${ident.kind === "user" ? "u" : "g"}:${label}|${path}`;
  await redis
    .pipeline()
    .zadd(ONLINE_KEY, now, member)
    .zremrangebyscore(ONLINE_KEY, "-inf", cutoff)
    .expire(ONLINE_KEY, ONLINE_KEY_TTL_SECONDS)
    .exec();
}

export interface OnlineVisitor {
  kind: "user" | "guest";
  /** 展示标识:用户名/邮箱或 IP;旧格式成员(升级过渡)为空串 */
  label: string;
  /** 最后活跃页面(每人归并一条) */
  path: string;
  /** 最后活跃毫秒时间戳 */
  lastActiveMs: number;
}

export interface OnlinePresence {
  /** 窗口内活跃访客数(去重) */
  total: number;
  /** 逐人列表,最后活跃在前 */
  visitors: OnlineVisitor[];
}

/** 在线快照:ZRANGEBYSCORE WITHSCORES 一次取全窗口成员(JS 侧归并,在线量级
 * 小;每人取 score 最大的成员即最后活跃页),Redis 故障向上抛由调用方兜底 */
export async function getOnlinePresence(): Promise<OnlinePresence> {
  const now = Date.now();
  const flat = await redis.zrangebyscore(
    ONLINE_KEY,
    now - ONLINE_WINDOW_SECONDS * 1000,
    "+inf",
    "WITHSCORES",
  );
  // flat = [member, score, ...];每人留最后活跃(score 最大)的一条
  const lastActive = new Map<string, OnlineVisitor & { score: number }>();
  for (let i = 0; i + 1 < flat.length; i += 2) {
    // member=`${vhash(32 hex)}|${u|g}:${label}|${path}`:定长切片取 vhash,
    // 余下按首个 '|' 切出标识段与路径段(path 含 '|' 落末段不受影响)
    const member = flat[i] as string;
    const score = Number(flat[i + 1]);
    const vhash = member.slice(0, 32);
    const rest = member.slice(33);
    const sep = rest.indexOf("|");
    let kind: OnlineVisitor["kind"] = "guest";
    let label = "";
    let path: string;
    if (sep === -1) {
      path = rest; // 旧格式 `vhash|path`(升级过渡 ≤24h,兜底按匿名空标识)
    } else {
      const identField = rest.slice(0, sep);
      path = rest.slice(sep + 1);
      kind = identField.startsWith("u:") ? "user" : "guest";
      label = identField.slice(2);
    }
    const prev = lastActive.get(vhash);
    if (!prev || score > prev.score) {
      lastActive.set(vhash, { kind, label, path, lastActiveMs: score, score });
    }
  }
  const visitors = [...lastActive.values()]
    .sort((a, b) => b.score - a.score)
    .map((v) => ({ kind: v.kind, label: v.label, path: v.path, lastActiveMs: v.lastActiveMs }));
  return { total: visitors.length, visitors };
}
