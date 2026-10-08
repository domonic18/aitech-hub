/**
 * 媒体上传客户端封装(M5-b 评审 W4):multipart 字段名、信封解析、reused 语义收口一处,
 * 媒体库/一键发文/封面/截图粘贴四个调用点共用,不再各自手写 POST /api/media 协议。
 */
import { type ApiEnvelope } from "@/lib/http/response";
import { UPLOAD_FIELD } from "@/lib/media/media-schema";
import type { UploadResult } from "@/lib/media/service";

type UploadBody = ApiEnvelope<UploadResult | null>;

export type UploadOutcome =
  { ok: true; path: string; reused: boolean } | { ok: false; error: string };

/** 上传一个文件(blob),返回站内路径或错误文案(含状态码兜底);网络异常不抛出 */
export async function uploadImageFile(file: Blob, filename: string): Promise<UploadOutcome> {
  const fd = new FormData();
  fd.set(UPLOAD_FIELD, file, filename);
  try {
    const res = await fetch("/api/media", { method: "POST", body: fd });
    const body = (await res.json().catch(() => null)) as UploadBody | null;
    if (res.ok && body?.code === 0 && body.data) {
      return { ok: true, path: body.data.path, reused: body.data.reused };
    }
    return { ok: false, error: body?.message ?? `上传失败(${res.status})` };
  } catch {
    return { ok: false, error: "网络错误" };
  }
}
