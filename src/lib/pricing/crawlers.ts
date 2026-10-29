/**
 * 官方页爬虫·模型面(M55 批C;M56 批B 分层):纯解析/取数/落库库——
 * DeepSeek=峰谷×缓存命中矩阵(标准牌价=高峰·缓存未命中,矩阵全貌按模型入
 * note),Moonshot=SSR 序列化行直取。渠道编排(DB 驱动、失败合并上抛)在
 * source-registry.ts;本文件不含渠道定义。
 * 初稿三规则:建 pending/刷 pending/enabled·disabled 终审行不覆盖;currency
 * 随价格走(跨通道防 ¥ 数字配 $ 符号)。
 * 失败语义:爬取单源失败自吞(编排层收尾),失败源旧数据按 sourceUrl 圈定
 * note 打「待复核」标,整 job 上抛 job_run 记 failed 连败可见,不静默腐烂。
 */
import { prisma } from "@/lib/db";
import type { SnapshotSink } from "../collect/snapshot-capture";
import { markCuratedSourceStale, persistCuratedRows } from "./curated-persist";

export interface ModelPrefillRow {
  vendor: string;
  modelKey: string;
  currency: "CNY" | "USD";
  inputPrice: number | null;
  outputPrice: number | null;
  contextWindow: string | null;
  note: string;
  dataAsOf: Date;
  sourceUrl: string;
  region: "cn" | "intl";
}

/** 默认官方页(种子初始值;运行期 URL 归 pricing_source 表后台可调) */
export const DEEPSEEK_PRICING_URL = "https://api-docs.deepseek.com/zh-cn/quick_start/pricing";
export const MOONSHOT_PRICING_URL = "https://platform.moonshot.cn/docs/pricing/chat";

/** 去 tag 纯文本(表格结构折叠为空格分隔;矩阵解析用) */
function stripTags(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/g, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ");
}

const NUM = String.raw`([0-9.]+)\s*元`;

/** DeepSeek 矩阵解析(纯函数,fixture 单测锚):标准牌价=高峰·缓存未命中 */
export function parseDeepseek(html: string, sourceUrl: string, now: Date): ModelPrefillRow[] {
  const text = stripTags(html);
  const m = text.match(
    new RegExp(
      String.raw`百万tokens输入 （缓存命中） 空闲时段 ${NUM} ${NUM} 高峰时段 ${NUM} ${NUM} 百万tokens输入 （缓存未命中） 空闲时段 ${NUM} ${NUM} 高峰时段 ${NUM} ${NUM} 百万tokens输出 空闲时段 ${NUM} ${NUM} 高峰时段 ${NUM} ${NUM}`,
    ),
  );
  if (m === null) throw new Error("deepseek 矩阵结构未匹配(页面可能改版)");
  // 捕获序 = 页面行序(空闲列在前/高峰列在后,双模型列并列 flash|pro):
  // 命中 F/P/F峰/P峰,未命中同构,输出同构(首逗号跳过 match 全串)
  const [
    ,
    hitIdleF,
    hitIdleP,
    hitPeakF,
    hitPeakP,
    missIdleF,
    missIdleP,
    missPeakF,
    missPeakP,
    outIdleF,
    outIdleP,
    outPeakF,
    outPeakP,
  ] = m;
  const day = now.toISOString().slice(0, 10);
  return [
    {
      suffix: "flash",
      hitIdle: hitIdleF,
      hitPeak: hitPeakF,
      missIdle: missIdleF,
      missPeak: missPeakF,
      outIdle: outIdleF,
      outPeak: outPeakF,
    },
    {
      suffix: "v4-pro",
      hitIdle: hitIdleP,
      hitPeak: hitPeakP,
      missIdle: missIdleP,
      missPeak: missPeakP,
      outIdle: outIdleP,
      outPeak: outPeakP,
    },
  ].map((c) => ({
    vendor: "DeepSeek 深度求索",
    modelKey: `deepseek-${c.suffix}`,
    currency: "CNY" as const,
    // 标准牌价=高峰·缓存未命中输入/输出(不打折基准;空闲=半价,矩阵入 note)
    inputPrice: Number(c.missPeak),
    outputPrice: Number(c.outPeak),
    contextWindow: "1M",
    note: `[官方页爬虫 ${day}] 矩阵(元/百万,谷/峰):命中 ${c.hitIdle}/${c.hitPeak} 未命中 ${c.missIdle}/${c.missPeak} 输出 ${c.outIdle}/${c.outPeak};空闲=高峰半价`,
    dataAsOf: now,
    sourceUrl,
    region: "cn" as const,
  }));
}

/** Kimi SSR 序列化行解析(纯函数,fixture 单测锚):
 * `model`}),`¥13.00 / MTok`,`¥68.00 / MTok`,… → 模型+输入/输出 */
