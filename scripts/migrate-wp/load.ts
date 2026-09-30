/**
 * load 阶段:裸 SQL 幂等 UPSERT 入 PG(不经 Prisma)。
 * 业务键:wp_post_id / wp_user_id / slug / path / (post_id, view_date) / old_path。
 * 全程单事务:任一表失败整体回滚,重跑安全。
 */
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import pg from "pg";

import { ARTIFACTS, config } from "./config";
import type { CopyEntry } from "./media-manifest";
import type { TransformResult } from "./types";

const CHUNK = 500;

async function upsertUsers(tx: pg.PoolClient, r: TransformResult): Promise<void> {
  for (const u of r.users) {
    await tx.query(
      `INSERT INTO user_account
         (phone, nickname, role, status, legacy_username, legacy_phpass, wp_user_id, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, now())
       ON CONFLICT (wp_user_id) DO UPDATE SET
         phone = EXCLUDED.phone, nickname = EXCLUDED.nickname, role = EXCLUDED.role,
         status = EXCLUDED.status, legacy_username = EXCLUDED.legacy_username,
         legacy_phpass = EXCLUDED.legacy_phpass, updated_at = now()`,
      [
        u.phone,
        u.nickname,
        u.role,
        u.status,
        u.legacyUsername,
        u.legacyPhpass,
        u.wpUserId,
        u.createdAt,
      ],
    );
  }
}

async function upsertTags(tx: pg.PoolClient, r: TransformResult): Promise<Map<string, string>> {
  for (const t of r.tags) {
    await tx.query(
      `INSERT INTO content_tag (slug, name) VALUES ($1, $2)
       ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name`,
      [t.slug, t.name],
    );
  }
  const { rows } = await tx.query<{ slug: string; id: string }>(
    `SELECT slug, id::text FROM content_tag WHERE slug = ANY($1)`,
    [r.tags.map((t) => t.slug)],
  );
  return new Map(rows.map((row) => [row.slug, row.id]));
}

async function upsertPosts(tx: pg.PoolClient, r: TransformResult): Promise<Map<number, string>> {
  const { rows: catRows } = await tx.query<{ slug: string; id: string }>(
    `SELECT slug, id::text FROM content_category WHERE slug = ANY($1)`,
    [[...new Set(r.posts.map((p) => p.categorySlug))]],
  );
  const catBySlug = new Map(catRows.map((row) => [row.slug, row.id]));

  for (const p of r.posts) {
    const categoryId = catBySlug.get(p.categorySlug);
    if (!categoryId) throw new Error(`分类 ${p.categorySlug} 不存在:先跑 npm run seed`);
    await tx.query(
      `INSERT INTO content_post
         (slug, title, excerpt, content_html, cover_path, category_id, status,
          views_count, seo_title, seo_description, published_at, wp_post_id, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, 'published', $7, $8, $9, $10, $11, now())
       ON CONFLICT (wp_post_id) DO UPDATE SET
         slug = EXCLUDED.slug, title = EXCLUDED.title, excerpt = EXCLUDED.excerpt,
         content_html = EXCLUDED.content_html, cover_path = EXCLUDED.cover_path,
         category_id = EXCLUDED.category_id, status = 'published',
         views_count = EXCLUDED.views_count, seo_title = EXCLUDED.seo_title,
         seo_description = EXCLUDED.seo_description, published_at = EXCLUDED.published_at,
         updated_at = now()`,
      [
        p.slug,
        p.title,
        p.excerpt,
        p.contentHtml,
        p.coverPath,
        categoryId,
        p.viewsCount,
        p.seoTitle,
        p.seoDescription,
        p.publishedAt,
        p.wpPostId,
      ],
    );
  }
  const { rows } = await tx.query<{ wp_post_id: string; id: string }>(
    `SELECT wp_post_id::text, id::text FROM content_post WHERE wp_post_id = ANY($1)`,
    [r.posts.map((p) => p.wpPostId)],
  );
  return new Map(rows.map((row) => [Number(row.wp_post_id), row.id]));
}

async function loadPostTags(
  tx: pg.PoolClient,
  r: TransformResult,
  tagIds: Map<string, string>,
  postIds: Map<number, string>,
): Promise<number> {
  let count = 0;
  for (const p of r.posts) {
    const postId = postIds.get(p.wpPostId);
    if (!postId) throw new Error(`post ${p.wpPostId} 未回读到 id`);
    for (const slug of p.tagSlugs) {
      const tagId = tagIds.get(slug);
      if (!tagId) throw new Error(`tag ${slug} 不存在`);
      await tx.query(
        `INSERT INTO content_post_tag (post_id, tag_id) VALUES ($1, $2)
         ON CONFLICT (post_id, tag_id) DO NOTHING`,
        [postId, tagId],
      );
      count++;
    }
  }
  return count;
}

