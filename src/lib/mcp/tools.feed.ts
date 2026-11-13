/**
 * MCP 只读工具表·检索与热点侧(M72):外部智能体取站点内容。
 *
 * 与创作工具同一端点、同一 PAT(不按鉴权切工具集),读侧同样记审计
 * (记键与命中,不记正文——同 get_article 先例)。
 *
 * 口径纪律:检索走 K1 unified-search(给人搜索 = 给智能体检索,同源不漂);
 * 电报条目走公开投影(可见性口径与前台列表同源,不另开口子);热点走
 * insight 簇趋势分级(阈值与 admin 榜共用,不另起一套)。
 */
import { z } from "zod";

import { parseBigIntId } from "@/lib/http/parse-id";
import { listHotTopics } from "@/lib/insight/hot-topics";
import { logger } from "@/lib/logger";
import { searchAll } from "@/lib/search/unified-search";
import { getPublicTelegramDetail } from "@/lib/telegram/public-feed";
import { getVideoPlayUrl } from "@/lib/telegram/video-play-url";

import { fail, json } from "./json";
import { defineTool, type McpToolDef } from "./registry";

/** 趋势档(与 insight trend.ts 的 TrendTier 同名同值) */
const TREND_TIERS = ["new", "breakout", "rising", "flat", "declining"] as const;

/** 检索的域过滤(缺省三域全出) */
const SEARCH_DOMAINS = ["telegram", "post", "repo"] as const;

/**
 * 检索命中 → agent 友好投影:比 K2.5 的 summarizeSearchGroups 多带
 * 元数据(来源/形态/互动数/日期),agent 不必再逐条 get_telegram_item 补。
 */
function searchHitView(hit: {
  id: string;
  title: string;
  snippet: string;
  href: string;
  dateIso: string | null;
  hitPct: number;
  domain: string;
  mediaType?: string;
  sourceName?: string;
  sourceType?: string;
  aiSummary?: string | null;
  aiNote?: string | null;
  video?: {
    platform: string;
    blogger: string;
    durationSeconds: number | null;
    engagement: { play: number | null; like: number | null; comment: number | null };
  };
  viewsCount?: number;
  tags?: string[];
  stars?: number;
  language?: string | null;
}) {
  return {
    id: hit.id,
    domain: hit.domain,
    title: hit.title,
    snippet: hit.snippet,
    href: hit.href,
    date: hit.dateIso,
    hitPct: hit.hitPct,
    ...(hit.domain === "telegram"
      ? {
          mediaType: hit.mediaType,
          source: hit.sourceName,
          sourceType: hit.sourceType,
          aiSummary: hit.aiSummary ?? null,
          aiNote: hit.aiNote ?? null,
          ...(hit.video
            ? {
                video: {
                  platform: hit.video.platform,
                  blogger: hit.video.blogger,
                  durationSeconds: hit.video.durationSeconds,
                  engagement: hit.video.engagement,
                },
              }
            : {}),
        }
      : {}),
    ...(hit.domain === "post" ? { viewsCount: hit.viewsCount, tags: hit.tags } : {}),
    ...(hit.domain === "repo" ? { stars: hit.stars, language: hit.language } : {}),
  };
}

