/**
 * 迁移编排入口(03 文档 §10):
 *   npx tsx scripts/migrate-wp/run.ts                 # 全流程
 *   npx tsx scripts/migrate-wp/run.ts --dry-run       # extract+transform,不落库不拷媒体
 *   npx tsx scripts/migrate-wp/run.ts --phase=verify  # 单跑某阶段(extract/transform/media/load/verify)
 *   npx tsx scripts/migrate-wp/run.ts --phase=verify --http  # M3 后启用 HTTP 抽样
 */
import { extractAll } from "./extract";
import { runLoad } from "./load";
import { runMediaManifest } from "./media-manifest";
import { runTransform } from "./transform";
import { runVerify } from "./verify";

type Phase = "extract" | "transform" | "media" | "load" | "verify";

const argv = process.argv.slice(2);
const dryRun = argv.includes("--dry-run");
const http = argv.includes("--http");
const phaseArg = argv.find((a) => a.startsWith("--phase="))?.split("=")[1] as Phase | undefined;

const ORDER: Phase[] = ["extract", "transform", "media", "load", "verify"];
const phases: Phase[] = phaseArg ? [phaseArg] : dryRun ? ["extract", "transform"] : ORDER;

async function main(): Promise<void> {
  const started = Date.now();
  console.log(JSON.stringify({ event: "run.start", phases, dryRun }));

  for (const phase of phases) {
    const t0 = Date.now();
    switch (phase) {
      case "extract":
        await extractAll();
        break;
      case "transform":
        await runTransform();
        break;
      case "media":
        await runMediaManifest();
        break;
      case "load":
        if (dryRun) throw new Error("dry-run 不执行 load");
        await runLoad();
        break;
      case "verify": {
        const checks = await runVerify({ http });
        if (checks.some((c) => c.status === "FAIL")) process.exitCode = 1;
        break;
      }
    }
    console.log(JSON.stringify({ event: "run.phase.done", phase, ms: Date.now() - t0 }));
  }

  console.log(JSON.stringify({ event: "run.done", ms: Date.now() - started }));
}

main().catch((e) => {
  console.error(JSON.stringify({ event: "run.failed", error: String(e) }));
  process.exit(1);
});