async function upsertMedia(
  tx: pg.PoolClient,
  r: TransformResult,
  copies: CopyEntry[],
): Promise<void> {
  const byPath = new Map(copies.map((c) => [c.path, c]));
  for (const m of r.media) {
    const copy = byPath.get(m.path);
    const status = copy?.status === "copied" ? "active" : "missing";
    await tx.query(
      `INSERT INTO content_media
         (path, filename, kind, status, size_bytes, sha1, storage, wp_attachment_id, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, 'local', $7, now())
       ON CONFLICT (path) DO UPDATE SET
         filename = EXCLUDED.filename, kind = EXCLUDED.kind, status = EXCLUDED.status,
         size_bytes = EXCLUDED.size_bytes, sha1 = EXCLUDED.sha1,
         wp_attachment_id = EXCLUDED.wp_attachment_id`,
      [
        m.path,
        m.filename,
        m.kind,
        status,
        copy?.sizeBytes ?? null,
        copy?.sha1 ?? null,
        m.wpAttachmentId,
      ],
    );
  }
}

async function loadMediaRefs(
  tx: pg.PoolClient,
  r: TransformResult,
  postIds: Map<number, string>,
): Promise<void> {
  for (let i = 0; i < r.mediaRefs.length; i += CHUNK) {
    const chunk = r.mediaRefs.slice(i, i + CHUNK);
    const values: unknown[] = [];
    const tuples = chunk.map((ref, j) => {
      values.push(ref.mediaPath, postIds.get(ref.postWpId));
      return `($${j * 2 + 1}, $${j * 2 + 2})`;
    });
    await tx.query(
      `INSERT INTO content_media_ref (media_path, post_id) VALUES ${tuples.join(",")}
       ON CONFLICT (media_path, post_id) DO NOTHING`,
      values,
    );
  }
}

async function upsertViews(
  tx: pg.PoolClient,
  r: TransformResult,
  postIds: Map<number, string>,
): Promise<void> {
  for (let i = 0; i < r.viewsDaily.length; i += CHUNK) {
    const chunk = r.viewsDaily.slice(i, i + CHUNK);
    const values: unknown[] = [];
    const tuples = chunk.map((v, j) => {
      values.push(postIds.get(v.postWpId), v.viewDate, v.count);
      return `($${j * 3 + 1}, $${j * 3 + 2}::date, $${j * 3 + 3})`;
    });
    await tx.query(
      `INSERT INTO stats_post_view_daily (post_id, view_date, count) VALUES ${tuples.join(",")}
       ON CONFLICT (post_id, view_date) DO UPDATE SET count = EXCLUDED.count`,
      values,
    );
  }
}

async function upsertLegacyMap(tx: pg.PoolClient, r: TransformResult): Promise<void> {
  for (let i = 0; i < r.legacyMap.length; i += CHUNK) {
    const chunk = r.legacyMap.slice(i, i + CHUNK);
    const values: unknown[] = [];
    const tuples = chunk.map((m, j) => {
      values.push(m.oldPath, m.targetUrl, m.note);
      return `($${j * 3 + 1}, $${j * 3 + 2}, 301, $${j * 3 + 3})`;
    });
    await tx.query(
      `INSERT INTO legacy_url_map (old_path, target_url, http_status, note) VALUES ${tuples.join(",")}
       ON CONFLICT (old_path) DO UPDATE SET
         target_url = EXCLUDED.target_url, http_status = 301, note = EXCLUDED.note`,
      values,
    );
  }
}

export async function runLoad(): Promise<void> {
  const result = JSON.parse(
    await readFile(join(config.artifactsDir(), ARTIFACTS.transform.result), "utf8"),
  ) as TransformResult;
  const copies = JSON.parse(
    await readFile(join(config.artifactsDir(), ARTIFACTS.manifest.copySummary), "utf8"),
  ) as { entries: CopyEntry[] };

  const pool = new pg.Pool({ connectionString: config.targetUrl(), max: 2 });
  const tx = await pool.connect();
  try {
    await tx.query("BEGIN");
    await upsertUsers(tx, result);
    const tagIds = await upsertTags(tx, result);
    const postIds = await upsertPosts(tx, result);
    const tagLinks = await loadPostTags(tx, result, tagIds, postIds);
    await upsertMedia(tx, result, copies.entries);
    await loadMediaRefs(tx, result, postIds);
    await upsertViews(tx, result, postIds);
    await upsertLegacyMap(tx, result);
    await tx.query("COMMIT");
    console.log(
      JSON.stringify({
        event: "load.done",
        users: result.users.length,
        posts: result.posts.length,
        tagLinks,
        media: result.media.length,
        mediaRefs: result.mediaRefs.length,
        viewsDaily: result.viewsDaily.length,
        legacyMap: result.legacyMap.length,
      }),
    );
  } catch (e) {
    await tx.query("ROLLBACK");
    throw e;
  } finally {
    tx.release();
    await pool.end();
  }
}

if (process.argv[1]?.endsWith("load.ts")) {
  runLoad().catch((e) => {
    console.error(JSON.stringify({ event: "load.failed", error: String(e) }));
    process.exit(1);
  });
}
