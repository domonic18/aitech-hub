/**
 * AI 智能指数:手动补跑(npm run ai-index:run)
 * @status ops
 * worker 的 ai-index 队列每日 05:07(能力层 ECI 日采)/05:17(每日聚合)自动跑;
 * 本脚本是**补跑入口**——worker 停了、上游刚恢复、想立刻看到新数据时用。
 * 在当前进程直接跑(不经队列),不依赖 worker 存活。
 *
 * 用法:
 *   npm run ai-index:run         两步都跑(能力层日采 → 每日聚合)
 *   npm run ai-index:run eci     只跑能力层日采
 *   npm run ai-index:run daily   只跑每日聚合
 *   npm run ai-index:run daily 600  每日聚合,单轮打分 600 条(手动补跑积压时用)
 */
import { loadEnvConfig } from "@next/env";

loadEnvConfig(process.cwd());

async function main(): Promise<void> {
  const mode = process.argv[2] ?? "all";
  const { prisma } = await import("../../../src/lib/db");

  if (mode === "all" || mode === "eci") {
    const { syncEciFromUpstream } = await import("../../../src/lib/ai-index/sync");
    const r = await syncEciFromUpstream();
    console.log("能力层日采:", JSON.stringify(r));
    if (r.status === "failed" || r.status === "rejected") {
      throw new Error(`能力层日采未成功(${r.status}):${r.reason ?? "(无原因)"}`);
    }
  }

  if (mode === "all" || mode === "daily") {
    const { aggregateAiIndex } = await import("../../../src/lib/ai-index/aggregate");
    const batchLimit = Number.parseInt(process.argv[3] ?? "", 10);
    const r = await aggregateAiIndex(
      Number.isFinite(batchLimit) && batchLimit > 0 ? { batchLimit } : undefined,
    );
    console.log("每日聚合:", JSON.stringify(r));
  }

  await prisma.$disconnect();
}

void main().catch((e) => {
  console.error("ai-index:run 失败:", e instanceof Error ? e.message : e);
  process.exit(1);
});
