/**
 * 抖音网关 HTTP 契约(TS 侧唯一镜像):Zod schema 与
 * services/douyin-gateway/app/gateway.py 的 pydantic 模型逐字段对齐。
 * 黄金样本 fixtures 在网关侧 services/douyin-gateway/contract/,双侧
 * 对拍——网关改形状则 pytest 红→fixture 更新→本侧 vitest 红逼同步。
 * /sign 端点仅网关内部消费,不入此契约。
 */
import { z } from "zod";

/** /posts 请求(边界与网关一致:sec_uid 10-128、max_pages 1-3) */
export const postsRequestSchema = z.object({
  sec_uid: z.string().min(10).max(128),
  cookies: z.array(z.string()).default([]),
  max_pages: z.number().int().min(1).max(3).default(1),
});

/** 网关 VideoOut(pydantic 全字段序列化;published_at 为 ISO 字符串)。
 * video_id 网关侧必填(pydantic required,pytest 契约用例钉住);TS 侧宽容为
 * nullable 以保「单条脏数据丢弃不炸整包」的既有语义,包络级漂移仍响。 */
export const videoOutSchema = z.object({
  video_id: z.string().nullable().default(null),
  caption: z.string().nullable().default(null),
  topic_tags: z.array(z.string()).default([]),
  cover_url: z.string().nullable().default(null),
  play_url: z.string().nullable().default(null), // 仅日志调试,禁止落库(版权红线)
  duration_seconds: z.number().int().nullable().default(null),
  published_at: z.string().nullable().default(null),
  digg_count: z.number().int().nullable().default(null),
  comment_count: z.number().int().nullable().default(null),
  share_count: z.number().int().nullable().default(null),
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

/** /health(永远 200;驱动未就绪时 driver=null/槽位 0) */
export const gatewayHealthSchema = z.object({
  status: z.string(),
  driver: z.string().nullable().default(null),
  warm_slots: z.number().int().default(0),
  in_use: z.number().int().default(0),
  last_error: z.string().nullable().default(null),
  jars_total: z.number().int().default(0),
  jars_available: z.number().int().default(0),
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
export type GatewayHealth = z.infer<typeof gatewayHealthSchema>;
