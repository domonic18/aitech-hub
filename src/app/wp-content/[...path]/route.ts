import path from "node:path";

import { type NextRequest, NextResponse } from "next/server";

import { normalizeUrlPath } from "@/lib/slug";
import { mediaStorage, uploadsUrlToRel } from "@/lib/media/storage";

/**
 * /wp-content/** 文件服务(生产由 Nginx 直服本地卷或反代 COS,arch/07-frontend §3,
 * 该路由仅本地开发与 E2E 兜底;URL 路径原样保留(媒体零改写原则,arch/08-media))。
 * 经 mediaStorage 单例取字节(M19 批①):MEDIA_STORAGE=local/cos 开发侧行为一致,
 * 不再旁路直读盘。
 */
export const dynamic = "force-dynamic";

const MIME_BY_EXT: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".bmp": "image/bmp",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".avif": "image/avif",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".mp3": "audio/mpeg",
  ".pdf": "application/pdf",
  ".txt": "text/plain; charset=utf-8",
};

const UPLOADS_PREFIX = "uploads/"; // catch-all 段不含路由文件夹前缀 wp-content

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ path: string[] }> },
): Promise<NextResponse> {
  const { path: segments } = await params;
  const joined = segments.join("/");
  if (!joined.startsWith(UPLOADS_PREFIX) || joined.includes("..")) {
    return new NextResponse(null, { status: 404 }) as NextResponse;
  }
  // params 已解码,重编码还原 URL 形态(存储 key 与 URL 段逐字节同构,红线见 storage.ts 文件头)
  const rel = uploadsUrlToRel(`/wp-content/${normalizeUrlPath(joined)}`);
  if (!rel) return new NextResponse(null, { status: 404 }) as NextResponse;
  const file = await mediaStorage.get(rel);
  if (!file) return new NextResponse(null, { status: 404 }) as NextResponse;

  return new NextResponse(new Uint8Array(file), {
    headers: {
      "Content-Type": MIME_BY_EXT[path.extname(rel).toLowerCase()] ?? "application/octet-stream",
      // 生产为 Nginx immutable 长缓存;此处开发级时长即可
      "Cache-Control": "public, max-age=3600",
    },
  }) as NextResponse;
}
