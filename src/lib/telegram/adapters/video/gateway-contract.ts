/**
 * 采集网关(douyin-gateway)HTTP 契约(TS 侧唯一镜像):Zod schema 与
 * services/douyin-gateway/app/gateway.py 的 pydantic 模型逐字段对齐。
 * 黄金样本 fixtures 在网关侧 services/douyin-gateway/contract/,双侧
 * 对拍——网关改形状则 pytest 红→fixture 更新→本侧 vitest 红逼同步。
 * /sign 端点仅网关内部消费,不入此契约。
 * platform 维度:douyin=sec_uid(≥10 字符);bilibili=mid(1-16 位数字)。
 */
import { z } from "zod";

/** 平台枚举(M24 起 /posts /profile /resolve 共用;默认 douyin 平滑旧调用) */
export const gatewayPlatformSchema = z.enum(["douyin", "bilibili"]);
export type GatewayPlatform = z.infer<typeof gatewayPlatformSchema>;

/** 身份校验按平台分流(与网关 model_validator 同矩阵) */
function refineIdentity(
  data: { platform: GatewayPlatform; sec_uid: string },
  ctx: z.RefinementCtx,
): void {
  const value = data.sec_uid.trim();
  if (data.platform === "bilibili") {
    if (!/^\d{1,16}$/.test(value)) {
      ctx.addIssue({
        code: "custom",
        message: "bilibili sec_uid 须为 1-16 位数字 mid",
      });
    }
    return;
  }
  if (value.length < 10) {
    ctx.addIssue({ code: "custom", message: "sec_uid too short" });
  }
}

/** 出口代理字段(M33 批B):worker 解密随请求携带(网关零密钥);缺省=直连。
 * 边界与网关 pydantic 一致(min 8 / max 500),形态校验在 egress-proxy 入库侧。 */
const egressProxySchema = z.string().min(8).max(500).optional();

/** /posts 请求(边界与网关一致:sec_uid 1-128 + 平台身份矩阵、max_pages 1-3) */
export const postsRequestSchema = z
  .object({
    platform: gatewayPlatformSchema.default("douyin"),
    sec_uid: z.string().min(1).max(128),
    cookies: z.array(z.string()).default([]),
    max_pages: z.number().int().min(1).max(3).default(1),
    proxy: egressProxySchema,
  })
  .superRefine(refineIdentity);

/** 网关 VideoOut(pydantic 全字段序列化;published_at 为 ISO 字符串)。
 * video_id 网关侧必填(pydantic required,pytest 契约用例钉住);TS 侧宽容为
 * nullable 以保「单条脏数据丢弃不炸整包」的既有语义,包络级漂移仍响。
 * play_count 仅 bilibili 有值(douyin 恒 null);play_url 仅日志调试,禁止落库(版权红线)。 */
export const videoOutSchema = z.object({
  video_id: z.string().nullable().default(null),
  caption: z.string().nullable().default(null),
  topic_tags: z.array(z.string()).default([]),
  cover_url: z.string().nullable().default(null),
  play_url: z.string().nullable().default(null),
  duration_seconds: z.number().int().nullable().default(null),
  published_at: z.string().nullable().default(null),
  digg_count: z.number().int().nullable().default(null),
  comment_count: z.number().int().nullable().default(null),
  share_count: z.number().int().nullable().default(null),
  play_count: z.number().int().nullable().default(null),
});

export const postsResponseSchema = z.object({
  videos: z.array(videoOutSchema),
  has_more: z.boolean(),
  max_cursor: z.number(),
});

export const profileResponseSchema = z.object({
  sec_uid: z.string(),
  nickname: z.string(),
  avatar_url: z.string().nullable().default(null),
});

export const resolveResponseSchema = z.object({ sec_uid: z.string() });

/** /play-url 请求(仅 bilibili;play_url 版权红线:job data 过境即焚,禁落库/分发) */
export const playUrlRequestSchema = z.object({
  platform: z.literal("bilibili").default("bilibili"),
  video_id: z
    .string()
    .min(1)
    .max(64)
    .regex(/^BV[1-9A-HJ-NP-Za-km-z]{10}$/, "bilibili video_id 须为 BV 号"),
  cookies: z.array(z.string()).default([]),
  proxy: egressProxySchema,
});

export const playUrlResponseSchema = z.object({
  video_id: z.string(),
  play_url: z.string().nullable().default(null),
});

/** /subtitle 请求(M33 批C 字幕优先,仅 bilibili;字幕文本是「转写输入非
 * 资产」,与转写同红线:禁落库,仅 job 内存消费) */
export const subtitleRequestSchema = z.object({
  platform: z.literal("bilibili").default("bilibili"),
  video_id: z
    .string()
    .min(1)
    .max(64)
    .regex(/^BV[1-9A-HJ-NP-Za-km-z]{10}$/, "bilibili video_id 须为 BV 号"),
  cookies: z.array(z.string()).default([]),
  proxy: egressProxySchema,
});

export const subtitleResponseSchema = z.object({
  video_id: z.string(),
  subtitle_text: z.string().nullable().default(null),
  lang: z.string().nullable().default(null),
});

/** /health 分平台 jar 池观测(wbi_age_seconds 仅 bilibili 有值) */
export const platformHealthSchema = z.object({
  jars_total: z.number().int().default(0),
  jars_available: z.number().int().default(0),
  wbi_age_seconds: z.number().int().nullable().default(null),
});

/** /health(永远 200;驱动未就绪时 driver=null/槽位 0)。
 * 顶层 jars_* 保留 = douyin 段(旧消费方兼容);platforms 为 per-platform 全量;
 * egress_proxy(M33 批B)= 网关内存里有出口代理(只出布尔,永不出 URL)。 */
export const gatewayHealthSchema = z.object({
  status: z.string(),
  driver: z.string().nullable().default(null),
  warm_slots: z.number().int().default(0),
  in_use: z.number().int().default(0),
  last_error: z.string().nullable().default(null),
  jars_total: z.number().int().default(0),
  jars_available: z.number().int().default(0),
  egress_proxy: z.boolean().default(false),
  platforms: z.record(gatewayPlatformSchema, platformHealthSchema).default({
    douyin: { jars_total: 0, jars_available: 0, wbi_age_seconds: null },
    bilibili: { jars_total: 0, jars_available: 0, wbi_age_seconds: null },
  }),
});

/** 网关错误包络(best-effort):适配层异常带 {error, detail};
 * SignPageError/浏览器未就绪与 pydantic 422 只有 {detail},detail 兼容数组。 */
export const gatewayErrorSchema = z.object({
  error: z.string().optional(),
  detail: z.union([z.string(), z.array(z.unknown())]).optional(),
});

export type GatewayVideo = z.infer<typeof videoOutSchema>;
export type GatewayPostsResponse = z.infer<typeof postsResponseSchema>;
export type GatewayProfileResponse = z.infer<typeof profileResponseSchema>;
export type GatewayResolveResponse = z.infer<typeof resolveResponseSchema>;
export type GatewayPlayUrlResponse = z.infer<typeof playUrlResponseSchema>;
export type GatewayHealth = z.infer<typeof gatewayHealthSchema>;
