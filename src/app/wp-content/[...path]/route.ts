import { readFile } from "node:fs/promises";
import path from "node:path";

import { type NextRequest, NextResponse } from "next/server";

import { env } from "@/lib/env";
import { normalizeUrlPath } from "@/lib/slug";

/**
 * /wp-content/** 本地文件服务(生产由 Nginx 直接服务 media/ 卷,arch/07-frontend §3,
 * 该路由仅本地开发与 E2E 兜底;URL 路径原样保留(媒体零改写原则,arch/08-media))。
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
  const root = path.resolve(process.cwd(), env.MEDIA_DIR);
  // 磁盘文件名保持 percent-encoded 形态(与 DB 路径一致);params 已解码,重编码后再查盘
  const filePath = path.resolve(root, normalizeUrlPath(joined).slice(UPLOADS_PREFIX.length));
  if (!filePath.startsWith(root + path.sep)) {
    return new NextResponse(null, { status: 404 }) as NextResponse;
  }
  const file = await readFile(filePath).catch(() => null);
  if (!file) return new NextResponse(null, { status: 404 }) as NextResponse;

  return new NextResponse(new Uint8Array(file), {
    headers: {
      "Content-Type":
        MIME_BY_EXT[path.extname(filePath).toLowerCase()] ?? "application/octet-stream",
      // 生产为 Nginx immutable 长缓存;此处开发级时长即可
      "Cache-Control": "public, max-age=3600",
    },
  }) as NextResponse;
}
