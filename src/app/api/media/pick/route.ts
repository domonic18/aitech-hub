/**
 * GET /api/media/pick(2026-10-06 验收反馈问题5,封面工作流「媒体库选用」双源):
 * 选图弹层的轻量图片分页列表(createdAt 倒序,24/页,文件名模糊搜)。
 * 不做引用索引(listMediaAdmin 的重查只服务媒体库页);会话鉴权(编辑器交互面)。
 */
import { type NextRequest } from "next/server";

import { prisma } from "@/lib/db";
import { requireSessionActor } from "@/lib/http/session-guard";
import { apiEnvelope } from "@/lib/http/response";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 24;

export async function GET(req: NextRequest) {
  const actor = await requireSessionActor(req, "PAT 不能读取选图列表");
  if (actor.kind === "reject") return actor.response;

  const sp = req.nextUrl.searchParams;
  const page = Math.max(1, Math.trunc(Number(sp.get("page") ?? "1")) || 1);
  const q = (sp.get("q") ?? "").trim().slice(0, 100);
  const where = {
    deletedAt: null,
    kind: "image",
    ...(q ? { filename: { contains: q } } : {}),
  };
  const [rows, total] = await Promise.all([
    prisma.media.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      select: { path: true, thumbPath: true, width: true, height: true, filename: true },
    }),
    prisma.media.count({ where }),
  ]);
  return apiEnvelope(0, "ok", { items: rows, page, total, pageSize: PAGE_SIZE });
}
