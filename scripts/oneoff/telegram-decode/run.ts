/**
 * 电报流存量标题实体解码(2026-10-09 验收反馈问题3 一次性清洗;ingest 层
 * 已加 decodeHtmlEntities,本脚本只修存量)。命中范围:title 含 HTML 实体
 * (命名/数字/十六进制)的 telegram 行 → 解码 + 按同构规则重算 content_hash
 * (sha1(解码标题小写 + \n + 已存 url)),防「新解码条目与旧编码条目」去重
 * 失效产生重复。新 hash 撞现有行则跳过该行并报告(人工裁决)。
 *
 * 自包含脚本:不用 @/ 别名(worker 容器无 tsconfig 解不开),PrismaClient
 * 直连;连接串只从 env 读,不打印。幂等:已无实体的行天然不命中。
 *
 * @status oneoff(生产存量清洗执行后删除本目录,git 历史存档)
 *
 * 用法:
 *   npx tsx scripts/oneoff/telegram-decode/run.ts           # dry-run(默认,只读)
 *   npx tsx scripts/oneoff/telegram-decode/run.ts --apply   # 写库
 */
import { createHash } from "node:crypto";

import { loadEnvConfig } from "@next/env";
import { PrismaClient } from "@prisma/client";

loadEnvConfig(process.cwd());

const prisma = new PrismaClient();

const ENTITIES: Record<string, string> = {
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&#39;": "'",
  "&apos;": "'",
  "&nbsp;": " ",
};

/** 与 src/lib/telegram/normalize.ts#decodeHtmlEntities 同构(改一处须同步另一处) */
function decodeHtmlEntities(text: string): string {
  if (!text.includes("&")) return text;
  return text
    .replace(/&(amp|lt|gt|quot|apos|nbsp);/g, (m) => ENTITIES[m] ?? m)
    .replace(/&#x?([0-9a-fA-F]+);/gi, (m, h: string) => {
      const n = /^&#x/i.test(m) ? Number.parseInt(h, 16) : Number(h);
      return n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : m;
    });
}

/** 与 normalize.ts#contentHash 同构(url 为库中已规范形态,原样使用) */
function contentHash(title: string, url: string): string {
  return createHash("sha1").update(`${title.trim().toLowerCase()}\n${url}`).digest("hex");
}

/** 标题含待解实体(命名常用集 / 数字 / 十六进制) */
function hasEntity(title: string): boolean {
  return /&(amp|lt|gt|quot|apos|nbsp);|&#x?[0-9a-fA-F]+;/.test(title);
}

async function main(): Promise<void> {
  const apply = process.argv.includes("--apply");
  const rows = await prisma.telegram.findMany({
    where: { title: { contains: "&" } },
    select: { id: true, title: true, url: true, contentHash: true },
  });
  const hits = rows.filter(
    (r): r is typeof r & { title: string } => !!r.title && hasEntity(r.title),
  );

  let changed = 0;
  let skipped = 0;
  for (const row of hits) {
    const decoded = decodeHtmlEntities(row.title).trim();
    if (decoded === row.title) continue;
    const nextHash = contentHash(decoded, row.url);
    if (nextHash !== row.contentHash) {
      const clash = await prisma.telegram.findFirst({
        where: { contentHash: nextHash },
        select: { id: true },
      });
      if (clash) {
        skipped += 1;
        console.log(`SKIP id=${row.id} 新 hash 与行 ${clash.id} 冲突:${decoded.slice(0, 60)}`);
        continue;
      }
    }
    changed += 1;
    console.log(`${apply ? "FIX" : "WOULDFIX"} id=${row.id}: ${row.title.slice(0, 70)}`);
    console.log(`  -> ${decoded.slice(0, 70)}`);
    if (apply) {
      await prisma.telegram.update({
        where: { id: row.id },
        data: { title: decoded, contentHash: nextHash },
      });
    }
  }
  console.log(
    `\n扫描含 & 标题 ${rows.length} 行,含实体 ${hits.length} 行,可解码 ${changed} 行${
      skipped ? `,hash 冲突跳过 ${skipped} 行` : ""
    }${apply ? "" : "(dry-run,未写库;--apply 生效)"}`,
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => process.exit(0)); // Prisma 连接池挂起,显式退出(容器探针惯例)
