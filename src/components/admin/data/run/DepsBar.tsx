/**
 * F20 依赖条:PostgreSQL / Redis / card-renderer / douyin-gateway 四依赖
 * 各 ping 一次(2s 超时),显延迟毫秒;不可达显「—」灰点不造假。两个
 * sidecar 走各自 GET /health(compose 网内服务名,dev 本地映射端口)。
 */
import { env } from "@/lib/env";
import { pingDb } from "@/lib/db";
import { redis } from "@/lib/redis";

interface Dep {
  name: string;
  ms: number | null;
}

async function timed(fn: () => Promise<unknown>): Promise<number | null> {
  const t0 = Date.now();
  try {
    await Promise.race([
      fn(),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error("timeout")), 2000)),
    ]);
    return Date.now() - t0;
  } catch {
    return null;
  }
}

async function fetchHealth(base: string): Promise<void> {
  const res = await fetch(new URL("/health", base), {
    signal: AbortSignal.timeout(2000),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(String(res.status));
}

export default async function DepsBar(): Promise<React.ReactElement> {
  const [pg, cache, renderer, gateway] = await Promise.all([
    timed(() => pingDb()),
    timed(() => redis.ping()),
    timed(() => fetchHealth(env.CARD_RENDERER_URL)),
    timed(() => fetchHealth(env.DOUYIN_GATEWAY_URL)),
  ]);
  const deps: Dep[] = [
    { name: "PostgreSQL", ms: pg },
    { name: "Redis", ms: cache },
    { name: "card-renderer", ms: renderer },
    { name: "douyin-gateway", ms: gateway },
  ];

  return (
    <div className="flex flex-wrap items-center gap-x-6 gap-y-1 rounded-md border border-line bg-panel px-4 py-2.5 text-xs">
      <span className="font-semibold text-text-2">依赖</span>
      {deps.map((d) => (
        <span key={d.name} className="flex items-center gap-1.5">
          <i
            className={`inline-block h-1.5 w-1.5 rounded-full ${d.ms === null ? "bg-line" : "bg-green"}`}
          />
          <span className="text-text-2">{d.name}</span>
          <span className={`font-mono ${d.ms === null ? "text-text-3" : "text-text-1"}`}>
            {d.ms === null ? "—" : `${d.ms}ms`}
          </span>
        </span>
      ))}
      <span className="ml-auto text-[10px] text-text-3">2s 超时 · 「—」= 不可达</span>
    </div>
  );
}
