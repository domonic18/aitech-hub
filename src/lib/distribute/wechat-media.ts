/**
 * 公众号同步 · 图片装载与转存(M17 批③):
 * - 站内图读盘(uploadsUrlToRel 不 decode 红线)/ 外链图下载(fetchExternalImage 共享口径);
 * - 魔数嗅探 + WebP→JPEG 必转(媒体管线主图多 .webp,微信 uploadimg/add_material
 *   仅收 bmp/png/jpeg/gif;sharp 延迟 import,worker/media.ts:32 先例);
 * - publish_media_cache 防重推(sourceKey 前缀 b:站内字节/u:外链 URL/m:封面字节,
 *   mmbiz URL 永久有效无 TTL);单图失败收集清单,调用方整篇终止防公众号裂图。
 */
import { createHash } from "node:crypto";

import { isP2002, prisma } from "../db";
import { fetchExternalImage } from "../media/fetch-external";
import { extractImageRefs, replaceImageRefs } from "../media/import-md";
import { mediaStorage, uploadsUrlToRel } from "../media/storage";
import { CHANNEL_WECHAT } from "./channels";
import { wechatAddCoverMaterial, wechatUploadImage, type WechatCredentials } from "./wechat-client";

const sha1Hex = (bytes: Uint8Array): string => createHash("sha1").update(bytes).digest("hex");

/** 图片字节装载:外链下载或站内读盘 */
async function loadImageBytes(src: string, external: boolean): Promise<Uint8Array> {
  if (external) {
    const { data } = await fetchExternalImage(src);
    return data;
  }
  const rel = uploadsUrlToRel(src);
  if (!rel) throw new Error(`非法站内图片路径:${src}`);
  const buf = await mediaStorage.get(rel);
  if (!buf) throw new Error(`站内图片文件缺失:${src}`);
  return new Uint8Array(buf);
}

type WechatImageMime = "image/png" | "image/jpeg" | "image/webp" | "image/gif";

/** 魔数嗅探(gif 微信可收,与生图 sniffImageMime 口径分立);不识别即拒 */
function sniffWechatImageMime(b: Uint8Array): WechatImageMime {
  if (b.length >= 8 && b[0] === 0x89 && b[1] === 0x50) return "image/png";
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8) return "image/jpeg";
  if (b.length >= 12 && b[8] === 0x57) return "image/webp";
  if (b.length >= 3 && b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46) return "image/gif";
  throw new Error("不支持的图片格式(微信仅收 png/jpeg/gif)");
}

interface PreparedImage {
  bytes: Uint8Array;
  mime: WechatImageMime;
  filename: string;
}

/** WebP → JPEG(q82);其余原样(文件名按嗅探 MIME 归一) */
async function prepareWechatImage(bytes: Uint8Array): Promise<PreparedImage> {
  const mime = sniffWechatImageMime(bytes);
  if (mime !== "image/webp") {
    const ext = mime === "image/png" ? "png" : mime === "image/gif" ? "gif" : "jpg";
    return { bytes, mime, filename: `image.${ext}` };
  }
  const sharp = (await import("sharp")).default;
  const jpeg = await sharp(bytes).jpeg({ quality: 82 }).toBuffer();
  return { bytes: new Uint8Array(jpeg), mime: "image/jpeg", filename: "image.jpg" };
}

/** 转存缓存取用:命中零上传;miss 上传后落行(并发同图 P2002 兜底,以库内为准) */
async function cachedRemote(
  sourceKey: string,
  sourceUrl: string,
  upload: () => Promise<{ url: string; mediaId?: string }>,
): Promise<{ url: string; mediaId?: string }> {
  const hit = await prisma.publishMediaCache.findUnique({
    where: { channel_sourceKey: { channel: CHANNEL_WECHAT, sourceKey } },
  });
  if (hit) return { url: hit.remoteUrl, mediaId: hit.remoteMediaId ?? undefined };
  const r = await upload();
  try {
    await prisma.publishMediaCache.create({
      data: {
        channel: CHANNEL_WECHAT,
        sourceKey,
        sourceUrl: sourceUrl.slice(0, 1000),
        remoteUrl: r.url,
        ...(r.mediaId ? { remoteMediaId: r.mediaId } : {}),
      },
    });
  } catch (e) {
    if (!isP2002(e)) throw e;
  }
  return r;
}

/** 正文图逐张转存(缓存命中零上传)→ md 图链全部替换为 mmbiz;
 * 任一图失败抛错列 src 清单(整篇终止——公众号内裂图比不同步更糟) */
export async function transloadContentImages(
  creds: WechatCredentials,
  mdText: string,
): Promise<string> {
  const refs = extractImageRefs(mdText); // data: 内联图已由解析跳过
  const mapping: Record<string, string> = {};
  const failures: { src: string; reason: string }[] = [];
  for (const ref of refs) {
    try {
      const bytes = await loadImageBytes(ref.src, ref.external);
      // sourceKey 用源字节锚定:同图即使转换路径变化也命中缓存
      const sourceKey = (ref.external ? "u:" : "b:") + sha1Hex(bytes);
      const prepared = await prepareWechatImage(bytes);
      const r = await cachedRemote(sourceKey, ref.src, () =>
        wechatUploadImage(creds, prepared.bytes, prepared.filename, prepared.mime).then((url) => ({
          url,
        })),
      );
      mapping[ref.src] = r.url;
    } catch (e) {
      failures.push({ src: ref.src, reason: e instanceof Error ? e.message : String(e) });
    }
  }
  if (failures.length > 0) {
    throw new Error(
      `正文图转存失败 ${failures.length} 张(整篇终止):` +
        failures.map((f) => `${f.src}(${f.reason})`).join(";"),
    );
  }
  return replaceImageRefs(mdText, mapping);
}

/** 封面永久素材(media_id 必须来自 add_material,临时素材/外链不可当 thumb):
 * 缓存 m: 命中零上传 */
export async function ensureCoverMedia(
  creds: WechatCredentials,
  coverPath: string,
): Promise<{ mediaId: string }> {
  const bytes = await loadImageBytes(coverPath, /^https?:\/\//i.test(coverPath));
  const prepared = await prepareWechatImage(bytes);
  const r = await cachedRemote(`m:${sha1Hex(bytes)}`, coverPath, async () => {
    const added = await wechatAddCoverMaterial(
      creds,
      prepared.bytes,
      prepared.filename,
      prepared.mime,
    );
    return { url: added.url, mediaId: added.mediaId };
  });
  if (!r.mediaId) throw new Error("封面缓存缺 media_id(缓存行异常)");
  return { mediaId: r.mediaId };
}
