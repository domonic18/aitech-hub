/**
 * 媒体域协议唯一出口(M5-b;评审 W1 同款模式:Zod 与 UI 共用一套 LIMITS;
 * 评审 W4:跨端线类型——上传结果/转存结果/详情响应——同源,客户端不手写同形接口)。
 * arch/08-media:上传白名单 jpg/png/webp/gif ≤10MB;视频不经应用服务器(STS 直传 COS,二期)。
 */
import { z } from "zod";

/** 上传与导入的数值边界(Zod 校验与 UI 提示的唯一来源) */
export const MEDIA_LIMITS = {
  /** 单文件上传上限(arch/08-media §3.4) */
  maxUploadBytes: 10 * 1024 * 1024,
  /** 一键发文单批外链转存上限(防滥用;超出提示分批) */
  maxBatchUrls: 30,
  /** 外链抓取单张大小上限(与上传同限) */
  maxFetchBytes: 10 * 1024 * 1024,
  /** 外链抓取单张超时(worker media.transfer) */
  fetchTimeoutMs: 15_000,
  /** 缩略图宽(worker sharp 生成,arch/08-media §3.4) */
  thumbWidth: 640,
  /** WebP 副本质量 */
  webpQuality: 80,
  /** 媒体库分页大小 */
  pageSize: 24,
  /** 软删回收站保留天数(到期 audit 物理删除;UI 文案同源插值) */
  trashDays: 7,
  /** filename 截断长度(绑定 schema Media.filename VarChar(255)) */
  maxFilenameChars: 255,
} as const;

/** 一天毫秒数(近 30 天统计 / 回收站到期换算共用) */
export const DAY_MS = 24 * 3600 * 1000;

/** POST /api/media 的 multipart 文件字段名(服务端与 upload-client 同源,评审 W4) */
export const UPLOAD_FIELD = "file";

export const MEDIA_KINDS = ["image", "video", "file"] as const;
export type MediaKind = (typeof MEDIA_KINDS)[number];

/**
 * status 全集(应用层 Zod 管控,arch/03 枚举演进条款):
 * processing(上传入库待 sharp)/ active / orphan(audit 判定无引用)/
 * missing(audit 判定文件丢失,断链)/ error(sharp 或转存失败)/ deleted(软删回收站)。
 */
export const MEDIA_STATUSES = [
  "processing",
  "active",
  "orphan",
  "missing",
  "error",
  "deleted",
] as const;
export type MediaStatus = (typeof MEDIA_STATUSES)[number];

/** 媒体库引用状态过滤(trash=回收站:deletedAt 非空视图;断链为引用侧视图,不入此过滤) */
export const MEDIA_REF_FILTERS = ["all", "referenced", "orphan", "trash"] as const;
export type MediaRefFilter = (typeof MEDIA_REF_FILTERS)[number];

/** 图片 mime 白名单(arch/08-media §3.4;gif 保动画:worker 以 animated webp 出副本) */
export const IMAGE_MIME_WHITELIST = ["image/jpeg", "image/png", "image/webp", "image/gif"] as const;

/**
 * 魔数嗅探图片 mime(M27 批⑦ 传参错误根治:声明 mime 全链路仅作展示提示,
 * 字节是唯一裁决——CDN content-type 缺省/漂移、image/jpg 类传参错一律不再
 * 415;非白名单格式或字节损坏返回 null,由调用方拒收)
 */
export function sniffImageMime(bytes: Uint8Array): (typeof IMAGE_MIME_WHITELIST)[number] | null {
  const b = bytes;
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (b.length >= 4 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) {
    return "image/png";
  }
  if (
    b.length >= 12 &&
    b[0] === 0x52 && // RIFF....WEBP
    b[8] === 0x57 &&
    b[9] === 0x45 &&
    b[10] === 0x42 &&
    b[11] === 0x50
  ) {
    return "image/webp";
  }
  if (b.length >= 4 && b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x38) {
    return "image/gif"; // GIF8(GIF87a/89a)
  }
  return null;
}

