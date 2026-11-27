/**
 * AI 智能指数·能力层上游取数(Epoch AI Capabilities Index)
 *
 * 数据来源:Epoch 官方单发的 ECI 分数 CSV(约 31KB,含 90% 可信区间)。
 *   官方另发的整包 benchmark_data.zip(2.3MB)实测被限速到约 4KB/s,故不取整包。
 *
 * CSV 内容只在有新模型/新基准结果时才变——所以「有没有变」用**解析后的模型行
 * 规范化哈希**判定(不用原文字节,换行/空白/行序差异不算变更)。
 *
 * 本模块只做「取数 + 解析 + 校验闸门」,不写库(写侧在 src/lib/ai-index/sync.ts)。
 * 阈值与上游入口见 ./constants。
 */
import { createHash } from "node:crypto";

import { fetchViaEgress } from "@/lib/net/egress-fetch";

import {
  ECI_CSV_MAX_BYTES,
  ECI_CSV_URL,
  ECI_EARLIEST_DATE,
  ECI_FETCH_TIMEOUT_MS,
  ECI_FRONTIER_DROP_RATIO,
  ECI_MAX_ROWS,
  ECI_MIN_ROWS,
  ECI_MODEL_COUNT_DROP_RATIO,
  ECI_SCORE_MAX,
  ECI_SCORE_MIN,
  ECI_USER_AGENT,
} from "./constants";

const REQUIRED_HEADERS = [
  "model",
  "display_name",
  "eci",
  "eci_ci_low",
  "eci_ci_high",
  "date",
  "organization",
];

export interface EciModel {
  model: string;
  displayName: string;
  eci: number;
  ciLow: number;
  ciHigh: number;
  date: string; // YYYY-MM-DD
  organization: string;
  country: string;
  accessibility: string;
  accessibilityGroup: string;
}

/** 能力前沿轨迹:每刷新一次历史最高 ECI 就记一条 */
export interface EciFrontierPoint {
  date: string;
  eci: number;
  model: string;
  organization: string;
}

export interface EpochDataset {
  csv: string;
  models: EciModel[];
  contentHash: string;
  httpStatus: number;
}

export interface EciValidationInput {
  modelCount: number;
  frontierEci: number;
}

export type EciValidation = { ok: true } | { ok: false; reason: string };

function normalizeHeader(h: string): string {
  return h
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "_")
    .replace(/[^a-z0-9_]/g, "");
}

/** 引号感知的 CSV 解析(上游字段含逗号与引号,不能用 split) */
export function parseCsv(text: string): { headers: string[]; rows: string[][] } {
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

  if (rows.length === 0) return { headers: [], rows: [] };
  return { headers: rows[0].map(normalizeHeader), rows: rows.slice(1) };
}

function num(raw: string | undefined): number | null {
  if (raw === undefined || raw === null) return null;
  const cleaned = raw.replace(/,/g, "").trim();
  if (cleaned === "" || cleaned.toLowerCase() === "unknown") return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

/** 解析 CSV 为模型行(表头缺列时返回 null,由校验闸门判拒) */
export function parseEciCsv(text: string): EciModel[] | null {
  const { headers, rows } = parseCsv(text);
  if (headers.length === 0) return null;
  for (const h of REQUIRED_HEADERS) {
    if (!headers.includes(h)) return null;
  }

  const out: EciModel[] = [];
  for (const values of rows) {
    const row: Record<string, string> = {};
    headers.forEach((h, i) => {
      row[h] = values[i] ?? "";
    });
    const eci = num(row.eci);
    const date = (row.date ?? "").trim().slice(0, 10);
    if (eci === null || !/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
    const model = (row.model ?? "").trim();
    if (model === "") continue;
    const ciLow = num(row.eci_ci_low) ?? eci;
    const ciHigh = num(row.eci_ci_high) ?? eci;
    out.push({
      model,
      displayName: (row.display_name ?? model).trim() || model,
      eci,
      ciLow,
      ciHigh,
      date,
      organization: (row.organization ?? "unknown").trim() || "unknown",
      country: (row.country_of_organization ?? "").trim(),
      accessibility: (row.model_accessibility ?? "").trim(),
      accessibilityGroup: (row.accessibility_group ?? "").trim(),
    });
  }
  out.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : b.eci - a.eci));
  return out;
}

