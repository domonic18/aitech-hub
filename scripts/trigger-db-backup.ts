/**
 * 手动触发一次数据库备份(M19 批②):npm run backup:run
 * 入队 db-backup 队列 run job(与每日 03:23 调度同一路径),worker 进程执行
 * pg_dump → 备份桶;本脚本只入队并轮询结果,便于验收/恢复演练不等 cron。
 * 前置:.env 配 COS_* 五项;worker 进程在跑(npm run worker / compose worker)。
 */
import { loadEnvConfig } from "@next/env";

import { DB_BACKUP_JOB_RUN, QUEUE_DB_BACKUP, getQueue } from "../src/lib/queue";

loadEnvConfig(process.cwd());

async function main(): Promise<void> {
  const queue = getQueue(QUEUE_DB_BACKUP);
  const job = await queue.add(DB_BACKUP_JOB_RUN, {}, { jobId: `db-backup-manual-${Date.now()}` });
  console.log(`已入队 db-backup job id=${job.id},等待 worker 执行…`);
  const deadline = Date.now() + 10 * 60_000;
  for (;;) {
    const state = await job.getState();
    if (state === "completed") {
      console.log(`备份完成:returnvalue=${JSON.stringify(job.returnvalue)}`);
      break;
    }
    if (state === "failed") {
      throw new Error(`备份失败:${job.failedReason ?? "(无失败原因)"}`);
    }
    if (Date.now() > deadline) {
      throw new Error("等待超时(10 分钟):检查 worker 进程是否在跑、COS_* 是否配置");
    }
    await new Promise((r) => setTimeout(r, 2_000));
  }
  void queue.disconnect();
}

void main().catch((e) => {
  console.error("backup:run 失败:", e instanceof Error ? e.message : e);
  process.exit(1);
});
