/**
 * 发现词库种子(M25 批①):渠道② 原型实证的 10 个 B站发现种子词落
 * discovery_keyword(origin=manual, status=active, confirmed_at=now)。
 * active 词即任务B 发现输入(discovery-plan §3),种子免人工确认直达 active。
 *
 * 归一:word 落库即归一形(trim+lower,方案 §3 口径,与任务A 联想词同规)。
 * 幂等:撞 word 唯一 = 已存在,跳过不动(不回改既有 status/origin)。
 *
 * @status oneoff(种子应用后删除本目录,git 历史存档)
 *
 * 用法:
 *   npx tsx scripts/oneoff/discovery-keyword-seed/run.ts            # dry-run(默认,只读)
 *   npx tsx scripts/oneoff/discovery-keyword-seed/run.ts --apply
 */
import { loadEnvConfig } from "@next/env";

loadEnvConfig(process.cwd());

/** 归一:trim + lower(注意 PG 非 C collation,大小写判断应用层统一走归一形) */
function normalizeWord(raw: string): string {
  return raw.trim().toLowerCase();
}

/** 原型实证种子词(discovery-plan §5;此处为展示词形,落库走归一形) */
const SEED_WORDS = [
  "Cursor 教程",
  "Claude Code 教程",
  "AI Agent 实战",
  "Dify 教程",
  "Coze 工作流",
  "MCP 开发",
  "n8n 教程",
  "LangChain 实战",
  "AI 编程",
  "大模型应用开发",
];

async function main(): Promise<void> {
  const apply = process.argv.includes("--apply");
  const { prisma } = await import("../../../src/lib/db");

  const words = [...new Set(SEED_WORDS.map(normalizeWord))];
  const existing = await prisma.discoveryKeyword.findMany({
    where: { word: { in: words } },
    select: { word: true, status: true, origin: true },
  });
  const existingSet = new Set(existing.map((r) => r.word));
  const pending = words.filter((w) => !existingSet.has(w));

  console.log(`===== 发现词库种子(${apply ? "apply" : "dry-run"})=====`);
  console.log(`种子词 ${words.length},已存在跳过 ${existing.length},待写入 ${pending.length}`);
  for (const r of existing) console.log(`  = ${r.word}(origin=${r.origin} status=${r.status})`);
  for (const w of pending) console.log(`  + ${w}`);

  if (!apply) {
    console.log("\ndry-run 未写库;确认后加 --apply 执行。");
    await prisma.$disconnect();
    return;
  }

  const now = new Date();
  const result = await prisma.discoveryKeyword.createMany({
    data: pending.map((word) => ({
      word,
      origin: "manual",
      status: "active",
      source: null,
      firstSeenAt: now,
      confirmedAt: now,
    })),
    skipDuplicates: true,
  });
  console.log(`\napply 完成:写入 ${result.count} 条;重跑应全量已存在跳过。`);
  await prisma.$disconnect();
}

void main().catch((e) => {
  console.error("种子失败:", e instanceof Error ? e.message : e);
  process.exit(1);
});
