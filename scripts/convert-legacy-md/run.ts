/**
 * 旧文 contentMd 批量回填(M5-d;用户反馈:WP 迁移文只有 contentHtml,后台只读不可编):
 *   npx tsx --env-file=.env scripts/convert-legacy-md/run.ts --dry-run    # 不写库,打印 5 篇样例
 *   npx tsx --env-file=.env scripts/convert-legacy-md/run.ts --limit=5    # 先小批试跑
 *   npx tsx --env-file=.env scripts/convert-legacy-md/run.ts              # 全量(154 篇)
 * 纪律:只 set content_md,不动 content_html —— 回滚 = 清空 content_md 即还原 HTML
 * 渲染链;幂等(content_md 非空跳过);前台 ISR 600s 自然过渡,无需手动 revalidate。
 */
import { loadEnvConfig } from "@next/env";

loadEnvConfig(process.cwd());
// pino 在模块导入时读 LOG_LEVEL,须先静音再引 db
process.env.LOG_LEVEL = "silent";

import { prisma } from "../../src/lib/db";
import { convertHtmlToMd, createConverter } from "./convert";

const argv = process.argv.slice(2);
const dryRun = argv.includes("--dry-run");
const limitArg = argv.find((a) => a.startsWith("--limit="));

const SAMPLE_COUNT = 5;
const SAMPLE_HEAD_CHARS = 400;
const IMG_REF_RE = /!\[[^\]]*\]\([^)]+\)/g;

async function main(): Promise<void> {
  const posts = await prisma.post.findMany({
    where: { wpPostId: { not: null }, contentMd: null },
    select: { id: true, title: true, contentHtml: true },
    orderBy: { id: "asc" },
    ...(limitArg ? { take: Number(limitArg.split("=")[1]) } : {}),
  });
  console.log(JSON.stringify({ event: "convert.start", total: posts.length, dryRun }));

  const td = createConverter();
  let converted = 0;
  let noHtml = 0;
  let warned = 0;
  let mdChars = 0;
  let imgRefs = 0;
  const samples: Array<{ id: string; title: string; head: string }> = [];

  for (const p of posts) {
    if (!p.contentHtml) {
      noHtml += 1;
      console.log(JSON.stringify({ event: "convert.skip", id: p.id.toString(), title: p.title }));
      continue;
    }
    const { contentMd, warnings } = convertHtmlToMd(td, p.contentHtml);
    converted += 1;
    mdChars += contentMd.length;
    imgRefs += (contentMd.match(IMG_REF_RE) ?? []).length;
    if (warnings.length > 0) {
      warned += 1;
      console.log(JSON.stringify({ event: "convert.warn", id: p.id.toString(), warnings }));
    }
    if (samples.length < SAMPLE_COUNT) {
      samples.push({
        id: p.id.toString(),
        title: p.title,
        head: contentMd.slice(0, SAMPLE_HEAD_CHARS),
      });
    }
    if (!dryRun) {
      await prisma.post.update({ where: { id: p.id }, data: { contentMd } });
    }
  }

  console.log(
    JSON.stringify({
      event: "convert.done",
      total: posts.length,
      converted,
      noHtml,
      warned,
      mdChars,
      imgRefs,
      dryRun,
    }),
  );
  for (const s of samples) {
    console.log(
      `\n===== #${s.id} ${s.title} =====\n${s.head}${s.head.length >= SAMPLE_HEAD_CHARS ? " …" : ""}`,
    );
  }
  await prisma.$disconnect();
}

void main();
