/**
 * transform 核心映射(纯函数,单测主战场)。
 * 输入 extract 产物,输出 load 计划;副作用仅经注入的 onBase64 回调(落盘解码图)。
 */
import { createHash } from "node:crypto";

import {
  cleanPostHtml,
  rewriteBase64Images,
  type Base64Image,
} from "../../src/lib/content/clean-html";
import { normalizeSlug, normalizeUrlPath } from "../../src/lib/slug";
import type {
  LegacyMapPlan,
  MediaPlan,
  MediaRefPlan,
  MigrationWarning,
  PostPlan,
  TagPlan,
  WpLegacyPostRow,
  WpPostMetaRow,
  WpPostRow,
  WpRelRow,
  WpTermRow,
  WpYoastRow,
} from "./types";

/** 迁移范围:分类 slug(03 §3;news/advertising 不迁内容只做 301) */
const MIGRATED_CATEGORY_SLUGS = new Set(["blog", "report"]);
const CATEGORY_TARGET: Record<string, string> = { news: "/articles", advertising: "/" };
/** 旧分类/标签路由 → 新站承接 */
const LEGACY_TAG_TARGET = "/articles";

const IMAGE_EXT = new Set(["png", "jpg", "jpeg", "gif", "webp", "avif", "svg", "bmp", "ico"]);
const VIDEO_EXT = new Set(["mp4", "mov", "webm", "m4v", "avi", "mkv"]);

export interface TransformPostsInput {
  posts: WpPostRow[];
  postMeta: WpPostMetaRow[];
  terms: WpTermRow[];
  rels: WpRelRow[];
  yoast: WpYoastRow[];
  viewsTotal: Array<{ id: number; count: number }>;
  /**
   * base64 解码图落盘回调(返回 artifacts/base64-media 下的文件名);
   * 纯函数不直接写盘,副作用注入以便单测。
   */
  onBase64?: (name: string, buffer: Buffer) => void;
}

export interface TransformPostsOutput {
  posts: PostPlan[];
  tags: TagPlan[];
  media: MediaPlan[];
  mediaRefs: MediaRefPlan[];
  scopedWpIds: Set<number>;
  warnings: MigrationWarning[];
}

const sha1 = (buf: Buffer): string => createHash("sha1").update(buf).digest("hex");

function gmtToIso(mysqlDatetime: string): string {
  return new Date(`${mysqlDatetime.replace(" ", "T")}Z`).toISOString();
}

function mediaKind(filename: string): MediaPlan["kind"] {
  const ext = (filename.split(".").pop() ?? "").toLowerCase();
  if (IMAGE_EXT.has(ext)) return "image";
  if (VIDEO_EXT.has(ext)) return "video";
  return "file";
}

