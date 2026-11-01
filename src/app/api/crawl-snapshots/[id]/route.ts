/**
 * 采集快照文件读取(M56 P0 回溯档案,2026-10-29):?f=view(原页预览)|
 * raw(源码)| png(整页截图)。admin-only;快照是第三方站点原文,故:
 * - 预览一律 `Content-Security-Policy: sandbox`(不透明源:脚本/表单/顶层跳转
 *   全禁,只当静态文档看),nosniff 防 MIME 嗅探;
 * - no-store(私有证据不进任何缓存层)。
 */
import { type NextRequest, NextResponse } from "next/server";

import { requireAdminRequest } from "@/lib/auth/guard";
import { loadSnapshotFile } from "@/lib/collect/snapshot-admin";
import { apiEnvelope } from "@/lib/http/response";

export const dynamic = "force-dynamic";

const ID_RE = /^\d{1,19}$/;

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  if (!(await requireAdminRequest(req))) return apiEnvelope(401, "unauthorized");
  const { id } = await params;
  if (!ID_RE.test(id)) return apiEnvelope(400, "invalid id");
  const f = req.nextUrl.searchParams.get("f") ?? "view";
  if (f !== "view" && f !== "raw" && f !== "png") return apiEnvelope(400, "invalid f");

  const file = await loadSnapshotFile(BigInt(id), f);
  if (file === null) return apiEnvelope(404, "快照对象不存在或已按保留策略清理");

  const headers: Record<string, string> = {
    "content-type": file.contentType,
    "content-length": String(file.body.byteLength),
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
  };
  if (f === "raw") headers["content-disposition"] = "inline";
  if (f === "view") headers["content-security-policy"] = "sandbox";
  return new NextResponse(new Uint8Array(file.body), { status: 200, headers });
}