export const MIME_BY_EXT: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  gif: "image/gif",
};

/** mime → 存储扩展名(jpeg 归一为 jpg,sha1 文件名用) */
export function extByMime(mime: string): string | null {
  switch (mime) {
    case "image/jpeg":
      return "jpg";
    case "image/png":
      return "png";
    case "image/webp":
      return "webp";
    case "image/gif":
      return "gif";
    default:
      return null;
  }
}

/** 一键发文:外链转存批次入参(Handler 边界 Zod) */
export const mediaImportSchema = z.object({
  urls: z
    .array(z.url("外链必须是合法 URL").startsWith("http", "仅支持 http(s) 外链"))
    .min(1, "至少一条外链")
    .max(MEDIA_LIMITS.maxBatchUrls, `单批最多 ${MEDIA_LIMITS.maxBatchUrls} 条外链`),
});
export type MediaImportInput = z.infer<typeof mediaImportSchema>;

/** 批量删除入参(软删;有引用的条目被跳过并在响应中列出) */
export const mediaBatchDeleteSchema = z.object({
  ids: z.array(z.string().regex(/^\d+$/, "id 必须是数字")).min(1, "至少选择一条").max(200),
});

/** 批量删除响应 data(service 返回、batch-delete 路由透传、MediaGrid 消费同源) */
export interface BatchDeleteResult {
  deleted: number;
  skipped: Array<{ id: string; filename: string; refCount: number }>;
}

/** 回收站恢复响应 data(service 返回、restore 路由透传、MediaGrid 消费同源) */
export interface MediaRestoreResult {
  id: string;
  path: string;
  /** 恢复时按实时引用口径重算(有引用 active / 无引用 orphan) */
  status: MediaStatus;
}

/** 回收站立即清除响应 data(物理删文件家族 + 记录,绕过 7 天等待;admin 显式动作) */
export interface MediaPurgeResult {
  id: string;
  path: string;
}

/** 重复检测合并入参(同 sha1 组;2026-10-06 验收反馈问题1) */
export const mediaDupeMergeSchema = z.object({
  sha1: z.string().regex(/^[0-9a-f]{40}$/, "sha1 格式不合法"),
});

/** 重复组合并响应 data(service 返回、dupes/merge 路由透传、MediaDupeList 消费同源) */
export interface DupeMergeResult {
  keptId: string;
  keptPath: string;
  /** 改指 keeper 的引用行数(正文 MediaRef,含封面改指) */
  movedRefs: number;
  /** 软删入回收站的副本数 */
  removed: number;
}

/** media.transfer job returnvalue(worker 写、import 路由与导入弹窗读,评审 W4 同源) */
export interface TransferResult {
  mapping: Record<string, string | null>;
  ok: number;
  failed: number;
}

/** GET /api/media/[id] 响应 data(路由组装、MediaDrawer 消费;createdAt 为 JSON 字符串) */
export interface MediaDetailMedia {
  id: string;
  path: string;
  filename: string;
  kind: MediaKind;
  status: MediaStatus;
  storage: string;
  sizeBytes: number | null;
  width: number | null;
  height: number | null;
  sha1: string | null;
  thumbPath: string | null;
  createdAt: string;
}

export interface MediaDetailRef {
  id: string;
  slug: string | null; // 2026-10 起 Post.slug 可空(bare-id URL)
  title: string;
  publishedAt: string | null;
}

export interface MediaDetailData {
  media: MediaDetailMedia;
  refs: MediaDetailRef[];
}

/** 媒体库列表过滤参数解析(page/RSC 服务端入参) */
export function parseRefFilter(raw: string | undefined): MediaRefFilter {
  return (MEDIA_REF_FILTERS as readonly string[]).includes(raw ?? "")
    ? (raw as MediaRefFilter)
    : "all";
}

export function parseKind(raw: string | undefined): MediaKind {
  return (MEDIA_KINDS as readonly string[]).includes(raw ?? "") ? (raw as MediaKind) : "image";
}

/** 字节数人性化(媒体库统计卡与卡片副标) */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}
