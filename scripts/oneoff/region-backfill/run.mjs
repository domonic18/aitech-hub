/**
 * 访客地区分布回填(2026-11-25 方案① 一期):把 stats_visit_log 7 天行级存量
 * 聚合进 stats_region_daily(完整历史日,不含当日——当日从部署时刻起由 ingest
 * 缓冲累计,无重叠无竞态)。地区解析与 src/lib/stats/ip-region.ts 同口径:
 * ip2region v4 XDB 内存查表,国内省级、境外国家级(空串);解析不到的行不
 * 归属(与 ingest 尽力而为口径一致,不入表)。
 *
 * 幂等:对覆盖日先 DELETE 再 INSERT,重跑结果一致;visit_log 已被 worker
 * 日清掉的历史日不在覆盖集内,不会被误删(ingest 写过的行安全)。
 *
 * @status oneoff(生产执行一次后删除本目录,git 历史存档)
 *
 * 用法(自包含 ESM,镜像内自带 prisma 客户端与 ip2region XDB,经 stdin 管道
 * 执行,不依赖仓库工作副本;node 以 /app 为 CWD 解析 node_modules):
 *   # 生产 dry-run(只读,打印将写入的行):
 *   ssh <prod> "sudo docker exec -i aitech-hub-prod-web-1 node --input-type=module" \
 *     < scripts/oneoff/region-backfill/run.mjs
 *   # 生产写库:
 *   ssh <prod> "sudo docker exec -i -e APPLY=1 aitech-hub-prod-web-1 node --input-type=module" \
 *     < scripts/oneoff/region-backfill/run.mjs
 *   # staging(本机容器同构):
 *   docker exec -i aitech-hub-staging-web-1 node --input-type=module \
 *     < scripts/oneoff/region-backfill/run.mjs
 */
import { PrismaClient } from "@prisma/client";
import { IP2Region } from "ip2region/node";

const APPLY = process.env.APPLY === "1";
const prisma = new PrismaClient();
const query = new IP2Region({ families: [4], mappedIPv6: "ipv4" });

/** 北京时区当日 YYYY-MM-DD(与 ingest 的 statsDay 同日界口径) */
function beijingToday() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai" }).format(new Date());
}

/** 与 ip-region.ts#regionPartsOf 同口径的本地实现:oneoff 走容器 stdin,
 *  不可 import TS 模块;口径漂移时先改 ip-region.ts 再同步此处 */
function resolveRegion(ip) {
  if (!ip) return null;
  try {
    const hit = query.lookup(ip);
    const country = hit?.country?.name;
    if (!country) return null;
    const province = hit?.subdivisions?.[0]?.name ?? "";
    return { country, province: country === "中国" ? province : "" };
  } catch {
    return null;
  }
}

async function main() {
  const today = beijingToday();
  const rows = await prisma.$queryRaw`
    SELECT ip, visitor_hash,
           to_char((created_at AT TIME ZONE 'Asia/Shanghai')::date, 'YYYY-MM-DD') AS d
    FROM stats_visit_log
    WHERE (created_at AT TIME ZONE 'Asia/Shanghai')::date < ${today}::date
    ORDER BY d`;

  const agg = new Map(); // `${d}|${country}|${province}` → {day, country, province, pv, visitors}
  const coveredDays = new Set();
  let unresolved = 0;
  for (const r of rows) {
    const parts = resolveRegion(r.ip);
    if (!parts) {
      unresolved++;
      continue;
    }
    coveredDays.add(r.d);
    const key = `${r.d}|${parts.country}|${parts.province}`;
    let e = agg.get(key);
    if (!e) {
      e = {
        day: r.d,
        country: parts.country,
        province: parts.province,
        pv: 0,
        visitors: new Set(),
      };
      agg.set(key, e);
    }
    e.pv += 1;
    e.visitors.add(r.visitor_hash);
  }

  const entries = [...agg.values()].sort((a, b) =>
    a.day === b.day ? b.pv - a.pv : a.day < b.day ? -1 : 1,
  );
  console.log(
    `覆盖日: ${[...coveredDays].join(", ") || "(无)"}; 明细行 ${rows.length}; 未解析 ${unresolved}`,
  );
  for (const e of entries) {
    console.log(`  ${e.day} ${e.country}|${e.province || "—"} pv=${e.pv} uv=${e.visitors.size}`);
  }

  if (!APPLY) {
    console.log("dry-run 未写库;确认无误后加 -e APPLY=1 重跑执行");
    await prisma.$disconnect();
    return;
  }

  const days = [...coveredDays];
  await prisma.$transaction([
    ...days.map(
      (d) => prisma.$executeRaw`DELETE FROM stats_region_daily WHERE stat_date = ${d}::date`,
    ),
    ...entries.map(
      (e) =>
        prisma.$executeRaw`INSERT INTO stats_region_daily (stat_date, country, province, pv, uv)
        VALUES (${e.day}::date, ${e.country}, ${e.province}, ${e.pv}, ${e.visitors.size})`,
    ),
  ]);
  console.log(`已写库:覆盖 ${days.length} 日、${entries.length} 行(覆盖日先删后插,幂等)`);
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
