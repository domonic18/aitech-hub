/**
 * 卡片渲染站内引图内联(M31 COS 引图补丁):渲染 sidecar 只认 data: URI(零密钥
 * 零外网,原 file:// 直读本地卷随 COS 主存失效——卷缺新图静默 1×1 占位即本补丁
 * 根因)。POST 前把 src=/url() 的 /wp-content/uploads/* 经 mediaStorage 读字节
 * (prod=cos/dev=local 同一抽象)转 data URI 注入;缺失即抛人话错替代静默占位。
 * 预算:渲染端硬上限 HTML 400k 字符/请求体 6MB,单图 >220KB 走 sharp 压缩
 * (1800px=900 CSS×scale2 满宽;GIF 压后变静帧,可接受),总量 >360k 字符拒渲。
 */
import { MEDIA_MIME_BY_EXT, mediaStorage, uploadsUrlToRel } from "../media/storage";

/** 单图内联原始字节上限(≈300k base64 字符),超出走 sharp 压缩 */
const INLINE_RAW_MAX_BYTES = 220 * 1024;
/** 全部 data URI 字符总量上限(渲染端 400k HTML 上限留 40k 骨架余量) */
const INLINE_TOTAL_MAX_CHARS = 360_000;
/** 压缩目标边长与质量(卡片 900 CSS × scale2 满宽;q82 同公众号转码口径) */
const RESIZE_MAX_EDGE = 1800;
const JPEG_QUALITY = 82;

/** src="…" 与 css url(…) 两形态(引号必带/可省同旧 rewrite 口径);路径字符集同 sanitize 白名单 */
const MEDIA_REF_RE = /(src\s*=\s*["']|url\(\s*["']?)(\/wp-content\/uploads\/[A-Za-z0-9/._-]+)/g;

const extOf = (p: string): string => {
  const fileName = p.slice(p.lastIndexOf("/") + 1);
  const dot = fileName.lastIndexOf(".");
  return dot >= 0 ? fileName.slice(dot).toLowerCase() : "";
};

/** 字节 → data URI;超大/未知格式经 sharp 统一压成 jpeg(失败抛人话错,不静默) */
async function toDataUri(path: string, buf: Buffer): Promise<string> {
  const mime = MEDIA_MIME_BY_EXT[extOf(path)];
  if (buf.length <= INLINE_RAW_MAX_BYTES && mime?.startsWith("image/")) {
    return `data:${mime};base64,${buf.toString("base64")}`;
  }
  const sharp = (await import("sharp")).default;
  let jpeg: Buffer;
  try {
    jpeg = await sharp(buf)
      .resize({
        width: RESIZE_MAX_EDGE,
        height: RESIZE_MAX_EDGE,
        fit: "inside",
        withoutEnlargement: true,
      })
      .jpeg({ quality: JPEG_QUALITY })
      .toBuffer();
  } catch (e) {
    throw new Error(
      `配图 ${path} 无法解码转码,请更换图片(${e instanceof Error ? e.message : "未知错误"})`,
    );
  }
  if (jpeg.length > INLINE_RAW_MAX_BYTES) {
    throw new Error(
      `配图 ${path} 过大,压缩后仍超 ${Math.floor(INLINE_RAW_MAX_BYTES / 1024)}KB,请换小图`,
    );
  }
  return `data:image/jpeg;base64,${jpeg.toString("base64")}`;
}

/** 站内引图 → data URI 内联;缺失/超预算抛错(报错传导供 agent/预览自纠,替代静默占位) */
export async function inlineSiteMediaRefs(html: string): Promise<string> {
  const paths = [...new Set([...html.matchAll(MEDIA_REF_RE)].map((m) => m[2]))];
  if (paths.length === 0) return html;
  const uris = await Promise.all(
    paths.map(async (path) => {
      const rel = uploadsUrlToRel(path);
      if (!rel) throw new Error(`非法站内图片路径:${path}`);
      const buf = await mediaStorage.get(rel);
      if (!buf) throw new Error(`站内图片文件缺失:${path}`);
      return toDataUri(path, buf);
    }),
  );
  const total = uris.reduce((n, u) => n + u.length, 0);
  if (total > INLINE_TOTAL_MAX_CHARS) {
    throw new Error(
      `配图总量过大(内联约 ${Math.floor(total / 1000)}k 字符,上限 ${INLINE_TOTAL_MAX_CHARS / 1000}k),请减少图片张数或换小图`,
    );
  }
  const byPath = new Map(paths.map((p, i) => [p, uris[i]]));
  return html.replace(
    MEDIA_REF_RE,
    (_m, lead: string, path: string) => `${lead}${byPath.get(path)}`,
  );
}
