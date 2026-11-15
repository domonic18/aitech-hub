/**
 * 阿里云百炼按量模型牌价(M74 批B2):静态取数 + DOM 解析。
 *
 * 实探结论(2026-11-15):价在 `help.aliyun.com/zh/model-studio/billing` 的
 * `window.__ICE_PAGE_PROPS__` → `docDetailData.storeData.data.content` 里
 * (阿里云文档站的 ICE SSR 载荷),**静态 fetch 即可**,不需要 headless。
 *
 * 页面的异构性(80 种表头):列语义随表而变,故按**表头关键词**映射到语义槽位,
 * 而不是逐表硬编码:
 * - 模型 ID(表头「模型 ID(Model ID)」)——格内首段是模型 id,后面跟官方附注
 * - 服务部署范围(全球 / 美国 / 国际)——**同一模型按部署地有不同价**
 * - 模式(非思考和思考模式 / 仅思考模式 / 仅非思考模式)
 * - 单次请求的输入 Token 数(0<Token≤1M 等阶梯区间)
 * - 输入单价 / 缓存命中输入单价 / 输出单价(口径「每百万Token」)
 * - 免费额度(原文)
 *
 * 只收**每百万 Token 口径**的表;视频分辨率表、按秒/按张计价的表一律排除
 * (口径不可比,混进比价表就是污染)。
 *
 * 归一口径:一个模型 = 一行 model_pricing,**(部署范围 × 模式 × Token 区间)**
 * 各组合落一条档位(部署范围/模式/区间都是价格维度,不是不同模型);
 * 行价取「全球」档(站点面向国内用户;没有全球档时取第一条)——
 * 与「多时段价取最高」同一原则:行价是**基准价**,不是最便宜的那一档。
 */
import * as cheerio from "cheerio";

import type { ModelPrefillRow, ModelTierPrefill } from "../crawlers";

/** 官方计费页(种子初始值;运行期 URL 归 crawl_source 后台可调) */
export const BAILIAN_MODEL_PRICING_URL = "https://help.aliyun.com/zh/model-studio/billing";

/** 列语义槽位 */
type ColRole =
  "model" | "scope" | "mode" | "tokenRange" | "input" | "cache" | "output" | "free" | null;

/** 表头 → 列语义(按关键词;顺序即列序) */
function colRoleOf(header: string): ColRole {
  const h = header.replace(/\s+/g, "");
  if (h.includes("模型ID")) return "model";
  if (h.includes("服务部署范围")) return "scope";
  if (h === "模式" || h.startsWith("模式")) return "mode";
  if (h.includes("Token数") || h.includes("Token范围")) return "tokenRange";
  if (h.includes("免费额度")) return "free";
  if (h.includes("缓存命中")) return "cache";
  if (h.includes("输入单价")) return "input";
  if (h.includes("输出单价")) return "output";
  return null;
}

/** 表头含这些词 → 整表排除(口径不可比:视频分辨率表 / 输入输出同价 / 非 token 计价) */
// 注:排除词要精确——「次」会误伤「单次请求的输入Token数」(主流表的阶梯列)
const EXCLUDE_HEADER_HINTS = ["分辨率", "输入和输出单价", "每秒", "每张", "每分钟", "元/次"];

/** 「12元」/「14.988元」/「原价2元（限时8折）」→ 数值(null = 无法解析) */
function priceOf(text: string): number | null {
  const m = /([\d.]+)\s*元/.exec(text);
  return m === null ? null : Number(m[1]);
}

/** 「0<Token≤1M」→ {min, max}(token 数);不可解析 → null */
function tokenRangeOf(text: string): { min: number | null; max: number | null } {
  const toNum = (s: string): number | null => {
    const m = /^([\d.]+)([KkMm])?$/.exec(s.trim());
    if (m === null) return null;
    const v = Number(m[1]);
    const unit = (m[2] ?? "").toLowerCase();
    if (unit === "k") return v * 1024;
    if (unit === "m") return v * 1024 * 1024;
    return v;
  };
  const m = /([\d.]+[KkMm]?)\s*<\s*Token\s*≤\s*([\d.]+[KkMm]?)/.exec(text);
  if (m === null) return { min: null, max: null };
  return { min: toNum(m[1] ?? ""), max: toNum(m[2] ?? "") };
}