export function parseMoonshot(html: string, sourceUrl: string, now: Date): ModelPrefillRow[] {
  // 用字符串构造 RegExp:模式内含反引号与 `/ MTok`,字面量写法转义易碎
  const re = new RegExp(
    "`([a-z0-9][a-z0-9.-]+)`\\}\\),`¥([0-9.]+) / MTok`,`¥([0-9.]+) / MTok`",
    "g",
  );
  const rows: ModelPrefillRow[] = [];
  for (const m of html.matchAll(re)) {
    rows.push({
      vendor: "月之暗面 Moonshot",
      modelKey: m[1] ?? "",
      currency: "CNY" as const,
      inputPrice: Number(m[2]),
      outputPrice: Number(m[3]),
      contextWindow: null,
      note: `[官方页爬虫 ${now.toISOString().slice(0, 10)}] 官方牌价页直读(缓存档见来源页)`,
      dataAsOf: now,
      sourceUrl,
      region: "cn" as const,
    });
  }
  if (rows.length === 0) throw new Error("moonshot 行结构未匹配(页面可能改版)");
  return rows;
}

export interface ModelSourceResult {
  ok: boolean;
  rows: ModelPrefillRow[];
  error?: string;
}

/** 单模型源取数+解析(static 型直取;编排层按渠道逐个调,失败自吞)。
 * 快照在解析之前落(sink):改版当天的原文恰恰是最需要的证据。 */
export async function crawlModelSource(
  kind: string,
  url: string,
  parse: (html: string, sourceUrl: string, now: Date) => ModelPrefillRow[],
  now: Date,
  sink?: SnapshotSink,
): Promise<ModelSourceResult> {
  try {
    if (kind !== "static") throw new Error(`模型源不支持 kind=${kind}(仅 static)`);
    const res = await fetch(url, { cache: "no-store" });
    const html = await res.text();
    await sink?.({ tab: "page", html, httpStatus: res.status });
    if (!res.ok) throw new Error(`http ${res.status}`);
    return { ok: true, rows: parse(html, url, now) };
  } catch (e) {
    return {
      ok: false,
      rows: [],
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

const RECHECK_MARKER_RE = /【待复核 \d{4}-\d{2}-\d{2} 爬取失败】/;
const NOTE_MAX = 200; // schema note @db.VarChar(200)

/** 待复核打标(纯函数,单测锚):替换旧标(重打新日期)后前缀拼原 note,截 200。
 * 打标只动 note 不动状态——enabled 行仍页面可见,但策展台能看见「需人工复核」。 */
export function withRecheckMark(note: string | null, now: Date): string {
  const base = (note ?? "").replace(RECHECK_MARKER_RE, "").trim();
  return `【待复核 ${now.toISOString().slice(0, 10)} 爬取失败】${base}`.slice(0, NOTE_MAX);
}

/** 失败源旧数据整源打标(通用编排薄壳;圈定/写入口径见 curated-persist) */
export async function markModelSourceStale(sourceUrl: string, now: Date): Promise<number> {
  return markCuratedSourceStale(
    sourceUrl,
    now,
    (url) =>
      prisma.modelPricing.findMany({ where: { sourceUrl: url }, select: { id: true, note: true } }),
    (id, note) =>
      prisma.modelPricing.update({ where: { id }, data: { note }, select: { id: true } }),
  );
}

/** 模型行初稿三规则落库(建 pending/刷 pending/终审行不动;currency 随价格走) */
export async function persistModelRows(rows: ModelPrefillRow[]): Promise<{
  created: number;
  refreshed: number;
  untouched: number;
  failed: number;
}> {
  return persistCuratedRows(rows, {
    keyOf: (r) => ({ vendor: r.vendor, key: r.modelKey }),
    listExisting: async (vendors, keys) => {
      const rows = await prisma.modelPricing.findMany({
        where: { vendor: { in: vendors }, modelKey: { in: keys } },
        select: { id: true, vendor: true, modelKey: true, status: true },
      });
      return rows.map((r) => ({ id: r.id, vendor: r.vendor, key: r.modelKey, status: r.status }));
    },
    create: (r) =>
      prisma.modelPricing.create({
        data: {
          vendor: r.vendor,
          modelKey: r.modelKey,
          currency: r.currency,
          inputPrice: r.inputPrice,
          outputPrice: r.outputPrice,
          contextWindow: r.contextWindow,
          note: r.note,
          dataAsOf: r.dataAsOf,
          sourceUrl: r.sourceUrl,
          region: r.region,
          status: "pending",
        },
        select: { id: true },
      }),
    update: (id, r) =>
      prisma.modelPricing.update({
        where: { id },
        data: {
          // currency 必须随价格走:行若由 USD 通道先建,官方 CNY 价刷新时
          // 币种同步矫正,杜绝「¥ 数字配 $ 符号」的跨通道脏态
          currency: r.currency,
          inputPrice: r.inputPrice,
          outputPrice: r.outputPrice,
          contextWindow: r.contextWindow,
          note: r.note,
          dataAsOf: r.dataAsOf,
          sourceUrl: r.sourceUrl,
        },
        select: { id: true },
      }),
  });
}
