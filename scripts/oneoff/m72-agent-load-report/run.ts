/**
 * M72 瘦身 B6 决策量测:agent(只读六件)的真实负载画像 —— 决定 deepagents
 * 该留、该换薄 tool-calling 循环、还是退到答案卡。
 *
 * 读 `ai_usage_log` 里 role=search_agent 的行(agent run 台账,逐 run 落一行):
 * 近 30 天与近 7 天各出一份 —— run 数、总/平均 tokens、平均耗时、失败率,
 * 并按 session 是否登录(admin vs 游客/访客)拆一份,看真实使用面。
 *
 * 纯读,不改任何数据;可在任意环境跑(默认读本地 env 的库)。
 *
 * @status oneoff(B6 决策后按结论删/留;git 历史存档)
 *
 * 用法:
 *   npx tsx scripts/oneoff/m72-agent-load-report/run.ts            # 默认 30 天
 *   npx tsx scripts/oneoff/m72-agent-load-report/run.ts --days 7
 */
import { loadEnvConfig } from "@next/env";

loadEnvConfig(process.cwd());

const daysArg = process.argv.indexOf("--days");
const DAYS = daysArg > -1 ? Number(process.argv[daysArg + 1]) : 30;

interface Window {
  days: number;
  runs: number;
  tokensIn: number;
  tokensOut: number;
  totalTokens: number;
  avgTokensPerRun: number;
  p50TokensPerRun: number;
  p90TokensPerRun: number;
  avgDurationMs: number;
  p50DurationMs: number;
  p90DurationMs: number;
  p95DurationMs: number;
  failed: number;
  degraded: number;
  failedRate: string;
  adminRuns: number;
  guestRuns: number;
}

/** 分位数(近邻法,样本量小时更贴近实际取值) */
function quantile(values: number[], q: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.floor(sorted.length * q));
  return sorted[idx];
}

async function main(): Promise<void> {
  const { prisma } = await import("../../../src/lib/db");
  try {
    const since = new Date(Date.now() - DAYS * 24 * 3600 * 1000);
    // admin/游客归属走 search_agent_session.visitor_id(admin 身份为
    // `admin:<userId>` 前缀)——ai_usage_log.session_id 存的是会话 id 本身,
    // 不能拿它的前缀判身份(首版脚本踩过这个坑,恒为 0)。
    const rows = await prisma.aiUsageLog.findMany({
      where: { role: "search_agent", createdAt: { gte: since } },
      select: {
        tokensIn: true,
        tokensOut: true,
        durationMs: true,
        status: true,
        sessionId: true,
        createdAt: true,
      },
      orderBy: { createdAt: "asc" },
    });
    const sessions = await prisma.searchAgentSession.findMany({
      select: { id: true, visitorId: true },
    });
    const visitorBySession = new Map(sessions.map((s) => [s.id, s.visitorId]));

    const summarize = (list: typeof rows, days: number): Window => {
      const durations = list.map((r) => r.durationMs).sort((a, b) => a - b);
      const tokensIn = list.reduce((s, r) => s + r.tokensIn, 0);
      const tokensOut = list.reduce((s, r) => s + r.tokensOut, 0);
      const total = tokensIn + tokensOut;
      const failed = list.filter((r) => r.status === "failed").length;
      const degraded = list.filter((r) => r.status === "degraded").length;
      const adminRuns = list.filter((r) =>
        (r.sessionId ? visitorBySession.get(r.sessionId) : undefined)?.startsWith("admin:"),
      ).length;
      const p95 = durations.length
        ? durations[Math.min(durations.length - 1, Math.floor(durations.length * 0.95))]
        : 0;
      return {
        days,
        runs: list.length,
        tokensIn,
        tokensOut,
        totalTokens: total,
        avgTokensPerRun: list.length ? Math.round(total / list.length) : 0,
        p50TokensPerRun: quantile(
          list.map((r) => r.tokensIn + r.tokensOut),
          0.5,
        ),
        p90TokensPerRun: quantile(
          list.map((r) => r.tokensIn + r.tokensOut),
          0.9,
        ),
        avgDurationMs: list.length
          ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length)
          : 0,
        p50DurationMs: quantile(
          list.map((r) => r.durationMs),
          0.5,
        ),
        p90DurationMs: quantile(
          list.map((r) => r.durationMs),
          0.9,
        ),
        p95DurationMs: p95,
        failed,
        degraded,
        failedRate: list.length ? `${((failed / list.length) * 100).toFixed(1)}%` : "0%",
        adminRuns,
        guestRuns: list.length - adminRuns,
      };
    };

    const last7 = rows.filter((r) => r.createdAt.getTime() >= Date.now() - 7 * 24 * 3600 * 1000);
    const out = {
      generatedAt: new Date().toISOString(),
      window30: summarize(rows, DAYS),
      window7: summarize(last7, 7),
      daily: Object.entries(
        rows.reduce<Record<string, number>>((acc, r) => {
          const d = r.createdAt.toISOString().slice(0, 10);
          acc[d] = (acc[d] ?? 0) + 1;
          return acc;
        }, {}),
      ).map(([date, runs]) => ({ date, runs })),
    };
    console.log(JSON.stringify(out, null, 2));
    console.log(
      "\n判读(B6 三选一):\n" +
        "  A. 保留 deepagents:run 数少但单轮重(平均 tokens 高)→ 换薄循环省不了多少,风险不值当\n" +
        "  B. 换薄 tool-calling 循环:run 数多且单轮轻(平均 tokens 低、耗时短)→ 薄循环收益大\n" +
        "  C. 只留答案卡 + 简化 Drawer:run 数极少 → 多轮 Drawer 无人用,砍掉省最多\n",
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
