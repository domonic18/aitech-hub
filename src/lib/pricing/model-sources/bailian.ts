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
 * 只收**单位可识别**的表:每百万 Token 口径照旧双价;批G 起按张(元/张)/
 * 按秒(元/秒)的单级表头表一并纳入(生成价口径,行级 priceUnit 区分);
 * 单位不明的表(元/次等)与多级表头表仍整表排除——宁可少收,不可错收。
 *
 * 归一口径:一个模型 = 一行 model_pricing,**(部署范围 × 模式 × Token 区间
 * / 分辨率 × 视频类型)**各组合落一条档位(部署范围/模式/区间/分辨率都是
 * 价格维度,不是不同模型);行价取「全球」档(站点面向国内用户;没有全球
 * 档时取第一条)——与「多时段价取最高」同一原则:行价是**基准价**,
 * 不是最便宜的那一档。
 */
import * as cheerio from "cheerio";

import type { ModelPrefillRow } from "../crawlers";

import { bailianRowsToPrefill, type BailianRow } from "./bailian-rows";

/** 官方计费页(种子初始值;运行期 URL 归 crawl_source 后台可调) */
export const BAILIAN_MODEL_PRICING_URL = "https://help.aliyun.com/zh/model-studio/billing";

/** 列语义槽位(cond=分辨率/视频类型等档位维度;combined=输入和输出同价) */
type ColRole =
  | "model"
  | "scope"
  | "mode"
  | "tokenRange"
  | "cond"
  | "combined"
  | "input"
  | "cache"
  | "output"
  | "free"
  | null;

/** 表头 → 列语义(按关键词;顺序即列序;combined 须在输入/输出前判) */
function colRoleOf(header: string): ColRole {
  const h = header.replace(/\s+/g, "");
  if (h.includes("模型ID")) return "model";
  if (h.includes("服务部署范围")) return "scope";
  if (h === "模式" || h.startsWith("模式")) return "mode";
  if (h.includes("Token数") || h.includes("Token范围")) return "tokenRange";
  if (h.includes("免费额度")) return "free";
  if (h.includes("分辨率")) return "cond";
  if (h.includes("视频类型") || h.includes("参考类型")) return "cond";
  if (h.includes("输入和输出")) return "combined";
  if (h.includes("缓存命中")) return "cache";
  if (h.includes("输入单价")) return "input";
  if (h.includes("输出单价")) return "output";
  return null;
}

/** 表级单位(批G):表头(元/张、(每秒)等)或首行数据格(0.02元/张)里识别;
 *  认不出 → null,整表跳过(单位不明的价不落库) */
function unitOfTable(headers: string[], firstRowCells: string[]): string | null {
  const headCompact = headers.join("").replace(/\s+/g, "");
  if (headCompact.includes("元/张") || headCompact.includes("每张")) return "per_image";
  if (headCompact.includes("元/秒") || headCompact.includes("每秒")) return "per_second";
  const cellCompact = firstRowCells.join("").replace(/\s+/g, "");
  if (cellCompact.includes("元/张")) return "per_image";
  if (cellCompact.includes("元/秒")) return "per_second";
  if (headCompact.includes("每百万Token")) return "per_1m_tokens";
  return null;
}

/** 行级计价单位 → 表的显式模态(每秒表只有表头带「视频」才标 video——
 *  音乐按秒表(fun-music)不标,留给关键词推断成 audio) */
function tableModalityOf(unit: string, headers: string[]): string | undefined {
  if (unit === "per_image") return "image";
  if (unit === "per_second" && headers.some((h) => h.includes("视频"))) return "video";
  return undefined;
}

/** 「12元」/「14.988元」/「原价2元（限时8折）」→ 数值(null = 无法解析) */
function priceOf(text: string): number | null {
  const m = /([\d.]+)\s*元/.exec(text);
  return m === null ? null : Number(m[1]);
}

