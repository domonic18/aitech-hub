/**
 * AI 智能指数:刷新能力层冷启动种子(仓库快照)
 *
 * 真相源已迁到数据库(ai_index_eci_model 表),worker 每日从上游包同步;
 * 本脚本只在**运维需要更新仓库里的冷启动底稿**时手工跑一次
 * (npm run ai-index:fetch)——新环境部署时 worker boot 用这份底稿播种,
 * 不必等首次日采同步。
 *
 * 解析与校验与线上路径同源(src/lib/ai-index/epoch-source.ts),避免两套口径。
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

import { loadEnvConfig } from "@next/env";
import type { EciModel } from "../../../src/lib/ai-index/epoch-source";

loadEnvConfig(process.cwd());

const OUTPUT_PATH = "src/lib/ai-index/epoch-data.ts";

function generateTsFile(
  models: EciModel[],
  frontierCount: number,
  generatedAt: string,
  source: string,
  via: string,
): string {
  return `/**
 * AI 智能指数:Epoch AI Capabilities Index (ECI) 冷启动底稿
 * 本文件由 scripts/ops/ai-index/fetch-epoch-data.ts 自动生成(npm run ai-index:fetch)。
 * 线上真相源是数据库表 ai_index_eci_model(worker 每日同步);本文件只在
 * worker boot 冷启动播种时用一次(表空才播种),之后由日采接管。
 *
 * 数据来源:${source}(本次取数路径:${via})
 * 许可:CC BY 4.0(Epoch AI)
 * 生成时间:${generatedAt}
 */
export interface EpochEciModel {
  model: string;
  displayName: string;
  eci: number;
  ciLow: number;
  ciHigh: number;
  date: string;
  organization: string;
  country: string;
  accessibility: string;
  accessibilityGroup: string;
}

export const epochEciMeta = {
  source: "${source}",
  file: "${via}",
  license: "CC BY 4.0",
  generatedAt: ${JSON.stringify(generatedAt)},
  modelCount: ${models.length},
  frontierCount: ${frontierCount},
} as const;

export const epochEciModels: EpochEciModel[] = ${JSON.stringify(models, null, 2)};
`;
}

async function main(): Promise<void> {
  // epoch-source 依赖 env(出口代理配置),须等 loadEnvConfig 落好再动态 import
  const { ECI_CSV_URL, computeEciFrontier, fetchEpochDataset, validateEciDataset } =
    await import("../../../src/lib/ai-index/epoch-source");

  console.log(`Fetching ${ECI_CSV_URL}...`);
  const ds = await fetchEpochDataset();

  const validation = validateEciDataset(ds.models, null);
  if (!validation.ok) {
    console.error(`上游数据未通过校验:${validation.reason}`);
    process.exit(1);
  }

  const frontier = computeEciFrontier(ds.models);
  const generatedAt = new Date().toISOString();
  mkdirSync(dirname(OUTPUT_PATH), { recursive: true });
  writeFileSync(
    OUTPUT_PATH,
    generateTsFile(ds.models, frontier.length, generatedAt, ECI_CSV_URL, ds.source),
  );
  console.log(
    `Wrote ${OUTPUT_PATH} (${ds.models.length} models, ${frontier.length} frontier records)`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
