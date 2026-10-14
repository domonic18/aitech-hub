/**
 * 在线用户 presence(M28 批②,requirement §3.5 扩展):承接旧站 WP statistics
 * 「当前在线人数 + 停留在哪个页面」。纯 Redis ZSET 零新表:member=`vhash|path`
 * (vhash 定长 32 hex,切片解析不受 path 内容影响),score=最后活跃毫秒时间戳;
 * beacon 每次心跳顺带 ZADD + 5 分钟滑窗清理(键兜底 TTL 24h 防长期无人访问
 * 残留)。读侧 getOnlinePresence 供 admin 统计页:活动窗口成员按 vhash 归并
 * 到「最后活跃页面」(每人只算一个页面,与 WP 同语义),页面分布=按路径计数。
 * 入口在 service.ts ingestView(去 bot/管理员之后,fire-and-forget)。
 */
import { redis } from "@/lib/redis";

/** 在线判定窗口:最后活跃 5 分钟内视为在线 */
const ONLINE_WINDOW_SECONDS = 300;
/** 键兜底 TTL(窗口清理常态生效;长期无流量时靠它自清) */
const ONLINE_KEY_TTL_SECONDS = 86_400;
const KEY = "stats:online";

/** 访客心跳:ZADD + 滑窗清理一管道原子发出;失败由调用方告警(可接受少计) */
export async function touchPresence(vhash: string, path: string): Promise<void> {
  const now = Date.now();
  const cutoff = now - ONLINE_WINDOW_SECONDS * 1000;
  await redis
    .pipeline()
    .zadd(KEY, now, `${vhash}|${path}`)
    .zremrangebyscore(KEY, "-inf", cutoff)
    .expire(KEY, ONLINE_KEY_TTL_SECONDS)
    .exec();
}

export interface OnlinePresence {
  /** 窗口内活跃访客数(去重) */
  total: number;
  /** 停留页面分布(每人归并到最后活跃页;按人数降序) */
  pages: { path: string; users: number }[];
}

/** 在线快照:ZRANGEBYSCORE WITHSCORES 一次取全窗口成员(JS 侧归并,在线量级
 * 小;每人取 score 最大的成员即最后活跃页),Redis 故障向上抛由调用方兜底 */
export async function getOnlinePresence(): Promise<OnlinePresence> {
  const now = Date.now();
  const flat = await redis.zrangebyscore(
    KEY,
    now - ONLINE_WINDOW_SECONDS * 1000,
    "+inf",
    "WITHSCORES",
  );
  // flat = [member, score, ...];每人留最后活跃(score 最大)的页面
  const lastPage = new Map<string, { path: string; score: number }>();
  for (let i = 0; i + 1 < flat.length; i += 2) {
    // member 形如 `${vhash(32 hex)}|${path}`;定长前缀切片,path 含 '|' 也不受影响
    const member = flat[i] as string;
    const score = Number(flat[i + 1]);
    const vhash = member.slice(0, 32);
    const path = member.slice(33);
    const prev = lastPage.get(vhash);
    if (!prev || score > prev.score) lastPage.set(vhash, { path, score });
  }
  const byPath = new Map<string, number>();
  for (const { path } of lastPage.values()) {
    byPath.set(path, (byPath.get(path) ?? 0) + 1);
  }
  const pages = [...byPath.entries()]
    .map(([path, users]) => ({ path, users }))
    .sort((a, b) => b.users - a.users || a.path.localeCompare(b.path));
  return { total: lastPage.size, pages };
}
