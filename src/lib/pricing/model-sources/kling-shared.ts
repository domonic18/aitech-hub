/**
 * 快手可灵(Kling)牌价·共用件(M81,2026-11-27 实探):URL、积分口径、表格读取。
 *
 * 表格形态:`/document-api/pricing/base/*` 是 SPA 文档站,两张表都用 rowspan/colspan
 * 合并格,必须按网格展开(否则续行整体左移一列,价落错列);格内分「主文案」
 * (.matrix-cell-text)与「注记」(.price-tooltip,tooltip 展开的说明),取价只认
 * 主文案(否则会把说明文字并进价格)。
 *
 * 价格口径:页面按**积分**报价而非元,积分单价在伴生页 `/dev/pricing` 的官方口径里
 * 写明「视频API 1积分等于 1元(原价)」「图片API 1积分等于 0.025元(原价)」
 * (页面内嵌 kConf 配置的 zh 段),故价 = 积分 × 积分单价;取不到时回落官方常量。
 */
import * as cheerio from "cheerio";

import type { SnapshotSink } from "../../collect/snapshot-capture";
import { logInfo } from "../../logger";
import { snapshotHtml } from "../render-fetch";
import { resolutionRank } from "../resolution";

/** 官方定价文档(种子初始值;运行期 URL 归 crawl_source 后台可调) */
export const KLING_VIDEO_PRICING_URL = "https://klingai.com/document-api/pricing/base/video";
export const KLING_IMAGE_PRICING_URL = "https://klingai.com/document-api/pricing/base/image";
/** 伴生页:积分单价口径(视频 1 元/积分、图片 0.025 元/积分) */
export const KLING_PRICING_HOME_URL = "https://klingai.com/dev/pricing";

/** 厂商名(行侧 vendor 自由文本;与厂商字典的桥见 provider-registry) */
export const VENDOR = "快手可灵";
/** 厂商规范键(与 source-registry 的 providerKey 同一空间) */
export const PROVIDER_KEY = "kuaishou-kling";

/** 积分单价兜底(官方原价口径;伴生页取不到时用) */
export const CREDIT_CNY_FALLBACK = { video: 1, image: 0.025 } as const;

/** 一个单元格(主文案 + 注记) */
export interface Cell {
  text: string;
  note: string;
}

/** DOM 元素类型(cheerio 未导出 Element,从 find 的返回类型反推,免直依赖 domhandler) */
type El =
  ReturnType<ReturnType<cheerio.CheerioAPI["root"]>["find"]> extends cheerio.Cheerio<infer T>
    ? T
    : never;

/** 主文案:格内 .matrix-cell-text(文档站)/ .cell-item-main(定价页);
 *  都没有时退整格文本并剔掉 tooltip 说明与图标(否则说明文字会混进价) */
export function cellText($: cheerio.CheerioAPI, el: El): string {
  const main = $(el).find(".matrix-cell-text, .cell-item-main").first();
  if (main.length > 0) return main.text().replace(/\s+/g, " ").trim();
  const clone = $(el).clone();
  clone.find(".price-tooltip, .cell-note, svg").remove();
  return clone.text().replace(/\s+/g, " ").trim();
}

/** 注记(.price-tooltip / .cell-note:tooltip 里那段说明) */
export function cellNote($: cheerio.CheerioAPI, el: El): string {
  const note = $(el).find(".price-tooltip, .cell-note").first();
  return note.length > 0 ? note.text().replace(/\s+/g, " ").trim() : "";
}

/** 积分数 × 单价 → 元(抹掉二进制浮点噪声:0.8 × 0.025 = 0.020000000000000004) */
export function toCny(credits: number, creditCny: number): number {
  return Math.round(credits * creditCny * 1e6) / 1e6;
}

/**
 * 表格 → 网格(展开 rowspan/colspan:合并格的续行必须补齐占位,
 * 否则续行会整体左移一列,价落错列)。
 */
export function tableGrid($: cheerio.CheerioAPI, table: El): Cell[][] {
  const grid: Cell[][] = [];
  let r = 0;
  $(table)
    .find("tr")
    .each((_, tr) => {
      if (grid[r] === undefined) grid[r] = [];
      let c = 0;
      $(tr)
        .children("td,th")
        .each((_, el) => {
          while (grid[r]![c] !== undefined) c += 1;
          const cs = Number($(el).attr("colspan") ?? "1") || 1;
          const rs = Number($(el).attr("rowspan") ?? "1") || 1;
          const cell: Cell = { text: cellText($, el), note: cellNote($, el) };
          for (let i = 0; i < rs; i += 1) {
            if (grid[r + i] === undefined) grid[r + i] = [];
            for (let j = 0; j < cs; j += 1) grid[r + i]![c + j] = cell;
          }
          c += cs;
        });
      r += 1;
    });
  return grid;
}

