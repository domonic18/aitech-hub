/**
 * /api/posts(M5-c「API 为核」;arch/05-services §5 content 行):
 *  - POST 新建草稿(编辑器,M5-a)。
 *  - GET 列表(双路鉴权:Bearer PAT 允许只读;GET 无 CSRF 面免 Origin 关)。
 *  - PUT upsert(requirement §3.6:markdown+images 随文,以 slug 幂等,
 *    默认草稿,publish=true 直发;Bearer PAT / 会话双路自动生效)。
 */
import { type NextRequest } from "next/server";

import { requireAdminActor } from "@/lib/http/mutation-guard";
import { apiEnvelope } from "@/lib/http/response";
import { logger } from "@/lib/logger";
import { upsertArticle } from "@/lib/content/publish-api";
import { publishUpsertSchema } from "@/lib/content/publish-schema";
import { postCreateSchema, ADMIN_LIST_SEGMENTS } from "@/lib/content/post-schema";
import { createPost, listPostsAdmin, type AdminListQuery } from "@/lib/content/posts-admin";

import { postErrorResponse, requireAdminForMutation } from "./shared";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const denied = await requireAdminForMutation(req);
  if (denied) return denied;

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return apiEnvelope(400, "invalid json");
  }
  const parsed = postCreateSchema.safeParse(raw);
  if (!parsed.success) {
    return apiEnvelope(400, `invalid body: ${parsed.error.issues.map((i) => i.message).join(";")}`);
  }

  try {
    const { id, slug } = await createPost(parsed.data);
    logger.info({ event: "post.create", id: id.toString(), slug });
    return apiEnvelope(0, "ok", { id: id.toString(), slug });
  } catch (e) {
    return postErrorResponse(e);
  }
}

/** 列表分段/页码解析(非法回落默认,与后台列表同语义) */
function parseListQuery(url: URL): {
  page: number;
  segment: AdminListQuery["segment"];
  q?: string;
} {
  const pageRaw = Number.parseInt(url.searchParams.get("page") ?? "1", 10);
  const segRaw = url.searchParams.get("status") ?? "all";
  return {
    page: Number.isInteger(pageRaw) && pageRaw >= 1 && pageRaw <= 10_000 ? pageRaw : 1,
    segment: (ADMIN_LIST_SEGMENTS as readonly string[]).includes(segRaw)
      ? (segRaw as AdminListQuery["segment"])
      : "all",
    q: url.searchParams.get("q")?.trim() || undefined,
  };
}

export async function GET(req: NextRequest) {
  const guard = await requireAdminActor(req);
  if (!guard.ok) return guard.response;

  const { page, segment, q } = parseListQuery(new URL(req.url));
  const { items, total, counts } = await listPostsAdmin({ page, segment, q });
  return apiEnvelope(0, "ok", {
    total,
    page,
    pageSize: items.length,
    counts,
    list: items.map((p) => ({
      id: p.id.toString(),
      slug: p.slug,
      title: p.title,
      status: p.status,
      category: p.category?.slug ?? null,
      tags: p.tags.map((t) => t.tag.name),
      publishedAt: p.publishedAt?.toISOString() ?? null,
      updatedAt: p.updatedAt.toISOString(),
    })),
  });
}

export async function PUT(req: NextRequest) {
  // 单次双路鉴权(requireAdminForMutation 的展开形态):actor 供审计
  const actorGuard = await requireAdminActor(req);
  if (!actorGuard.ok) return actorGuard.response;

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return apiEnvelope(400, "invalid json");
  }
  // 入参约束统一引用发布域 schema(publish-schema,与 MCP upsert_article 同源)
  const parsed = publishUpsertSchema.safeParse(raw);
  if (!parsed.success) {
    return apiEnvelope(400, `invalid body: ${parsed.error.issues.map((i) => i.message).join(";")}`);
  }

  try {
    const result = await upsertArticle({ ...parsed.data, actor: actorGuard.actor });
    return apiEnvelope(0, result.action, result);
  } catch (e) {
    return postErrorResponse(e);
  }
}
