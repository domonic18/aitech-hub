/**
 * extract 阶段(03 文档 §10):只读连接源库 → artifacts/*.json。
 * 产物可重放,transform 及后续阶段不再连源库;dateStrings 防 mysql2 时区改写。
 */
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import mysql from "mysql2/promise";

import { ARTIFACTS, config } from "./config";
import type {
  WpLegacyPostRow,
  WpPostMetaRow,
  WpPostRow,
  WpRelRow,
  WpTermRow,
  WpUserMetaRow,
  WpUserRow,
  WpViewDailyRow,
  WpViewTotalRow,
  WpYoastRow,
} from "./types";

/** WP 表前缀(env 可覆盖,默认 wp_;所有表名统一走 T 前缀,禁再写死) */
const T = config.tablePrefix();

/** attachment 的 post_status 是 inherit(非 publish),需一并取出 */
const POSTS_SQL = `
  SELECT ID, post_author, post_date_gmt, post_name, post_title,
         post_excerpt, post_content, post_type, post_parent
  FROM ${T}posts
  WHERE (post_status = 'publish' AND post_type IN ('post', 'page'))
     OR post_type = 'attachment'
  ORDER BY ID`;

const LEGACY_POSTS_SQL = `
  SELECT ID, post_name, post_type, post_title
  FROM ${T}posts
  WHERE post_status = 'publish' AND post_type NOT IN ('post', 'page', 'attachment')
  ORDER BY ID`;

export async function extractAll(): Promise<void> {
  const connection = await mysql.createConnection({
    uri: config.sourceUrl(),
    dateStrings: true,
  });

  try {
    const dir = join(config.artifactsDir());
    await mkdir(join(dir, ARTIFACTS.transform.base64Dir), { recursive: true });

    const log = (name: string, rows: unknown[]): void =>
      console.log(JSON.stringify({ event: "extract.table", table: name, rows: rows.length }));

    const [posts] = await connection.query<mysql.RowDataPacket[]>(POSTS_SQL);
    await write(dir, ARTIFACTS.posts, posts as WpPostRow[]);
    log("wp_posts", posts);

    const [legacyPosts] = await connection.query<mysql.RowDataPacket[]>(LEGACY_POSTS_SQL);
    await write(dir, ARTIFACTS.legacyPosts, legacyPosts as WpLegacyPostRow[]);
    log("wp_posts(legacy)", legacyPosts);

    const [postMeta] = await connection.query<mysql.RowDataPacket[]>(
      `SELECT post_id, meta_key, meta_value FROM ${T}postmeta
       WHERE meta_key IN ('_thumbnail_id', '_wp_attached_file')`,
    );
    await write(dir, ARTIFACTS.postMeta, postMeta as WpPostMetaRow[]);
    log("wp_postmeta", postMeta);

    const [terms] = await connection.query<mysql.RowDataPacket[]>(
      `SELECT t.term_id, t.name, t.slug, tt.taxonomy
       FROM ${T}terms t JOIN ${T}term_taxonomy tt ON t.term_id = tt.term_id
       WHERE tt.taxonomy IN ('category', 'post_tag')`,
    );
    await write(dir, ARTIFACTS.terms, terms as WpTermRow[]);
    log("wp_terms", terms);

    const [rels] = await connection.query<mysql.RowDataPacket[]>(
      `SELECT tr.object_id, t.term_id, tt.taxonomy
       FROM ${T}term_relationships tr
       JOIN ${T}term_taxonomy tt ON tr.term_taxonomy_id = tt.term_taxonomy_id
       JOIN ${T}terms t ON tt.term_id = t.term_id
       JOIN ${T}posts p ON p.ID = tr.object_id
       WHERE p.post_status = 'publish' AND p.post_type = 'post'`,
    );
    await write(dir, ARTIFACTS.rels, rels as WpRelRow[]);
    log("wp_term_relationships", rels);

    const [users] = await connection.query<mysql.RowDataPacket[]>(
      `SELECT ID, user_login, user_email, user_registered, user_pass, display_name
       FROM ${T}users ORDER BY ID`,
    );
    await write(dir, ARTIFACTS.users, users as WpUserRow[]);
    log("wp_users", users);

    const [userMeta] = await connection.query<mysql.RowDataPacket[]>(
      `SELECT user_id, meta_key, meta_value FROM ${T}usermeta
       WHERE meta_key IN ('mobile_phone', 'nickname', 'description', 'wp_capabilities')`,
    );
    await write(dir, ARTIFACTS.userMeta, userMeta as WpUserMetaRow[]);
    log("wp_usermeta", userMeta);

    const [yoast] = await connection.query<mysql.RowDataPacket[]>(
      `SELECT object_id, title, description FROM ${T}yoast_indexable
       WHERE object_type = 'post'`,
    );
    await write(dir, ARTIFACTS.yoast, yoast as WpYoastRow[]);
    log("wp_yoast_indexable", yoast);

    // 浏览量:type=0 按日粒度;type=4 全站总量(插件展示口径,type 0-4 同一总量的不同粒度,不可求和)
    const [viewsDaily] = await connection.query<mysql.RowDataPacket[]>(
      `SELECT id, period, count FROM ${T}post_views WHERE type = 0`,
    );
    await write(dir, ARTIFACTS.viewsDaily, viewsDaily as WpViewDailyRow[]);
    log("wp_post_views(type=0)", viewsDaily);

    const [viewsTotal] = await connection.query<mysql.RowDataPacket[]>(
      `SELECT id, count FROM ${T}post_views WHERE type = 4`,
    );
    await write(dir, ARTIFACTS.viewsTotal, viewsTotal as WpViewTotalRow[]);
    log("wp_post_views(type=4)", viewsTotal);

    // §7 付费权益证据:一期只导出 JSON,付费上线时再导入
    const [orders] = await connection.query<mysql.RowDataPacket[]>(
      `SELECT o.*, i.ID AS item_id, i.price AS item_price, i.title AS item_title,
              i.type AS item_type, i.type_id AS item_type_id
       FROM ${T}wpcom_orders o
       LEFT JOIN ${T}wpcom_order_items i ON i.order_id = o.ID`,
    );
    await write(dir, ARTIFACTS.orders, orders);
    log("wp_wpcom_orders(+items)", orders);

    console.log(JSON.stringify({ event: "extract.done", dir }));
  } finally {
    await connection.end();
  }
}

async function write<T>(dir: string, name: string, rows: T[]): Promise<void> {
  await writeFile(join(dir, name), JSON.stringify(rows), "utf8");
}

if (process.argv[1]?.endsWith("extract.ts")) {
  extractAll().catch((e) => {
    console.error(JSON.stringify({ event: "extract.failed", error: String(e) }));
    process.exit(1);
  });
}
