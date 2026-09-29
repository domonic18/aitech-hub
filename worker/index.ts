import { Worker, type Processor } from "bullmq";

import { env } from "../src/lib/env";
import { QUEUE_NAMES, bullConnection } from "../src/lib/queue";

/**
 * BullMQ worker 进程独立入口(与 web 同镜像,SERVICE_ROLE=worker 启动,07 文档 §3)。
 * M1 仅骨架:建连 + 优雅退出;media-process 等处理器随 M5 媒体管线落地。
 */
function main(): void {
  const connection = bullConnection();
  const workers: Array<Worker> = [];

  for (const name of QUEUE_NAMES) {
    const notImplemented: Processor = async (job) => {
      // 各队列处理器在对应里程碑落地;当前到达任务记录后标记失败,避免静默吞任务
      throw new Error(
        `queue ${name} 的处理器尚未实现(job ${job.id},见 development-plan 对应里程碑)`,
      );
    };
    const w = new Worker(name, notImplemented, { connection });
    w.on("failed", (job, err) => {
      console.error(
        JSON.stringify({
          event: "worker.job.failed",
          queue: name,
          jobId: job?.id,
          error: err.message,
        }),
      );
    });
    workers.push(w);
  }

  console.log(
    JSON.stringify({
      event: "worker.started",
      queues: QUEUE_NAMES,
      redis: env.REDIS_URL.replace(/\/\/.*@/, "//***@"),
    }),
  );

  let closing = false;
  const shutdown = async (signal: string): Promise<void> => {
    if (closing) return;
    closing = true;
    console.log(JSON.stringify({ event: "worker.shutdown", signal }));
    await Promise.all(workers.map((w) => w.close()));
    connection.disconnect();
    process.exit(0);
  };
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));
}

main();