/** URL 路径 → uploads 树内相对路径(解码文件名,供文件定位) */
function uploadsRelPath(urlPath: string): string {
  const raw = urlPath.replace(/^\/wp-content\/uploads\//, "");
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

/** 清洗后正文里出现的全部 uploads 路径(已是站内相对形态) */
export function extractUploadPaths(html: string): string[] {
  const found = html.match(/\/wp-content\/uploads\/[^"'\s<>)]+/g) ?? [];
  return [...new Set(found.map(normalizeUrlPath))];
}

export function transformPosts(input: TransformPostsInput): TransformPostsOutput {
  const { posts, postMeta, terms, rels, yoast, viewsTotal, onBase64 } = input;
  const warnings: MigrationWarning[] = [];

  // ── 索引构建 ──
  const termById = new Map(terms.map((t) => [t.term_id, t]));
  const attachedFileByPostId = new Map<number, string>();
  const thumbByPostId = new Map<number, number>();
  for (const m of postMeta) {
    if (m.meta_key === "_wp_attached_file") attachedFileByPostId.set(m.post_id, m.meta_value);
    if (m.meta_key === "_thumbnail_id") thumbByPostId.set(m.post_id, Number(m.meta_value));
  }
  /** attachment ID → URL 路径 */
  const attachmentPath = new Map<number, string>();
  for (const p of posts) {
    if (p.post_type !== "attachment") continue;
    const file = attachedFileByPostId.get(p.ID);
    if (!file) continue;
    attachmentPath.set(p.ID, normalizeUrlPath(`/wp-content/uploads/${file}`));
  }
  /** URL 路径 → attachment ID(闭包回溯溯源用) */
  const attachmentIdByPath = new Map([...attachmentPath.entries()].map(([id, path]) => [path, id]));

  const yoastByPostId = new Map(
    yoast.filter((y) => y.object_id != null).map((y) => [y.object_id, y]),
  );
  const viewsById = new Map(viewsTotal.map((v) => [v.id, Number(v.count)]));
  const relsByPostId = new Map<number, WpRelRow[]>();
  for (const r of rels) {
    const list = relsByPostId.get(r.object_id) ?? [];
    list.push(r);
    relsByPostId.set(r.object_id, list);
  }

  // ── 范围筛选 + 主映射 ──
  const outPosts: PostPlan[] = [];
  const tagPlans = new Map<string, TagPlan>();
  const mediaPlans = new Map<string, MediaPlan>();
  const mediaRefs: MediaRefPlan[] = [];
  const base64Seen = new Map<string, string>(); // sha1 → 已生成路径(跨篇去重)
  const scopedWpIds = new Set<number>();

  for (const p of posts) {
    if (p.post_type !== "post") continue;
    const postRels = relsByPostId.get(p.ID) ?? [];
    const catTerms = postRels
      .filter((r) => r.taxonomy === "category")
      .map((r) => termById.get(r.term_id))
      .filter((t): t is WpTermRow => !!t)
      .map((t) => normalizeSlug(t.slug));
    const categorySlug = catTerms.find((c) => MIGRATED_CATEGORY_SLUGS.has(c));
    if (!categorySlug) continue;
    scopedWpIds.add(p.ID);

    // base64 图:解码落盘(经回调)→ 站内路径(策略:2026-09-29 用户确认)
    const { html: withUrls, images } = rewriteBase64Images(p.post_content, (img: Base64Image) => {
      const digest = sha1(Buffer.from(img.base64, "base64"));
      const name = `${digest}.${img.ext}`;
      const known = base64Seen.get(digest);
      if (known) return known;
      const urlPath = normalizeUrlPath(`/wp-content/uploads/data/${name}`);
      onBase64?.(name, Buffer.from(img.base64, "base64"));
      base64Seen.set(digest, urlPath);
      mediaPlans.set(urlPath, {
        path: urlPath,
        filename: name,
        kind: "image",
        wpAttachmentId: null,
        source: { type: "extracted", artifactFile: name },
      });
      return urlPath;
    });
    if (images.length > 0) {
      warnings.push({
        scope: "post.base64",
        wpId: p.ID,
        message: `${images.length} 处 base64 图解码落盘(去重后 ${base64Seen.size} 累计)`,
      });
    }

    const { html: contentHtml, report } = cleanPostHtml(withUrls);

    // 封面:_thumbnail_id → attachment → 路径
    let coverPath: string | null = null;
    const thumbId = thumbByPostId.get(p.ID);
    if (thumbId) {
      coverPath = attachmentPath.get(thumbId) ?? null;
      if (!coverPath) {
        warnings.push({
          scope: "post.cover",
          wpId: p.ID,
          message: `封面 attachment ${thumbId} 无 _wp_attached_file`,
        });
      }
    }

    // 媒体闭包:正文引用 + 封面
    const refPaths = [...extractUploadPaths(contentHtml), ...(coverPath ? [coverPath] : [])];
    for (const rawPath of new Set(refPaths)) {
      const path = normalizeUrlPath(rawPath);
      if (!mediaPlans.has(path)) {
        const rel = uploadsRelPath(path);
        mediaPlans.set(path, {
          path,
          filename: rel.split("/").pop() ?? rel,
          kind: mediaKind(rel),
          wpAttachmentId: attachmentIdByPath.get(path) ?? null,
          source: { type: "uploads", relPath: rel },
        });
      }
      mediaRefs.push({ postWpId: p.ID, mediaPath: path });
    }

    // 标签:仅范围内文章的关联(03 §6)
    const tagSlugs: string[] = [];
    for (const r of postRels.filter((r) => r.taxonomy === "post_tag")) {
      const term = termById.get(r.term_id);
      if (!term) continue;
      const slug = normalizeSlug(term.slug);
      tagPlans.set(slug, { slug, name: term.name });
      tagSlugs.push(slug);
    }

    const seoTitle = yoastByPostId.get(p.ID)?.title?.trim() || null;
    outPosts.push({
      wpPostId: p.ID,
      slug: normalizeSlug(p.post_name),
      title: p.post_title.trim(),
      excerpt: p.post_excerpt.trim() || null,
      contentHtml,
      coverPath,
      categorySlug,
      viewsCount: viewsById.get(p.ID) ?? 0,
      seoTitle: seoTitle ? seoTitle.slice(0, 255) : null,
      seoDescription: yoastByPostId.get(p.ID)?.description?.trim() || null,
      publishedAt: gmtToIso(p.post_date_gmt),
      tagSlugs: [...new Set(tagSlugs)],
      cleanReport: report,
    });
  }

  return {
    posts: outPosts,
    tags: [...tagPlans.values()],
    media: [...mediaPlans.values()],
    mediaRefs,
    scopedWpIds,
    warnings,
  };
}

// ── legacy_url_map(03 §8)─────────────────────────────────────────

/** 公开页面 slug → 承接路径;未列出的页面默认 '/' */
const PAGE_RULES: Record<string, string> = {
  "%e4%b8%bb%e9%a1%b5": "/", // 主页
  shop: "/",
  cart: "/",
  checkout: "/",
  "my-account": "/",
  ai_knowledge: "/articles",
  ai_news: "/articles",
  ai_resources: "/articles",
  "%e5%bc%80%e5%8f%91%e6%97%a5%e5%bf%97": "/", // 开发日志
  "%e7%94%a8%e6%88%b7%e5%8d%8f%e8%ae%ae": "/agreement", // 用户协议
  "%e9%9a%90%e7%a7%81%e6%94%bf%e7%ad%96": "/privacy", // 隐私政策
  "%e5%a4%a7%e6%a8%a1%e5%9e%8b%e4%b8%93%e9%a2%98%e9%a1%b5": "/", // 大模型专题页
  register: "/login",
  login: "/login",
  lostpassword: "/login",
  "social-login": "/login",
  account: "/account",
  profile: "/account",
  "embed-link": "/",
  ai_qa: "/",
  ai_qa_list: "/",
  ai_qa_ask: "/",
};

export function buildLegacyMap(input: {
  posts: WpPostRow[];
  legacyPosts: WpLegacyPostRow[];
  terms: WpTermRow[];
  rels: WpRelRow[];
  scopedWpIds: Set<number>;
  migratedTagSlugs: Set<string>;
}): { legacyMap: LegacyMapPlan[]; warnings: MigrationWarning[] } {
  const { posts, legacyPosts, terms, rels, scopedWpIds, migratedTagSlugs } = input;
  const warnings: MigrationWarning[] = [];
  const map = new Map<string, LegacyMapPlan>();

  const put = (oldPath: string, target: string, note: string): void => {
    if (map.has(oldPath)) {
      if (map.get(oldPath)!.targetUrl !== target) {
        warnings.push({
          scope: "legacy.conflict",
          message: `${oldPath} 目标冲突:${map.get(oldPath)!.targetUrl} vs ${target},保留前者`,
        });
      }
      return;
    }
    map.set(oldPath, { oldPath, targetUrl: target, note });
  };

  // 文章:范围外(资讯/推广等)按分类承接;范围内(博客/评测)新站直出 200,不入表
  const catByPostId = new Map<number, string>();
  for (const r of rels) {
    if (r.taxonomy !== "category") continue;
    const term = terms.find((t) => t.term_id === r.term_id);
    if (term) catByPostId.set(r.object_id, normalizeSlug(term.slug));
  }
  for (const p of posts) {
    if (p.post_type !== "post" || scopedWpIds.has(p.ID)) continue;
    const cat = catByPostId.get(p.ID) ?? "news";
    const target = CATEGORY_TARGET[cat] ?? "/";
    put(normalizeUrlPath(`/${p.post_name}/`), target, `旧${cat}文章 301 承接`);
  }

  // 页面
  for (const p of posts) {
    if (p.post_type !== "page") continue;
    const key = normalizeSlug(p.post_name);
    const target = PAGE_RULES[key] ?? "/";
    put(normalizeUrlPath(`/${p.post_name}/`), target, `旧页面「${p.post_title}」`);
  }

  // 非内容公开类型(qa_post/product/sld 等)
  for (const p of legacyPosts) {
    put(normalizeUrlPath(`/${p.post_name}/`), "/", `旧类型 ${p.post_type} 不迁移`);
  }

  // 分类归档路由:blog/report 新站直出不入表;news/advertising 承接
  for (const t of terms) {
    if (t.taxonomy !== "category") continue;
    const slug = normalizeSlug(t.slug);
    const target = CATEGORY_TARGET[slug];
    if (target) put(normalizeUrlPath(`/category/${t.slug}/`), target, "旧分类归档承接");
  }

  // 未迁移标签归档 → /articles;迁移标签新站直出
  for (const t of terms) {
    if (t.taxonomy !== "post_tag") continue;
    if (migratedTagSlugs.has(normalizeSlug(t.slug))) continue;
    put(normalizeUrlPath(`/tag/${t.slug}/`), LEGACY_TAG_TARGET, "未迁移标签归档承接");
  }

  return { legacyMap: [...map.values()], warnings };
}
