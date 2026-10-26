/**
 * GET /api/posts/cover-candidates/[id]/raw(M31 验收反馈;批④ token 挪
 * x-cover-token 头——query 会落访问/代理日志):agent 封面候选预览——hold
 * 临时件按字节回图(卡片 fetch→blob 再进 <img>);已入库行 302 到正式媒体
 * 路径(同源跟随,取图不受影响)。token 须与候选行匹配;会话鉴权(编辑器
 * 交互面)。
 */
import { type NextRequest } from "next/server";

import { prisma } from "@/lib/db";
import { COVER_TEMP_PREFIX, readHoldCandidate } from "@/lib/ai/cover-generate";
import { requireSessionActor } from "@/lib/http/session-guard";
import { apiEnvelope } from "@/lib/http/response";
import { parseBigIntId } from "@/lib/http/parse-id";

export const dynamic = "force-dynamic";

function mimeByPath(p: string): string {
  if (p.endsWith(".png")) return "image/png";
  if (p.endsWith(".jpg") || p.endsWith(".jpeg")) return "image/jpeg";
  return "image/webp";
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const actor = await requireSessionActor(req, "PAT 不能读取封面候选预览");
  if (actor.kind === "reject") return actor.response;

  const { id } = await params;
  const bigId = parseBigIntId(id);
  if (bigId === null) return apiEnvelope(400, "候选 id 不合法");
  const token = req.headers.get("x-cover-token") ?? "";
  if (!/^[0-9a-f-]{8,64}$/.test(token)) return apiEnvelope(400, "token 缺失或不合法");

  const row = await prisma.coverCandidate.findUnique({
    where: { id: bigId },
    select: { token: true, mediaPath: true },
  });
  if (!row || row.token !== token) return apiEnvelope(404, "候选不存在或已清理");

  if (!row.mediaPath.startsWith(COVER_TEMP_PREFIX)) {
    // 已入库:302 到正式媒体路径(静态直服)
    return new Response(null, { status: 302, headers: { location: row.mediaPath } });
  }
  const bytes = await readHoldCandidate(row.mediaPath);
  if (bytes === null) return apiEnvelope(404, "候选临时文件已失效");
  return new Response(bytes as unknown as BodyInit, {
    headers: {
      "content-type": mimeByPath(row.mediaPath),
      "cache-control": "private, no-store",
    },
  });
}
