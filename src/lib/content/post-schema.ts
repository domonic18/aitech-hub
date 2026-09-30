/**
 * 文章管理边界与状态口径(M5-a,arch/05-services §5 content 行):
 * 状态值仅 draft/published/deleted(软删);展示态由 status+publishedAt 派生——
 * 下架 = 回 draft 保留 published_at(前台不可见,可重新上架),纯草稿 publishedAt 为空。
 * 纯函数零 IO:Handler 与编辑器共用同一真相源,单测钉行为。
 */
import { z } from "zod";

import { normalizeSlug } from "@/lib/slug";

export const POST_STATUS_DELETED = "deleted";

/** 展示态(原型 admin-posts 四分段映射:全部/已发布/草稿/已下架) */
export type PostDisplayState = "published" | "draft" | "unpublished";

export function postDisplayState(post: {
  status: string;
  publishedAt: Date | null;
}): PostDisplayState {
  if (post.status === "published") return "published";
  return post.publishedAt ? "unpublished" : "draft";
}

export const ADMIN_LIST_SEGMENTS = ["all", "published", "draft", "unpublished"] as const;
export type AdminListSegment = (typeof ADMIN_LIST_SEGMENTS)[number];

/** slug 边界:先归一化(arch/07-frontend §2 红线,统一 percent-encoded 小写)再验空 */
export const slugSchema = z
  .string()
  .max(255, "slug 最长 255 字符")
  .transform((s) => s.trim())
  .transform((s) => normalizeSlug(s))
  .refine((s) => s.length > 0, "slug 归一化后为空");

const optionalText = (max: number) =>
  z
    .string()
    .max(max, `最长 ${max} 字符`)
    .transform((s) => s.trim())
    .transform((s) => (s === "" ? undefined : s))
    .optional();

/** 封面 M5-a 为站内路径手填(上传工作流随 M5-b);空串归一为未设置 */
export const coverPathSchema = z
  .string()
  .max(500, "封面路径最长 500 字符")
  .transform((s) => s.trim())
  .refine((s) => s === "" || s.startsWith("/"), "封面须为 / 开头的站内路径");

export const postCreateSchema = z.object({
  title: z.string().trim().min(1, "标题不能为空").max(500, "标题最长 500 字符"),
  /** 缺省时由 service 以标题派生(normalizeSlug) */
  slug: slugSchema.optional(),
  categorySlug: slugSchema,
  /** 按名自动建(原型 admin-editor:upsert_article 同规则),去重由 service 做 */
  tags: z
    .array(z.string().trim().min(1, "标签不能为空").max(100, "单个标签最长 100 字符"))
    .max(5, "标签最多 5 个")
    .max(100) // 序列化护栏:5 个标签本身不会超,防异常请求
    .default([]),
  contentMd: z.string().min(1, "正文不能为空").max(500_000, "正文过长(上限 50 万字符)"),
  excerpt: optionalText(500),
  coverPath: coverPathSchema.optional(),
  seoTitle: optionalText(255),
  seoDescription: optionalText(500),
});

/** 更新不含 slug:slug 创建时定死,发布后改 slug = 毁 URL(SEO 红线) */
export const postUpdateSchema = postCreateSchema.omit({ slug: true });

export type PostCreateInput = z.infer<typeof postCreateSchema>;
export type PostUpdateInput = z.infer<typeof postUpdateSchema>;