/** 模型 id:格内首段(官方附注在后面,用空格分隔) */
function modelIdOf(cellText: string): string {
  const m = /^([A-Za-z0-9][A-Za-z0-9._-]*)/.exec(cellText.trim());
  return m === null ? "" : (m[1] ?? "");
}

/** ICE 载荷 → content HTML(拿不到抛错:页面改版) */
export function bailianContentOf(html: string): string {
  const m = /window\.__ICE_PAGE_PROPS__=(\{[\s\S]*?\});?\s*<\/script>/.exec(html);
  if (m === null) throw new Error("bailuan ICE 载荷未匹配(页面可能改版)");
  try {
    const parsed = JSON.parse(m[1]) as {
      docDetailData?: { storeData?: { data?: { content?: string } } };
    };
    const content = parsed.docDetailData?.storeData?.data?.content;
    if (typeof content !== "string" || content === "") {
      throw new Error("bailuan ICE 载荷里没有 content");
    }
    return content;
  } catch (e) {
    throw new Error(`bailuan ICE 载荷解析失败: ${e instanceof Error ? e.message : String(e)}`);
  }
}

/** 单行表记录 */
interface BailianRow {
  modelId: string;
  note: string;
  scope: string | null;
  mode: string | null;
  tokenRange: string | null;
  input: number | null;
  cache: number | null;
  output: number | null;
  free: string | null;
}

/** 档位标签:部署范围 · 模式 · Token 区间(缺省项不拼) */
function tierLabelOf(row: BailianRow): string {
  const parts = [row.scope, row.mode, row.tokenRange].filter((v) => v !== null && v !== "");
  return parts.length === 0 ? "默认" : parts.join("·");
}

