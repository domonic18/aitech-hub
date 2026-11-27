/**
 * AI 智能指数:抓取 Epoch AI 公开数据包并生成前端可用数据
 * 长期运维脚本(npm run ai-index:fetch),不进入 worker。
 *
 * 数据来源:https://epoch.ai/data/benchmark_data.zip (CC BY 4.0)
 *   压缩包内含 epoch_capabilities_index/eci_scores.csv —— Epoch 官方预计算的
 *   Capabilities Index (ECI) 分数,含 90% 可信区间。
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

const ZIP_URL = "https://epoch.ai/data/benchmark_data.zip";
const OUTPUT_PATH = "src/lib/ai-index/epoch-data.ts";
const ECI_CSV_IN_ZIP = "epoch_capabilities_index/eci_scores.csv";

interface RawRow {
  [key: string]: string | undefined;
}

interface EciModel {
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

interface EciRecord {
  date: string;
  eci: number;
  model: string;
  organization: string;
}

interface EciYearly {
  year: number;
  modelCount: number;
  frontierEci: number;
  frontierModel: string;
  top3AvgEci: number;
  medianEci: number;
  meanEci: number;
  openWeightsFrontierEci: number | null;
  organizationCount: number;
}

function normalizeHeader(h: string): string {
  return h
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "_")
    .replace(/[^a-z0-9_]/g, "");
}

function parseCsv(text: string): RawRow[] {
  const rows: string[][] = [];
  let fields: string[] = [];
  let field = "";
  let inQuotes = false;
  let i = 0;

  while (i < text.length) {
    const char = text[i];
    const next = text[i + 1];

    if (inQuotes) {
      if (char === '"' && next === '"') {
        field += '"';
        i += 2;
      } else if (char === '"') {
        inQuotes = false;
        i += 1;
      } else {
        field += char;
        i += 1;
      }
    } else {
      if (char === '"') {
        inQuotes = true;
        i += 1;
      } else if (char === ",") {
        fields.push(field);
        field = "";
        i += 1;
      } else if (char === "\n" || char === "\r") {
        if (field !== "" || fields.length > 0) {
          fields.push(field);
          rows.push(fields);
          fields = [];
          field = "";
        }
        i += 1;
      } else {
        field += char;
        i += 1;
      }
    }
  }

  if (field !== "" || fields.length > 0) {
    fields.push(field);
    rows.push(fields);
  }

  if (rows.length === 0) return [];
  const headers = rows[0].map(normalizeHeader);
  return rows.slice(1).map((values) => {
    const row: RawRow = {};
    headers.forEach((h, i) => {
      row[h] = values[i] ?? "";
    });
    return row;
  });
}

function num(raw: string | undefined): number | null {
  if (raw === undefined || raw === null) return null;
  const cleaned = raw.replace(/,/g, "").trim();
  if (cleaned === "" || cleaned.toLowerCase() === "unknown") return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

function cleanRows(rows: RawRow[]): EciModel[] {
  const out: EciModel[] = [];
  for (const r of rows) {
    const eci = num(r.eci);
    const date = (r.date ?? "").trim();
    if (eci === null || date === "") continue;
    const model = (r.model ?? r.display_name ?? "unknown").trim();
    out.push({
      model,
      displayName: (r.display_name ?? model).trim(),
      eci,
      ciLow: num(r.eci_ci_low) ?? eci,
      ciHigh: num(r.eci_ci_high) ?? eci,
      date: date.slice(0, 10),
      organization: (r.organization ?? "unknown").trim(),
      country: (r.country_of_organization ?? "").trim(),
      accessibility: (r.model_accessibility ?? "").trim(),
      accessibilityGroup: (r.accessibility_group ?? "").trim(),
    });
  }
  return out.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : b.eci - a.eci));
}

/** 逐模型推进的「能力前沿」:每刷新一次历史最高 ECI 就记一条 */
function computeRecords(models: EciModel[]): EciRecord[] {
  const records: EciRecord[] = [];
  let max = -Infinity;
  for (const m of models) {
    if (m.eci > max) {
      max = m.eci;
      records.push({
        date: m.date,
        eci: m.eci,
        model: m.displayName || m.model,
        organization: m.organization,
      });
    }
  }
  return records;
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 0 ? (s[mid - 1] + s[mid]) / 2 : s[mid];
}

