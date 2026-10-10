/**
 * 手动触发一次 embedding 对账(M20 批②):npm run embed:run
 * @status ops
 * 入队 embed-content 队列 reconcile job(与每 15 分钟调度同一路径);存量回填
 * (537 条)多跑几轮即收敛,每轮批 120 条。前置:admin 后台已绑定 embedding
 * 角色模型(智谱 embedding-3);worker 进程在跑。
 */
import { loadEnvConfig } from "@next/env";

loadEnvConfig(process.cwd());

async function main(): Promise<void> {
  // queue 模块静态依赖 env(import 即校验):须等 loadEnvConfig 落好 process.env 再求值,动态 import 兜时序
  const { EMBED_JOB_RECONCILE, QUEUE_EMBED, getQueue } = await import("../../src/lib/queue");
  const queue = getQueue(QUEUE_EMBED);
  const job = await queue.add(EMBED_JOB_RECONCILE, {}, { jobId: `embed-manual-${Date.now()}` });
  console.log(`已入队 embed-content job id=${job.id},等待 worker 执行…`);
  const deadline = Date.now() + 10 * 60_000;
  for (;;) {
    const state = await job.getState();
    if (state === "completed") {
      console.log(`对账完成:returnvalue=${JSON.stringify(job.returnvalue)}`);
      break;
    }
    if (state === "failed") {
      throw new Error(`对账失败:${job.failedReason ?? "(无失败原因)"}`);
    }
    if (Date.now() > deadline) {
      throw new Error("等待超时(10 分钟):检查 worker 进程是否在跑、embedding 模型是否已绑定");
    }
    await new Promise((r) => setTimeout(r, 2_000));
  }
  void queue.disconnect();
}

void main().catch((e) => {
  console.error("embed:run 失败:", e instanceof Error ? e.message : e);
  process.exit(1);
});
