/**
 * 生数科技 Vidu 视频/图片牌价(M81,2026-11-27 实探):文档站渲染取数 + DOM 解析。
 *
 * 取数通道:文档站是 Next.js RSC——静态 HTML 里的表格被拆成
 * `<template id="P:xx">` 占位 + `<table hidden><tbody id="S:xx">` 片段,
 * 静态 fetch 拿到的是**残表**(数据行挂在别的表里,表头与数据行对不上),
 * 必须走渲染通道取 React 合并后的 DOM。
 *
 * 口径:
 * - 积分单价:「积分单价」表 1 积分 = 0.03125 元(页面自述),价 = 积分 × 单价;
 * - 视频:「能力|模型版本|时长|清晰度|积分消耗(错峰积分消耗)」表。只收**恒定每秒价**
 *   (格内恰为「每秒N积分」);递进价(Q2「第1秒N积分,后续每秒+X积分」)与按片
 *   固定时长(Q1/Vidu 2.0 的整条积分数)不收——折成每秒价会失真(宁可少收不可错收);
 * - 错峰积分消耗 = 时段维度(另一维价格),本表不建模,只取标准价;
 * - 图片:「能力|模型|输入图片数量|分辨率|积分消耗」表(文生图/参考生图),按张计价。
 *
 * 行价口径:基准能力(含「文生」优先,否则首个能力)× 最低分辨率档 = 入口价;
 * 其余能力/分辨率档全部落档位表(前台可展开)。
 */
import * as cheerio from "cheerio";

import type { SnapshotSink } from "../../collect/snapshot-capture";
import { snapshotHtml } from "../render-fetch";
import { pushPrefillTier, type ModelPrefillRow, type ModelTierPrefill } from "../crawlers";
import { normalizeModelKey } from "../normalize";
import { resolutionRank } from "../resolution";

/** 官方定价文档(种子初始值;运行期 URL 归 crawl_source 后台可调) */
export const VIDU_PRICING_URL = "https://platform.vidu.cn/docs/overview/pricing";

/** 厂商名(行侧 vendor 自由文本;与厂商字典的桥见 provider-registry) */
const VENDOR = "生数科技 Vidu";
/** 厂商规范键(与 source-registry 的 providerKey 同一空间) */
const PROVIDER_KEY = "shengshu-vidu";

/** 「每秒9积分」→ 9(积分/秒);非恒定每秒价 → null */
function creditsPerSecond(text: string): number | null {
  const m = /^每秒\s*([\d.]+)\s*积分\s*$/.exec(text.trim());
  return m === null ? null : Number(m[1]);
}

/** 「6」/「6积分」→ 6(积分/张);认不出 → null */
function creditsPerImage(text: string): number | null {
  const m = /^([\d.]+)\s*(?:积分)?$/.exec(text.trim());
  return m === null ? null : Number(m[1]);
}

/** 表头 → 列语义 */
type ColRole = "capability" | "model" | "count" | "resolution" | "price" | null;

function colRoleOf(header: string, video: boolean): ColRole {
  const h = header.replace(/\s+/g, "");
  if (h.includes("能力")) return "capability";
  if (video && h.includes("模型版本")) return "model";
  if (!video && h === "模型") return "model";
  if (h.includes("输入图片数量")) return "count";
  if (video ? h.includes("清晰度") : h.includes("分辨率")) return "resolution";
  if (h.includes("积分消耗")) return "price";
  return null;
}

/** 积分单价:「积分 | 价格(RMB)」表 → 元/积分;找不到 → null(价无法折算) */
function creditRateOf($: cheerio.CheerioAPI): number | null {
  let rate: number | null = null;
  $("table").each((_, el) => {
    const rows = $(el).find("tr");
    if (rows.length < 2) return;
    const headers = $(rows[0])
      .children()
      .map((_, c) => $(c).text().trim())
      .get();
    if (headers.length !== 2) return;
    if (!headers[0]!.includes("积分")) return;
    const cells = $(rows[1])
      .children()
      .map((_, c) => $(c).text().trim())
      .get();
    const unit = Number(cells[1]);
    if (Number.isFinite(unit) && unit > 0) rate = unit;
  });
  return rate;
}

/** 一条价目记录(视频=每秒积分,图片=每张积分) */
interface ViduRecord {
  model: string;
  capability: string;
  /** 输入图片数量(仅图片表;参考生图价随张数变) */
  count: string;
  resolution: string;
  credits: number;
  /** 档位名:「能力·数量·分辨率」,末段是分辨率 */
  label: string;
}

/**
 * 视频表(恒定每秒价)与图片表(按张)→ 记录列表。
 * 视频表头判据:模型版本 + 清晰度 + 积分消耗;图片表头判据:模型 + 分辨率 + 积分消耗。
 */