function aggregateByYear(models: EciModel[]): EciYearly[] {
  const byYear = new Map<number, EciModel[]>();
  for (const m of models) {
    const year = Number(m.date.slice(0, 4));
    if (!Number.isFinite(year)) continue;
    const list = byYear.get(year) ?? [];
    list.push(m);
    byYear.set(year, list);
  }

  return Array.from(byYear.entries())
    .sort((a, b) => a[0] - b[0])
    .map(([year, list]) => {
      const ecis = list.map((m) => m.eci).sort((a, b) => b - a);
      const frontier = list.reduce((best, m) => (m.eci > best.eci ? m : best), list[0]);
      const openWeights = list.filter((m) => m.accessibilityGroup.includes("Open weights"));
      const openFrontier =
        openWeights.length > 0
          ? openWeights.reduce((best, m) => (m.eci > best.eci ? m : best), openWeights[0]).eci
          : null;
      return {
        year,
        modelCount: list.length,
        frontierEci: frontier.eci,
        frontierModel: frontier.displayName || frontier.model,
        top3AvgEci: Number(
          (ecis.slice(0, 3).reduce((s, e) => s + e, 0) / Math.min(3, ecis.length)).toFixed(2),
        ),
        medianEci: Number(median(ecis).toFixed(2)),
        meanEci: Number((ecis.reduce((s, e) => s + e, 0) / ecis.length).toFixed(2)),
        openWeightsFrontierEci: openFrontier === null ? null : Number(openFrontier.toFixed(2)),
        organizationCount: new Set(list.map((m) => m.organization)).size,
      };
    });
}

function generateTsFile(
  models: EciModel[],
  records: EciRecord[],
  yearly: EciYearly[],
  generatedAt: string,
): string {
  return `/**
 * AI 智能指数:Epoch AI Capabilities Index (ECI) 公开数据
 * 本文件由 scripts/ops/ai-index/fetch-epoch-data.ts 自动生成(npm run ai-index:fetch)。
 * Epoch 数据包更新后重新生成并提交,快照入库以免构建期依赖外网。
 *
 * 数据来源:https://epoch.ai/data/benchmark_data.zip → epoch_capabilities_index/eci_scores.csv
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

/** 每刷新一次历史最高 ECI 的模型(能力前沿轨迹) */
export interface EpochEciRecord {
  date: string;
  eci: number;
  model: string;
  organization: string;
}

export interface EpochEciYearly {
  year: number;
  modelCount: number;
  frontierEci: number;
  frontierModel: string;
  top3AvgEci: number;
  medianEci: number;
  meanEci: number;
  openWeightsFrontierEci: number | null;
  organizationCount: number;
}

export const epochEciMeta = {
  source: "https://epoch.ai/data/benchmark_data.zip",
  file: "${ECI_CSV_IN_ZIP}",
  license: "CC BY 4.0",
  generatedAt: ${JSON.stringify(generatedAt)},
  modelCount: ${models.length},
} as const;

export const epochEciModels: EpochEciModel[] = ${JSON.stringify(models, null, 2)};

export const epochEciRecords: EpochEciRecord[] = ${JSON.stringify(records, null, 2)};

export const epochEciYearly: EpochEciYearly[] = ${JSON.stringify(yearly, null, 2)};
`;
}

async function main(): Promise<void> {
  console.log(`Fetching ${ZIP_URL}...`);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 120_000);
  const res = await fetch(ZIP_URL, { signal: controller.signal });
  clearTimeout(timeout);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const zipBuffer = Buffer.from(await res.arrayBuffer());
  console.log(`Downloaded ${(zipBuffer.length / 1024 / 1024).toFixed(2)} MB`);

  const workDir = mkdtempSync(join(tmpdir(), "epoch-eci-"));
  try {
    const zipPath = join(workDir, "benchmark_data.zip");
    writeFileSync(zipPath, zipBuffer);
    execFileSync("unzip", ["-o", "-q", zipPath, "-d", workDir], { stdio: "pipe" });

    const csvPath = join(workDir, ECI_CSV_IN_ZIP);
    const csv = readFileSync(csvPath, "utf-8");
    const rows = parseCsv(csv);
    console.log(`Parsed ${rows.length} rows from ${ECI_CSV_IN_ZIP}`);

    const models = cleanRows(rows);
    const records = computeRecords(models);
    const yearly = aggregateByYear(models);
    const generatedAt = new Date().toISOString();

    mkdirSync(dirname(OUTPUT_PATH), { recursive: true });
    writeFileSync(OUTPUT_PATH, generateTsFile(models, records, yearly, generatedAt));
    console.log(
      `Wrote ${OUTPUT_PATH} (${models.length} models, ${records.length} frontier records)`,
    );
    console.log("Yearly:", yearly);
  } finally {
    rmSync(workDir, { recursive: true, force: true });
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
