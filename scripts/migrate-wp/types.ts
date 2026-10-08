/**
 * 迁移管线共享类型。
 * extract 产物(源库行)→ transform 产物(load 计划)两层,
 * transform 为纯函数,单测见 transform-posts.test.ts。
 */
import type { CleanHtmlReport } from "../../src/lib/content/clean-html";

// ── extract 层(源库行,mysql2 dateStrings)────────────────────────

export interface WpPostRow {
  ID: number;
  post_author: number;
  post_date_gmt: string; // "YYYY-MM-DD HH:mm:ss"
  post_name: string;
  post_title: string;
  post_excerpt: string;
  post_content: string;
  post_type: string;
  post_parent: number;
}

/** 非内容类型的公开行(qa_post/product/sld 等,仅用于 legacy 映射) */
export interface WpLegacyPostRow {
  ID: number;
  post_name: string;
  post_type: string;
  post_title: string;
}

export interface WpPostMetaRow {
  post_id: number;
  meta_key: string;
  meta_value: string;
}

export interface WpTermRow {
  term_id: number;
  name: string;
  slug: string;
  taxonomy: string;
}

export interface WpRelRow {
  object_id: number;
  term_id: number;
  taxonomy: string;
}

export interface WpUserRow {
  ID: number;
  user_login: string;
  user_email: string;
  user_registered: string;
  user_pass: string;
  display_name: string;
}

export interface WpUserMetaRow {
  user_id: number;
  meta_key: string;
  meta_value: string;
}

export interface WpYoastRow {
  object_id: number;
  title: string | null;
  description: string | null;
}

/** wp_post_views type=0(period=YYYYMMDD 按日粒度;type 0-4 为同一总量的不同粒度,不可求和) */
export interface WpViewDailyRow {
  id: number;
  period: string;
  count: number;
}

/** wp_post_views type=4(period='total',插件展示口径) */
export interface WpViewTotalRow {
  id: number;
  count: number;
}

// ── transform 层(load 计划)──────────────────────────────────────

export interface PostPlan {
  wpPostId: number;
  slug: string;
  title: string;
  excerpt: string | null;
  contentHtml: string;
  coverPath: string | null;
  categorySlug: string;
  viewsCount: number;
  seoTitle: string | null;
  seoDescription: string | null;
  /** ISO 8601 UTC(post_date_gmt 直接可信,实库 0 异常) */
  publishedAt: string;
  tagSlugs: string[];
  cleanReport: CleanHtmlReport;
}

export interface TagPlan {
  slug: string;
  name: string;
}

export type MediaSource =
  | { type: "uploads"; relPath: string } // uploads 树内相对路径(已解码文件名)
  | { type: "extracted"; artifactFile: string }; // base64 解码产物(artifacts/base64-media/ 下)

export interface MediaPlan {
  /** URL 路径(normalizeUrlPath 归一,如 /wp-content/uploads/2024/04/图.png) */
  path: string;
  filename: string;
  kind: "image" | "video" | "file";
  wpAttachmentId: number | null;
  source: MediaSource;
}

export interface MediaRefPlan {
  postWpId: number;
  mediaPath: string;
}

export interface UserPlan {
  wpUserId: number;
  phone: string | null;
  nickname: string | null;
  bio: string | null;
  role: "user" | "admin";
  status: "active" | "pending_binding";
  legacyUsername: string;
  legacyPhpass: string;
  createdAt: string;
}

export interface ViewDailyPlan {
  postWpId: number;
  viewDate: string; // YYYY-MM-DD
  count: number;
}

export interface LegacyMapPlan {
  oldPath: string;
  targetUrl: string | null;
  note: string;
}

export interface MigrationWarning {
  scope: string;
  wpId?: number;
  message: string;
}

export interface TransformResult {
  posts: PostPlan[];
  tags: TagPlan[];
  media: MediaPlan[];
  mediaRefs: MediaRefPlan[];
  users: UserPlan[];
  viewsDaily: ViewDailyPlan[];
  legacyMap: LegacyMapPlan[];
  warnings: MigrationWarning[];
}