/** 能力前沿:按日期推进的历史最高 ECI */
export function computeEciFrontier(models: EciModel[]): EciFrontierPoint[] {
  const out: EciFrontierPoint[] = [];
  let max = -Infinity;
  for (const m of models) {
    if (m.eci > max) {
      max = m.eci;
      out.push({ date: m.date, eci: m.eci, model: m.displayName, organization: m.organization });
    }
  }
  return out;
}

/**
 * 校验闸门(纯函数):任一不过 → 拒收,保留库里的旧数据。
 * 只拒「跌」不拒「涨」——上游真出大突破不该被误拒;数据倒退(模型被删、前沿被改)
 * 才判上游异常。
 */
export function validateEciDataset(
  models: EciModel[],
  prev: EciValidationInput | null,
  now: Date = new Date(),
): EciValidation {
  if (models.length === 0) return { ok: false, reason: "CSV 未解析出任何模型行" };
  if (models.length > ECI_MAX_ROWS) {
    return { ok: false, reason: `模型行数 ${models.length} 超上限 ${ECI_MAX_ROWS}` };
  }
  if (models.length < ECI_MIN_ROWS) {
    return { ok: false, reason: `模型行数 ${models.length} 低于下限 ${ECI_MIN_ROWS}` };
  }

  const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  for (const m of models) {
    if (m.eci < ECI_SCORE_MIN || m.eci > ECI_SCORE_MAX) {
      return { ok: false, reason: `模型 ${m.model} 的 eci ${m.eci} 越界` };
    }
    if (m.ciLow > m.eci || m.ciHigh < m.eci) {
      return { ok: false, reason: `模型 ${m.model} 的可信区间不含分值` };
    }
    if (m.date < ECI_EARLIEST_DATE || m.date > tomorrow) {
      return { ok: false, reason: `模型 ${m.model} 的日期 ${m.date} 越界` };
    }
  }

  if (prev !== null) {
    if (models.length < prev.modelCount * ECI_MODEL_COUNT_DROP_RATIO) {
      return {
        ok: false,
        reason: `模型数 ${models.length} 较上次 ${prev.modelCount} 跌幅过大,判上游异常`,
      };
    }
    const frontier = computeEciFrontier(models);
    const frontierEci = frontier.length > 0 ? frontier[frontier.length - 1].eci : 0;
    if (frontierEci < prev.frontierEci * ECI_FRONTIER_DROP_RATIO) {
      return {
        ok: false,
        reason: `前沿 ECI ${frontierEci} 较上次 ${prev.frontierEci} 跌幅过大,判上游异常`,
      };
    }
  }

  return { ok: true };
}

/** 规范化哈希:同内容不同排版(换行/空白/行序)不应判成「上游变了」 */
export function hashEciModels(models: EciModel[]): string {
  const canonical = [...models]
    .sort((a, b) => (a.model < b.model ? -1 : a.model > b.model ? 1 : 0))
    .map((m) =>
      [
        m.model,
        m.displayName,
        m.eci,
        m.ciLow,
        m.ciHigh,
        m.date,
        m.organization,
        m.country,
        m.accessibility,
        m.accessibilityGroup,
      ].join("\u0001"),
    )
    .join("\u0002");
  return createHash("sha256").update(canonical).digest("hex");
}

/** 读 body 并累计体积上限(上游多数响应带 Content-Length,但不能只信它) */
async function readCapped(res: Response, maxBytes: number): Promise<Buffer> {
  const body = res.body;
  if (body === null) throw new Error("上游响应无 body");
  const reader = body.getReader();
  const chunks: Buffer[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value === undefined) continue;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      throw new Error(`上游响应超过体积上限 ${maxBytes} 字节`);
    }
    chunks.push(Buffer.from(value));
  }
  return Buffer.concat(chunks);
}

/** 下载上游 CSV 并解出模型行(不写库) */
export async function fetchEpochDataset(): Promise<EpochDataset> {
  const res = await fetchViaEgress(ECI_CSV_URL, {
    headers: { "user-agent": ECI_USER_AGENT, accept: "text/csv" },
    signal: AbortSignal.timeout(ECI_FETCH_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`上游返回 HTTP ${res.status}`);

  const csv = (await readCapped(res, ECI_CSV_MAX_BYTES)).toString("utf-8");
  const models = parseEciCsv(csv);
  if (models === null) throw new Error("上游 CSV 表头缺必需列");

  return {
    csv,
    models,
    contentHash: hashEciModels(models),
    httpStatus: res.status,
  };
}
