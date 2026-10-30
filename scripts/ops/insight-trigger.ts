/**
 * 手动触发一次洞察加工(M34 批②→批③;M58 批① 增 translate):
 * npm run insight:run -- [embed|daily|fetch|translate]
 * @status ops
 * 入队 insight 队列同名 job(与调度同一路径;缺省 embed)。embed=向量回填+
 * 增量聚类(每轮批 200,存量多跑收敛);daily=LLM 打标+覆盖度+评分快照+fading;
 * fetch=热榜三源(百度/知乎/B站)拉取入池(日频 07:43 调度,手动用于验收补跑);
 * translate=补翻 pending 非中文信号 + 超时降级(10min 扫尾同路径,验收补跑)。
 * 前置:embed 需 admin 后台绑定 embedding 角色(向量);daily 需绑定「洞察归纳」
 * 角色,未绑定则打标跳过、机械段照跑;translate 需绑定「信号翻译」角色,
 * 未绑定则整轮跳过(保持 pending);fetch 无模型依赖。worker 进程在跑。
 */
import { loadEnvConfig } from "@next/env";

loadEnvConfig(process.cwd());

type InsightKind = "embed" | "daily" | "fetch" | "translate";

async function main(): Promise<void> {
  const arg = process.argv[2];
  const kind: InsightKind =
    arg === "daily" || arg === "fetch" || arg === "translate" ? arg : "embed";
  // queue 模块静态依赖 env(import 即校验):须等 loadEnvConfig 落好 process.env 再求值,动态 import 兜时序
  const q = await import("../../src/lib/queue");
  const jobName =
    kind === "daily"
      ? q.INSIGHT_JOB_DAILY
      : kind === "fetch"
        ? q.INSIGHT_JOB_FETCH
        : kind === "translate"
          ? q.INSIGHT_JOB_TRANSLATE
          : q.INSIGHT_JOB_EMBED;
  const queue = q.getQueue(q.QUEUE_INSIGHT);
  const job = await queue.add(jobName, {}, { jobId: `insight-manual-${kind}-${Date.now()}` });
  console.log(`已入队 insight job name=${jobName} id=${job.id},等待 worker 执行…`);
  const deadline = Date.now() + 30 * 60_000; // daily 含 LLM 分钟级,放宽到 30 分钟
  for (;;) {
    const state = await job.getState();
    if (state === "completed") {
      console.log(`完成:returnvalue=${JSON.stringify(job.returnvalue)}`);
      break;
    }
    if (state === "failed") {
      throw new Error(`执行失败:${job.failedReason ?? "(无失败原因)"}`);
    }
    if (Date.now() > deadline) {
      throw new Error("等待超时(30 分钟):检查 worker 进程是否在跑、模型绑定是否就绪");
    }
    await new Promise((r) => setTimeout(r, 2_000));
  }
  void queue.disconnect();
}

void main().catch((e) => {
  console.error("insight:run 失败:", e instanceof Error ? e.message : e);
  process.exit(1);
});