/** 模型 id:格内首段(官方附注在后面;id 可含厂商前缀斜杠,如 kling/kling-v3) */
function modelIdOf(cellText: string): string {
  const m = /^([A-Za-z0-9][A-Za-z0-9._/-]*)/.exec(cellText.trim());
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

/** 百炼计费页解析(纯函数,fixture 单测锚) */
export function parseBailianModels(html: string, sourceUrl: string, now: Date): ModelPrefillRow[] {
  const content = bailianContentOf(html);
  const $ = cheerio.load(content);
  const records: BailianRow[] = [];
  /** 模型 → 表级显式模态(按张表→image;按秒表带「视频」表头→video) */
  const tableModalityByModel = new Map<string, string>();

  $("table").each((_, t) => {
    const trs = $(t).find("tr");
    const headers = trs
      .first()
      .children()
      .map((_, c) => $(c).text().trim().replace(/\s+/g, " "))
      .get();
    const joined = headers.join(" ");
    if (headers.length < 2) return;
    // 元/次等不支持单位的表仍整表排除
    if (joined.includes("元/次")) return;

    // **整表行列对齐闸(批G 升级为 rowspan 感知)**:按 rowspan 占位把每个格
    // 映射到列,续行(分辨率/价格格)继承上一行的模型/范围/模式/免费额度;
    // 格数超出表头列数(多级表头 + 模态子维度的表:表头 4 列、数据行 6 格)
    // → 整表排除——宁可少收,不可错收(错价比缺价危害大得多)。
    const dataRows = trs
      .slice(1)
      .toArray()
      .filter((r) => r.children && r.children.length > 0);
    if (dataRows.length === 0) return;

    // 表级单位(批G):表头或首行数据格里认 元/张、元/秒、每百万Token
    const firstCells = (dataRows[0]!.children ?? []).map((c) => $(c).text().trim());
    const unit = unitOfTable(headers, firstCells);
    if (unit === null) return;

    const roles = headers.map(colRoleOf);
    if (!roles.includes("model")) return;
    if (!roles.includes("input") && !roles.includes("output") && !roles.includes("combined")) {
      return;
    }
    const tableModality = tableModalityOf(unit, headers);

    /** 列占用剩余行数(rowspan);续行的格映射到未占用列 */
    let occupied = new Map<number, number>();
    /** 续行继承源(模型/范围/模式/免费额度) */
    let inherit: Pick<BailianRow, "modelId" | "note" | "scope" | "mode" | "free"> | null = null;
    let misaligned = false;

    for (const r of dataRows) {
      const cells = (r.children ?? []).filter((c) => c.type === "tag");
      if (cells.length === 0) continue;
      const placed: Array<{ col: number; role: ColRole; text: string; rowspan: number }> = [];
      let ci = 0;
      for (const cell of cells) {
        while (occupied.has(ci)) ci += 1;
        if (ci >= headers.length) {
          misaligned = true; // 列溢出:多级表头表
          break;
        }
        placed.push({
          col: ci,
          role: roles[ci] ?? null,
          text: $(cell).text().trim().replace(/\s+/g, " "),
          rowspan:
            Number((cell as { attribs?: { rowspan?: string } }).attribs?.rowspan ?? "1") || 1,
        });
        ci += 1;
      }
      if (misaligned) break;
      // 行末结算:旧占位过期一级,本行 rowspan 的新占位生效
      const next = new Map<number, number>();
      for (const [k, v] of occupied) {
        if (v - 1 > 0) next.set(k, v - 1);
      }
      for (const p of placed) {
        if (p.rowspan > 1) next.set(p.col, p.rowspan - 1);
      }
      occupied = next;

      const rec: BailianRow = {
        modelId: inherit?.modelId ?? "",
        note: inherit?.note ?? "",
        scope: inherit?.scope ?? null,
        mode: inherit?.mode ?? null,
        tokenRange: null,
        cond: null,
        input: null,
        cache: null,
        output: null,
        free: inherit?.free ?? null,
        unit,
      };
      let hasModelCell = false;
      for (const { role, text } of placed) {
        switch (role) {
          case "model":
            rec.modelId = modelIdOf(text);
            rec.note = text.trim();
            hasModelCell = true;
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
          case "cond":
            // 多个 cond 列(如「输出视频类型」+「输出视频分辨率」)→ 逐段拼上,
            // 否则后一列会盖掉前一列(档位标签丢掉「有声视频」这一维)
            if (text !== "") rec.cond = rec.cond === null ? text : `${rec.cond}·${text}`;
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
          case "combined":
            // 输入和输出同价(按秒视频表):作为生成价落 output
            rec.output = priceOf(text);
            break;
          case "free":
            rec.free = text === "" || text === "无" ? null : text;
            break;
          default:
            break;
        }
      }
      if (hasModelCell && rec.modelId !== "") {
        inherit = {
          modelId: rec.modelId,
          note: rec.note,
          scope: rec.scope,
          mode: rec.mode,
          free: rec.free,
        };
      }
      if (rec.modelId !== "") records.push(rec);
      if (tableModality !== undefined && rec.modelId !== "") {
        tableModalityByModel.set(rec.modelId, tableModality);
      }
    }
    if (misaligned) return;
  });

  if (records.length === 0) throw new Error("bailuan 价格表未匹配(页面可能改版)");

  // 按模型归一:一行一模型,维度组合落档位,定行价基准
  const byModel = new Map<string, BailianRow[]>();
  for (const rec of records) {
    const list = byModel.get(rec.modelId);
    if (list === undefined) byModel.set(rec.modelId, [rec]);
    else list.push(rec);
  }
  return bailianRowsToPrefill(byModel, tableModalityByModel, now, sourceUrl);
}