/** 百炼计费页解析(纯函数,fixture 单测锚) */
export function parseBailianModels(html: string, sourceUrl: string, now: Date): ModelPrefillRow[] {
  const content = bailianContentOf(html);
  const $ = cheerio.load(content);
  const records: BailianRow[] = [];

  $("table").each((_, t) => {
    const trs = $(t).find("tr");
    const headers = trs
      .first()
      .children()
      .map((_, c) => $(c).text().trim().replace(/\s+/g, " "))
      .get();
    const joined = headers.join(" ");
    if (headers.length < 2) return;
    // 非每百万 Token 口径的表(视频分辨率/按秒按张/输入输出同价)一律排除
    if (EXCLUDE_HEADER_HINTS.some((hint) => joined.includes(hint))) return;
    if (!joined.includes("每百万Token") && !joined.includes("每百万 Token")) return;

    const roles = headers.map(colRoleOf);
    if (!roles.includes("model")) return;
    if (!roles.includes("input") && !roles.includes("output")) return;

    // **整表行列对齐闸**:百炼多模态/音视频表是「多级表头 + 模态子维度」
    // (表头 4 列、数据行 6 格:文本/图片/视频、音频、文本多模态、仅音频计费),
    // 按列序映射会**错位取价**(把「音频输入价」当输出价)。这类表整体不收——
    // 宁可少收,不可错收(错价比缺价危害大得多)。
    const dataRows = trs
      .slice(1)
      .toArray()
      .filter((r) => r.children && r.children.length > 0);
    if (dataRows.length === 0) return;
    if (!dataRows.every((r) => r.children.length === headers.length)) return;

    dataRows.forEach((r) => {
      const cells = r.children.map((c) => $(c).text().trim().replace(/\s+/g, " "));
      if (cells.length === 0) return;
      const rec: BailianRow = {
        modelId: "",
        note: "",
        scope: null,
        mode: null,
        tokenRange: null,
        input: null,
        cache: null,
        output: null,
        free: null,
      };
      cells.forEach((text, i) => {
        switch (roles[i]) {
          case "model":
            rec.modelId = modelIdOf(text);
            rec.note = text.trim();
            break;
          case "scope":
            rec.scope = text === "" ? null : text;
            break;
          case "mode":
            rec.mode = text === "" ? null : text;
            break;
          case "tokenRange":
            rec.tokenRange = text === "" ? null : text;
            break;
          case "input":
            rec.input = priceOf(text);
            break;
          case "cache":
            rec.cache = priceOf(text);
            break;
          case "output":
            rec.output = priceOf(text);
            break;
          case "free":
            rec.free = text === "" || text === "无" ? null : text;
            break;
          default:
            break;
        }
      });
      if (rec.modelId !== "") records.push(rec);
    });
  });

  if (records.length === 0) throw new Error("bailuan 价格表未匹配(页面可能改版)");

  // 按模型归一:一行一模型,维度组合落档位
  const byModel = new Map<string, BailianRow[]>();
  for (const rec of records) {
    const list = byModel.get(rec.modelId);
    if (list === undefined) byModel.set(rec.modelId, [rec]);
    else list.push(rec);
  }

  const out: ModelPrefillRow[] = [];
  for (const [modelId, rows] of byModel) {
    const tiers: ModelTierPrefill[] = [];
    for (const rec of rows) {
      const range = tokenRangeOf(rec.tokenRange ?? "");
      const label = tierLabelOf(rec);
      const tier: ModelTierPrefill = {
        tierLabel: label,
        inputPrice: rec.input,
        outputPrice: rec.output,
        cachePrice: rec.cache,
        minTokens: range.min,
        maxTokens: range.max,
        unit: "per_1m_tokens",
      };
      // 档位唯一键是 (牌价行, 标签):同名同价是同一事实(两张表重复列)→ 去重;
      // 同名不同价 → 加序号区分(否则落库撞唯一键)
      const dup = tiers.find((t) => t.tierLabel === tier.tierLabel);
      if (dup !== undefined) {
        if (
          dup.inputPrice === tier.inputPrice &&
          dup.outputPrice === tier.outputPrice &&
          dup.cachePrice === tier.cachePrice
        ) {
          continue;
        }
        let n = 2;
        while (tiers.some((t) => t.tierLabel === `${label}·${n}`)) n += 1;
        tier.tierLabel = `${label}·${n}`;
      }
      tiers.push(tier);
    }
    // 「无部署范围」档位与「全球」档同价时去重:百炼有些表不带部署范围列,
    // 与带列的「全球」行是同一事实的两种表式(不做此去重会重复展示同一价)
    const globalTier = tiers.find((t) => t.tierLabel.startsWith("全球·"));
    if (globalTier !== undefined) {
      const same = (t: ModelTierPrefill): boolean =>
        t.inputPrice === globalTier.inputPrice &&
        t.outputPrice === globalTier.outputPrice &&
        t.cachePrice === globalTier.cachePrice;
      const kept = tiers.filter((t) => t.tierLabel.startsWith("全球·") || !same(t));
      tiers.length = 0;
      tiers.push(...kept);
    }
    // 行价取「全球」档(国内用户口径);没有全球档则取第一条有价的
    const base =
      rows.find((r) => r.scope === "全球") ??
      rows.find((r) => r.input !== null || r.output !== null) ??
      rows[0]!;
    out.push({
      vendor: "阿里云百炼",
      modelKey: modelId,
      currency: "CNY",
      inputPrice: base.input,
      outputPrice: base.output,
      contextWindow: null,
      note: `[官方页爬虫 ${now.toISOString().slice(0, 10)}] ${base.note}`,
      dataAsOf: now,
      sourceUrl,
      region: "cn",
      providerKey: "aliyun-bailian",
      freeTier: rows.find((r) => r.free !== null)?.free ?? null,
      tiers,
    });
  }
  return out;
}
