import { NextResponse } from "next/server";

import { prisma } from "@/lib/db";
import { redis } from "@/lib/redis";

export const dynamic = "force-dynamic";

/** 存活与健康探针:pg/redis 各 ping 一次;任一失败 503(compose healthcheck 与 CI 用) */
export async function GET(): Promise<NextResponse> {
  const [db, cache] = await Promise.allSettled([prisma.$queryRaw`SELECT 1`, redis.ping()]);

  const ok = (r: PromiseSettledResult<unknown>): boolean => r.status === "fulfilled";
  const body = {
    status: ok(db) && ok(cache) ? "ok" : "degraded",
    db: ok(db),
    redis: ok(cache),
    timestamp: new Date().toISOString(),
  };

  return NextResponse.json(body, { status: body.status === "ok" ? 200 : 503 });
}