/** 「1.0积分/秒」→ 1.0(积分/秒);非按秒价(「-」「+ 0.3积分/秒」「0.05积分/次」)→ null */
export function creditsPerSecond(text: string): number | null {
  const m = /^([\d.]+)\s*积分\s*\/\s*秒$/.exec(text.trim());
  return m === null ? null : Number(m[1]);
}

/** 「16积分/张」→ 16(积分/张);认不出 → null */
export function creditsPerImage(text: string): number | null {
  const m = /^([\d.]+)\s*积分\s*\/\s*张$/.exec(text.trim());
  return m === null ? null : Number(m[1]);
}

/** 表头「价格（720p）」→ 720p */
export function resolutionOfHeader(text: string): string | null {
  const m = /价格\s*[（(]\s*([^)）]+?)\s*[)）]/.exec(text);
  return m === null ? null : m[1]!;
}

/**
 * 入口价档(行价基准):最低分辨率档。
 * 首页行分辨率认不出(如「1K、2K」并列)时按页面顺序取首行——官方表按分辨率升序排。
 */
export function pickEntry<T extends { resolution: string }>(tiers: T[]): T | null {
  if (tiers.length === 0) return null;
  const ranks = tiers.map((t) => resolutionRank(t.resolution));
  if (ranks[0] === null) return tiers[0]!;
  const known = ranks.filter((r): r is number => r !== null);
  if (known.length === 0) return tiers[0]!;
  return tiers[ranks.indexOf(Math.min(...known))]!;
}

/** 取数走 card-renderer 渲染通道(SPA 静态 HTML 是空壳) */
export async function fetchKlingPricing(url: string, sink?: SnapshotSink): Promise<string> {
  const page = await snapshotHtml(url, undefined, { screenshot: sink !== undefined });
  await sink?.({ tab: "page", ...page });
  return page.html;
}

/**
 * 积分单价(伴生页口径):页面内嵌 kConf 配置的 zh 段写着
 * 「视频API 1积分等于 1元(原价)」「图片API 1积分等于 0.025元(原价)」。
 * 纯函数(单测锚);取不到 → null(调用方回落常量)。
 */
export function parseKlingCreditRates(html: string): {
  video: number | null;
  image: number | null;
} {
  const out: { video: number | null; image: number | null } = { video: null, image: null };
  // kConf 是页面里的 window['kConf_…']= {…} 赋值;zh 段在配置对象里
  const m = /window\['kConf_ytech\.klingWeb\.devModelPageInfo_18n'\]\s*=\s*/.exec(html);
  if (m === null) return out;
  const start = m.index + m[0].length;
  const slice = html.slice(start);
  let depth = 0;
  let end = -1;
  let inStr = false;
  let esc = false;
  for (let i = 0; i < slice.length; i += 1) {
    const c = slice[i]!;
    if (inStr) {
      if (esc) esc = false;
      else if (c === "\\") esc = true;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') inStr = true;
    else if (c === "{") depth += 1;
    else if (c === "}") {
      depth -= 1;
      if (depth === 0) {
        end = i + 1;
        break;
      }
    }
  }
  if (end < 0) return out;
  let conf: { zh?: Record<string, { main?: { subTitle?: string } }> };
  try {
    conf = JSON.parse(slice.slice(0, end)) as typeof conf;
  } catch {
    return out;
  }
  const zh = conf.zh;
  if (zh === undefined) return out;
  const read = (title: string): number | null => {
    const sub = zh[title]?.main?.subTitle ?? "";
    const r = /1\s*积分\s*等于\s*([\d.]+)\s*元/.exec(sub);
    return r === null ? null : Number(r[1]);
  };
  out.video = read("newVideoApi");
  out.image = read("newImageApi");
  return out;
}

/**
 * 伴生页取积分单价(静态 fetch 即可:kConf 在 SSR HTML 里)。
 * 失败/取不到 → 回落官方常量并记日志(不连坐主源:价照落)。
 */
export async function fetchKlingCreditRates(sink?: SnapshotSink): Promise<{
  video: number;
  image: number;
}> {
  let video: number | null = null;
  let image: number | null = null;
  try {
    const res = await fetch(KLING_PRICING_HOME_URL, { cache: "no-store" });
    const html = await res.text();
    await sink?.({ tab: "credits", html, httpStatus: res.status });
    if (!res.ok) throw new Error(`http ${res.status}`);
    const parsed = parseKlingCreditRates(html);
    video = parsed.video;
    image = parsed.image;
  } catch (e) {
    logInfo("pricing.source.credit_rate_fetch_failed", {
      source: "kling",
      error: e instanceof Error ? e.message : String(e),
    });
  }
  if (video === null || image === null) {
    logInfo("pricing.source.credit_rate_fallback", { source: "kling" });
    return {
      video: video ?? CREDIT_CNY_FALLBACK.video,
      image: image ?? CREDIT_CNY_FALLBACK.image,
    };
  }
  return { video, image };
}
