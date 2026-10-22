/**
 * 素材搜索(M42 批②,自 materials 拆出控行数):创作接地的「先找料」入口。
 * 口径与候选列表同源(TELEGRAM_ELIGIBLE),两类分查后合并,每条带 kind +
 * 纯数字 id 供 mount_material 直接挂载;摘要按 SEARCH_SUMMARY_MAX 截断
 * (全文在挂载后经 brief 水合读取)。
 */
import { Prisma } from "@prisma/client";

import { postPath } from "../content/post-path";
import { prisma } from "../db";
import { TELEGRAM_ELIGIBLE, type MaterialKind } from "./materials";

// ── 素材发现(agent search_materials)──────────────────────

const SEARCH_LIMIT_DEFAULT = 10;
const SEARCH_LIMIT_MAX = 20;
/** 搜索结果摘要截断(全文在挂载后经 brief 的 hydrate 读取) */
export const SEARCH_SUMMARY_MAX = 160;

export interface MaterialSearchQuery {
  kind?: MaterialKind | undefined;
  q?: string | undefined;
  limit?: number | undefined;
}

export interface MaterialHit {
  kind: MaterialKind;
  id: bigint;
  title: string | null;
  /** video / text;文章恒 null */
  mediaType: "video" | "text" | null;
  /** 人话副行(视频博主 / 文章状态),供模型一眼判型 */
  meta: string;
  summary: string | null;
  /** 视频原链 / 电报原文外链 / 文章站内路径 */
  url: string | null;
  time: Date | null;
}

function clipSummary(s: string | null): string | null {
  if (s === null) return null;
  const t = s.trim();
  if (t === "") return null;
  return t.length <= SEARCH_SUMMARY_MAX ? t : `${t.slice(0, SEARCH_SUMMARY_MAX)}…`;
}

/**
 * 素材搜索(agent 接地入口):关键词命中标题/摘要/解读结论/博主,按类分查后
 * 交错合并(两类都给出,避免单类淹没),每条结果带 kind + 纯数字 id 供挂载。
 */
export async function searchMaterials(query: MaterialSearchQuery = {}): Promise<MaterialHit[]> {
  const q = query.q?.trim() || undefined;
  const limit = Math.min(SEARCH_LIMIT_MAX, Math.max(1, query.limit ?? SEARCH_LIMIT_DEFAULT));
  const wantTelegram = query.kind === undefined || query.kind === "telegram";
  const wantPost = query.kind === undefined || query.kind === "post";

  const telegramWhere: Prisma.TelegramWhereInput = q
    ? {
        AND: [
          TELEGRAM_ELIGIBLE,
          {
            OR: [
              { title: { contains: q, mode: "insensitive" } },
              { summary: { contains: q, mode: "insensitive" } },
              { aiSummary: { contains: q, mode: "insensitive" } },
              { aiTopic: { contains: q, mode: "insensitive" } },
              { videoBlogger: { contains: q, mode: "insensitive" } },
            ],
          },
        ],
      }
    : TELEGRAM_ELIGIBLE;
  const postWhere: Prisma.PostWhereInput = {
    status: { not: "deleted" },
    ...(q
      ? {
          OR: [
            { title: { contains: q, mode: "insensitive" } },
            { excerpt: { contains: q, mode: "insensitive" } },
          ],
        }
      : {}),
  };

  const [tgRows, postRows] = await Promise.all([
    wantTelegram
      ? prisma.telegram.findMany({
          where: telegramWhere,
          orderBy: { id: "desc" },
          take: limit,
          select: {
            id: true,
            title: true,
            mediaType: true,
            summary: true,
            aiSummary: true,
            aiTopic: true,
            videoBlogger: true,
            url: true,
            publishedAt: true,
          },
        })
      : Promise.resolve([]),
    wantPost
      ? prisma.post.findMany({
          where: postWhere,
          orderBy: { updatedAt: "desc" },
          take: limit,
          select: {
            id: true,
            slug: true,
            title: true,
            status: true,
            excerpt: true,
            updatedAt: true,
          },
        })
      : Promise.resolve([]),
  ]);

  const hits: MaterialHit[] = [
    ...tgRows.map((r): MaterialHit => {
      const mediaType = r.mediaType === "video" ? "video" : "text";
      return {
        kind: "telegram",
        id: r.id,
        title: r.title,
        mediaType,
        meta:
          mediaType === "video"
            ? ["视频", r.videoBlogger].filter(Boolean).join(" · ")
            : ["电报图文", r.aiTopic].filter(Boolean).join(" · "),
        summary: clipSummary(r.aiSummary ?? r.summary),
        url: r.url,
        time: r.publishedAt,
      };
    }),
    ...postRows.map((r): MaterialHit => {
      const title = r.title;
      return {
        kind: "post",
        id: r.id,
        title,
        mediaType: null,
        meta: r.status === "published" ? "文章 · 已发布" : "文章 · 草稿",
        summary: clipSummary(r.excerpt),
        url: postPath(r.id, r.slug),
        time: r.updatedAt,
      };
    }),
  ];
  return hits.slice(0, limit * 2);
}
