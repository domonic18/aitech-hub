/**
 * 文章管理边界与状态口径(M5-a,arch/05-services §5 content 行):
 * 状态值仅 draft/published/deleted(软删);展示态由 status+publishedAt 派生——
 * 下架 = 回 draft 保留 published_at(前台不可见,可重新上架),纯草稿 publishedAt 为空。
 * 纯函数零 IO:Handler 与编辑器共用同一真相源,单测钉行为。
 */
import { z } from "zod";

import { isAsciiSlug } from "./post-path";
import { normalizeSlug } from "@/lib/slug";

export const POST_STATUS_DELETED = "deleted";

/**
 * 创作方式(2026-10-05 合规,四部门《人工智能生成合成内容标识办法》2025-09-01 施行):
 * AI 生成内容传播须带显式标识;human 为缺省(154 篇迁移旧文全量 human,零影响)。
 * 展示文案(详情页标注)与此处一一对应,人工原创不展示。
 */
export const CONTENT_ORIGINS = ["human", "ai_assisted", "ai_generated"] as const;
export type ContentOrigin = (typeof CONTENT_ORIGINS)[number];

export const CONTENT_ORIGIN_LABELS: Record<ContentOrigin, string> = {
  human: "",
  ai_assisted: "本文为 AI 辅助创作,经人工审核修订",
  ai_generated: "本文由 AI 生成",
};

/** 徽章短标(详情页 meta 行):human 恒空不渲染 */
export const CONTENT_ORIGIN_BADGES: Record<ContentOrigin, string> = {
  human: "",
  ai_assisted: "AI 辅助",
  ai_generated: "AI 生成",
};

/** 合法值应用层枚举(arch/03 枚举演进条款):非法值拒绝,缺省 human */
export const contentOriginSchema = z.enum(CONTENT_ORIGINS).default("human");

/** 读侧宽容归一(展示/编辑器取数,与 postDisplayState 同哲学):历史脏值回退 human */
export function asContentOrigin(v: string): ContentOrigin {
  return (CONTENT_ORIGINS as readonly string[]).includes(v) ? (v as ContentOrigin) : "human";
}

/**
 * 文章字段边界数值唯一真相源(M5-a 评审 W1):Zod 边界与编辑器 UI(maxLength/计数)
 * 共用同一组数字,改上限只动这里;客户端校验直接复用 schema,不另抄规则。
 */
export const POST_LIMITS = {
  title: 500,
  slug: 255,
  tag: 100,
  tagsMax: 5,
  contentMd: 500_000,
  excerpt: 500,
  coverPath: 500,
  seoTitle: 255,
  seoDescription: 500,
} as const;

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

/** slug 边界(分类/标签沿用):先归一化(arch/07-frontend §2 红线,统一 percent-encoded 小写)再验空 */
export const slugSchema = z
  .string()
  .max(POST_LIMITS.slug, `slug 最长 ${POST_LIMITS.slug} 字符`)
  .transform((s) => s.trim())
  .transform((s) => normalizeSlug(s))
  .refine((s) => s.length > 0, "slug 归一化后为空");

/**
 * ASCII slug 归一(review P3 收敛):小写化、非 [a-z0-9] 折叠为连字符、
 * 去首尾;空 → undefined。postSlugSchema 与 publish-api#foldSlug 共用此
 * 唯一实现,slug 规则变更不再两处漂移。
 */
export function normalizeAsciiSlug(raw: string): string | undefined {
  const s = raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return s === "" ? undefined : s;
}

/**
 * 文章 slug(2026-10 URL 终态):ASCII 装饰段,可空(URL 由 id 锚定 /post/<id>-<slug>,
 * 改 slug 永不毁外链)。空 → undefined(创建=由标题派生/缺省 bare-id,更新=不改)。
 */
export const postSlugSchema = z
  .string()
  .max(POST_LIMITS.slug, `slug 最长 ${POST_LIMITS.slug} 字符`)
  .transform(normalizeAsciiSlug)
  .refine((s) => s === undefined || isAsciiSlug(s), "slug 须为小写字母数字与连字符")
  .optional();

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
  .max(POST_LIMITS.coverPath, `封面路径最长 ${POST_LIMITS.coverPath} 字符`)
  .transform((s) => s.trim())
  .refine((s) => s === "" || s.startsWith("/"), "封面须为 / 开头的站内路径");

export const postCreateSchema = z.object({
  title: z
    .string()
    .trim()
    .min(1, "标题不能为空")
    .max(POST_LIMITS.title, `标题最长 ${POST_LIMITS.title} 字符`),
  /** 缺省时由 service 以标题派生 ASCII token(纯中文标题 → bare-id URL) */
  slug: postSlugSchema,
  categorySlug: slugSchema,
  /** 按名自动建(原型 admin-editor:upsert_article 同规则),去重由 service 做 */
  tags: z
    .array(
      z
        .string()
        .trim()
        .min(1, "标签不能为空")
        .max(POST_LIMITS.tag, `单个标签最长 ${POST_LIMITS.tag} 字符`),
    )
    .max(POST_LIMITS.tagsMax, `标签最多 ${POST_LIMITS.tagsMax} 个`)
    .max(100) // 序列化护栏:5 个标签本身不会超,防异常请求
    .default([]),
  contentMd: z
    .string()
    .min(1, "正文不能为空")
    .max(POST_LIMITS.contentMd, `正文过长(上限 ${POST_LIMITS.contentMd / 10_000} 万字符)`),
  excerpt: optionalText(POST_LIMITS.excerpt),
  coverPath: coverPathSchema.optional(),
  seoTitle: optionalText(POST_LIMITS.seoTitle),
  seoDescription: optionalText(POST_LIMITS.seoDescription),
  contentOrigin: contentOriginSchema,
});

/** 更新含 slug(可改):id 锚定 URL,改 slug 后旧 /post/<id>-<旧>/ 由 canonical 对比 308 归一;缺省 = 不修改 */
export const postUpdateSchema = postCreateSchema;

export type PostCreateInput = z.infer<typeof postCreateSchema>;
export type PostUpdateInput = z.infer<typeof postUpdateSchema>;