function collectRecords($: cheerio.CheerioAPI): { video: ViduRecord[]; image: ViduRecord[] } {
  const video: ViduRecord[] = [];
  const image: ViduRecord[] = [];
  $("table").each((_, el) => {
    // 渲染后仍残留 RSC 分片表(hidden 且无行)——跳过
    if ($(el).attr("hidden") !== undefined) return;
    const rows = $(el)
      .find("tr")
      .toArray()
      .filter((r) => r.children.length > 0);
    if (rows.length < 2) return;
    const headers = $(rows[0]!)
      .children()
      .map((_, c) => $(c).text().trim())
      .get();
    const joined = headers.join("");
    const isVideo = joined.includes("模型版本") && joined.includes("清晰度");
    const isImage = !isVideo && joined.includes("分辨率") && joined.includes("积分消耗");
    if (!isVideo && !isImage) return;
    const roles = headers.map((h) => colRoleOf(h, isVideo));
    if (!roles.includes("model") || !roles.includes("resolution")) return;
    // 价格列只认**第一个**(积分消耗);其后的「错峰积分消耗」是时段维度,不建模
    const priceIdx = roles.indexOf("price");
    if (priceIdx < 0) return;

    let model = "";
    for (const r of rows.slice(1)) {
      const cells = $(r)
        .children()
        .map((_, c) => $(c).text().replace(/\s+/g, " ").trim())
        .get();
      let capability = "";
      let count = "";
      let resolution = "";
      cells.forEach((text, i) => {
        switch (roles[i]) {
          case "model":
            if (text !== "") model = text;
            break;
          case "capability":
            capability = text;
            break;
          case "count":
            count = text;
            break;
          case "resolution":
            resolution = text;
            break;
          default:
            break;
        }
      });
      if (model === "" || resolution === "") continue;
      const priceText = cells[priceIdx] ?? "";
      const credits = isVideo ? creditsPerSecond(priceText) : creditsPerImage(priceText);
      if (credits === null) continue; // 递进价/按片价/空价:不臆测(整行跳过)
      const parts = [capability, count === "" || count === "0" ? null : count, resolution].filter(
        (v): v is string => v !== null && v !== "",
      );
      const rec: ViduRecord = {
        model,
        capability,
        count,
        resolution,
        credits,
        label: parts.join("·"),
      };
      if (isVideo) video.push(rec);
      else image.push(rec);
    }
  });
  return { video, image };
}

/** 最低分辨率档(入口价);分辨率认不出时取首个 */
function pickEntry<T extends { resolution: string }>(tiers: T[]): T | null {
  if (tiers.length === 0) return null;
  let best = tiers[0]!;
  let bestRank = resolutionRank(best.resolution);
  for (const t of tiers.slice(1)) {
    const rank = resolutionRank(t.resolution);
    if (rank === null) continue;
    if (bestRank === null || rank < bestRank) {
      best = t;
      bestRank = rank;
    }
  }
  return best;
}

/** 一组记录 → 牌价行(行价 = 基准能力 × 最低分辨率档) */
function rowOf(
  model: string,
  recs: ViduRecord[],
  unit: "per_second" | "per_image",
  rate: number,
  modality: "video" | "image",
  day: string,
  sourceUrl: string,
  now: Date,
): ModelPrefillRow | null {
  const tiers: ModelTierPrefill[] = [];
  for (const r of recs) {
    pushPrefillTier(tiers, {
      tierLabel: r.label,
      inputPrice: null,
      outputPrice: r.credits * rate,
      cachePrice: null,
      minTokens: null,
      maxTokens: null,
      unit,
    });
  }
  // 基准能力:含「文生」优先(文生视频/文生图是本站比价主场景),否则该模型首个能力
  const baseRecs = recs.filter((r) => r.capability.includes("文生"));
  const pool = baseRecs.length > 0 ? baseRecs : recs;
  const entry = pickEntry(pool);
  if (entry === null) return null;
  const per = unit === "per_second" ? "积分/秒" : "积分/张";
  return {
    vendor: VENDOR,
    modelKey: normalizeModelKey(model),
    currency: "CNY",
    inputPrice: null,
    outputPrice: entry.credits * rate,
    contextWindow: null,
    note: `[官方页爬虫 ${day}] ${model} · ${entry.label}(${entry.credits} ${per},1 积分 = ${rate} 元)`,
    dataAsOf: now,
    sourceUrl,
    region: "cn",
    providerKey: PROVIDER_KEY,
    priceUnit: unit,
    modality,
    tiers,
  };
}

/** Vidu 牌价页解析(纯函数,fixture 单测锚) */
export function parseViduPricing(html: string, sourceUrl: string, now: Date): ModelPrefillRow[] {
  const $ = cheerio.load(html);
  const rate = creditRateOf($);
  if (rate === null) throw new Error("vidu 积分单价表未匹配(页面可能改版)");
  const { video, image } = collectRecords($);
  if (video.length === 0 && image.length === 0) throw new Error("vidu 价格表未匹配(页面可能改版)");

  const day = now.toISOString().slice(0, 10);
  const out: ModelPrefillRow[] = [];

  // 视频:按模型归组(同一模型出现在多张表时能力不同,档位名带能力段区分)
  const videoByModel = new Map<string, ViduRecord[]>();
  for (const rec of video) {
    const list = videoByModel.get(rec.model);
    if (list === undefined) videoByModel.set(rec.model, [rec]);
    else list.push(rec);
  }
  for (const [model, recs] of videoByModel) {
    const row = rowOf(model, recs, "per_second", rate, "video", day, sourceUrl, now);
    if (row !== null) out.push(row);
  }

  // 图片:按张计价;只收图像生成能力(文生图/参考生图)
  const imageByModel = new Map<string, ViduRecord[]>();
  for (const rec of image) {
    if (!rec.capability.includes("图")) continue;
    const list = imageByModel.get(rec.model);
    if (list === undefined) imageByModel.set(rec.model, [rec]);
    else list.push(rec);
  }
  for (const [model, recs] of imageByModel) {
    const row = rowOf(model, recs, "per_image", rate, "image", day, sourceUrl, now);
    if (row !== null) out.push(row);
  }

  return out;
}

/**
 * 取数走 card-renderer 渲染通道:RSC 分片表在静态 HTML 里对不上,
 * 必须取渲染合并后的 DOM。失败先落快照再抛(改版当天的原文恰恰是唯一证据)。
 */
export async function fetchViduPricing(url: string, sink?: SnapshotSink): Promise<string> {
  const page = await snapshotHtml(url, undefined, { screenshot: sink !== undefined });
  await sink?.({ tab: "page", ...page });
  return page.html;
}
