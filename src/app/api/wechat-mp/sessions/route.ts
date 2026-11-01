/**
 * 公众号会话列表(M66):按最后发言时间倒序,支持 page / q / status。
 * admin-only(cookie 会话);只读。
 */
import { type NextRequest, NextResponse } from "next/server";

import { requireAdminRequest } from "@/lib/auth/guard";
import { listSessionsAdmin, type SessionStatus } from "@/lib/channel/wechat-mp/admin";
import { apiEnvelope } from "@/lib/http/response";

export const dynamic = "force-dynamic";

const STATUSES: readonly SessionStatus[] = ["all", "pending", "bound", "unsubscribed"];

export async function GET(req: NextRequest): Promise<NextResponse> {
  if (!(await requireAdminRequest(req))) return apiEnvelope(401, "unauthorized");

  const sp = req.nextUrl.searchParams;
  const pageRaw = Number(sp.get("page") ?? "1");
  const page = Number.isFinite(pageRaw) && pageRaw > 0 ? Math.floor(pageRaw) : 1;
  const statusRaw = (sp.get("status") ?? "all") as SessionStatus;
  const status = STATUSES.includes(statusRaw) ? statusRaw : "all";

  const result = await listSessionsAdmin({ page, q: sp.get("q") ?? "", status });
  return apiEnvelope(0, "ok", result);
}
