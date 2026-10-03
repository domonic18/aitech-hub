/**
 * PAT 吊销 API(M5-c):仅会话通道(同 /api/pats)。幂等:已吊销返回 already。
 */
import { type NextRequest, NextResponse } from "next/server";

import { requireAdminRequest } from "@/lib/auth/guard";
import { revokePatById } from "@/lib/auth/pat";
import { isSameOrigin } from "@/lib/http/origin";
import { apiEnvelope } from "@/lib/http/response";
import { logger } from "@/lib/logger";

export const dynamic = "force-dynamic";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  if (req.headers.get("authorization") !== null) {
    return apiEnvelope(403, "PAT must not mint PATs");
  }
  if (!isSameOrigin(req)) return apiEnvelope(403, "cross-origin forbidden");
  const claims = await requireAdminRequest(req);
  if (!claims) {
    logger.warn({ event: "authz.denied", path: new URL(req.url).pathname });
    return apiEnvelope(401, "unauthorized");
  }

  const { id } = await params;
  const result = await revokePatById(id);
  if (result === "missing") return apiEnvelope(404, "令牌不存在");
  return apiEnvelope(0, result);
}