/** 检索与热点侧工具表(只读 4 只) */
export const feedTools: McpToolDef[] = [
  defineTool(
    "list_hot_topics",
    "取当前热点话题:按领域(domain)与趋势档(新晋/爆发/上升/平稳/退潮)聚合," +
      "每个话题带簇标签、机会分、增长分,以及簇内的主要新闻条目(标题/原文链/摘要/所属电报条目 id)。" +
      "缺省只出「新晋/爆发/上升」三档;想看全量趋势显式传 tiers。",
    {
      domain: z.string().max(30).optional().describe("领域 key(如 tech / finance);缺省全量领域"),
      tiers: z
        .array(z.enum(TREND_TIERS))
        .max(TREND_TIERS.length)
        .optional()
        .describe("趋势档过滤;缺省为 new/breakout/rising(热档)"),
      kind: z.enum(["hot", "pain"]).optional().describe("热点榜(缺省)或痛点榜"),
      limit: z.number().int().min(1).max(30).default(10).describe("话题条数上限"),
      itemsPerTopic: z.number().int().min(1).max(8).default(5).describe("每话题带出的新闻条目数"),
    },
    async (args, actor) => {
      try {
        const topics = await listHotTopics({
          ...(args.domain !== undefined ? { domain: args.domain } : {}),
          ...(args.tiers !== undefined ? { tiers: args.tiers } : {}),
          ...(args.kind !== undefined ? { kind: args.kind } : {}),
          limit: args.limit,
          itemsPerTopic: args.itemsPerTopic,
        });
        logger.info({
          event: "mcp.list_hot_topics",
          actor,
          domain: args.domain ?? null,
          tiers: args.tiers ?? null,
          count: topics.length,
        });
        return json({ count: topics.length, topics });
      } catch (e) {
        return fail(e);
      }
    },
  ),

  defineTool(
    "get_telegram_item",
    "取单条电报(资讯/短视频解读)的完整元数据:标题、原文链接、摘要、AI 解读" +
      "(主题/摘要/要点/关键词)、解读笔记全文、来源渠道、发布时间、互动数;" +
      "视频条另带平台/博主/时长/封面。输入 search_site 或 list_hot_topics 返回的条目 id。",
    { id: z.string().regex(/^\d+$/, "条目 id 为纯数字字符串") },
    async (args, actor) => {
      const id = parseBigIntId(args.id);
      if (id === null) return json({ error: "条目 id 非法" }, true);
      const item = await getPublicTelegramDetail(id);
      logger.info({
        event: "mcp.get_telegram_item",
        actor,
        id: args.id,
        found: item !== null,
      });
      if (!item) return json({ error: "not found", id: args.id }, true);
      return json(item);
    },
  ),

  defineTool(
    "search_site",
    "站内三域检索(资讯/教程/项目):按关键词或自然语言检索,返回分组命中与元数据。" +
      "资讯域可按形态过滤(文字/视频)。命中条目 id 可继续调 get_telegram_item 取全文元数据," +
      "或 get_article 按 slug 取文章正文。",
    {
      q: z.string().min(1).max(100).describe("检索词,中文自然语言或关键词"),
      mediaType: z.enum(["all", "text", "video"]).optional().describe("资讯域形态过滤;缺省不限"),
      domains: z
        .array(z.enum(SEARCH_DOMAINS))
        .max(SEARCH_DOMAINS.length)
        .optional()
        .describe("要返回的域;缺省三域全出"),
    },
    async (args, actor) => {
      try {
        const result = await searchAll(args.q, {
          ...(args.mediaType !== undefined ? { mediaType: args.mediaType } : {}),
        });
        const wanted = args.domains ?? [...SEARCH_DOMAINS];
        const groups = Object.entries(result.groups)
          .filter(([domain]) => wanted.includes(domain as (typeof SEARCH_DOMAINS)[number]))
          .map(([domain, g]) => ({
            domain,
            total: g.total,
            items: g.items.map(searchHitView),
          }));
        logger.info({
          event: "mcp.search_site",
          actor,
          q: args.q,
          mediaType: args.mediaType ?? "all",
          total: result.total,
        });
        return json({ total: result.total, groups });
      } catch (e) {
        return fail(e);
      }
    },
  ),

  defineTool(
    "get_video_play_url",
    "取视频条目的播放直链(现查,平台签名 URL,数小时内有效)。输入电报条目 id。" +
      "查不得时返回 ok=false 与原因(作品过旧、Cookie 池空、平台风控等)——" +
      "直链不可得属常态,拿不到就用条目原文链接。",
    { id: z.string().regex(/^\d+$/, "条目 id 为纯数字字符串") },
    async (args, actor) => {
      const id = parseBigIntId(args.id);
      if (id === null) return json({ error: "条目 id 非法" }, true);
      const result = await getVideoPlayUrl(id);
      logger.info({
        event: "mcp.get_video_play_url",
        actor,
        id: args.id,
        ok: result.ok,
        platform: result.platform,
      });
      return json(result);
    },
  ),
];
