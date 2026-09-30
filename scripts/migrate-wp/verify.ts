/**
 * verify 阶段(03 文档 §11 七条验收)。
 * 全部落 artifacts/verify_report.json;任一 FAIL 退出码非 0,阻断切换(M6 前提)。
 * 第 4 条默认 DB 层抽样;--http 升级为 HTTP 实测(需服务已起,NEXT_PUBLIC_SITE_URL 为基准)。
 */
import { access, readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { join } from "node:path";
import pg from "pg";

import { ARTIFACTS, config } from "./config";
import { extractUploadPaths } from "./transform-posts";
import type { TransformResult } from "./types";

export interface CheckResult {
  id: number;
  name: string;
  status: "PASS" | "FAIL" | "SKIP";
  details: string;
}

/** 确定性抽样(报告可重放) */
function makeSampler(seed = 20260929): () => number {
  let s = seed;
  return () => {
    s = (s * 1103515245 + 12345) % 2147483648;
    return s / 2147483648;
  };
}

function sample<T>(arr: T[], n: number, rand: () => number): T[] {
  const pool = [...arr];
  const out: T[] = [];
  while (out.length < n && pool.length > 0)
    out.push(pool.splice(Math.floor(rand() * pool.length), 1)[0]);
  return out;
}

const fileExists = (p: string): Promise<boolean> =>
  access(p)
    .then(() => true)
    .catch(() => false);

export async function runVerify(opts: { http?: boolean } = {}): Promise<CheckResult[]> {
  const result = JSON.parse(
    await readFile(join(config.artifactsDir(), ARTIFACTS.transform.result), "utf8"),
  ) as TransformResult;
  const checks: CheckResult[] = [];
  const add = (c: CheckResult): void => {
    checks.push(c);
  };

  const pool = new pg.Pool({ connectionString: config.targetUrl(), max: 2 });
  const q = async <T extends pg.QueryResultRow>(sql: string, values?: unknown[]): Promise<T[]> =>
    (await pool.query<T>(sql, values)).rows;
  const mediaDir = config.mediaDir();

  try {
    // ── 1. 计数对账 ──
    {
      const [
        [{ posts }],
        [{ users }],
        [{ tag_links }],
        [{ media }],
        [{ legacy }],
        [{ view_rows }],
      ] = await Promise.all([
        q<{ posts: string }>(
          "SELECT count(*)::text AS posts FROM content_post WHERE wp_post_id IS NOT NULL",
        ),
        q<{ users: string }>(
          "SELECT count(*)::text AS users FROM user_account WHERE wp_user_id IS NOT NULL",
        ),
        q<{ tag_links: string }>("SELECT count(*)::text AS tag_links FROM content_post_tag"),
        q<{ media: string }>("SELECT count(*)::text AS media FROM content_media"),
        q<{ legacy: string }>("SELECT count(*)::text AS legacy FROM legacy_url_map"),
        q<{ view_rows: string }>("SELECT count(*)::text AS view_rows FROM stats_post_view_daily"),
      ]);
      const tagLinks = tag_links;
      const viewRows = view_rows;
      const planTagLinks = result.posts.reduce((s, p) => s + p.tagSlugs.length, 0);
      const ok =
        Number(posts) === result.posts.length &&
        Number(users) === result.users.length &&
        Number(tagLinks) === planTagLinks &&
        Number(media) === result.media.length &&
        Number(legacy) === result.legacyMap.length &&
        Number(viewRows) === result.viewsDaily.length;
      add({
        id: 1,
        name: "计数对账(文章/用户/标签关联/媒体/legacy/浏览日行)",
        status: ok ? "PASS" : "FAIL",
        details: `posts=${posts}/${result.posts.length} users=${users}/${result.users.length} tagLinks=${tagLinks}/${planTagLinks} media=${media}/${result.media.length} legacy=${legacy}/${result.legacyMap.length} viewRows=${viewRows}/${result.viewsDaily.length}`,
      });
    }

    // ── 2. 内容完整性(全量哈希)+ 抽样残留检查 ──
    {
      const rows = await q<{
        wp_post_id: string;
        title: string;
        content_html: string;
        published_at: Date;
      }>(
        "SELECT wp_post_id::text, title, content_html, published_at FROM content_post WHERE wp_post_id IS NOT NULL",
      );
      const byWpId = new Map(rows.map((r) => [Number(r.wp_post_id), r]));
      let mismatch = 0;
      for (const p of result.posts) {
        const row = byWpId.get(p.wpPostId);
        const pgHash = row
          ? createHash("sha1")
              .update(row.content_html ?? "")
              .digest("hex")
          : "";
        const planHash = createHash("sha1").update(p.contentHtml).digest("hex");
        if (
          !row ||
          row.title !== p.title ||
          pgHash !== planHash ||
          new Date(row.published_at).toISOString() !== p.publishedAt
        )
          mismatch++;
      }
      const rand = makeSampler();
      let residue = 0;
      for (const p of sample(result.posts, 20, rand)) {
        const row = byWpId.get(p.wpPostId);
        if (!row) continue;
        if (/<!--\s*wp:/.test(row.content_html ?? "")) residue++;
        if (/\[(gallery|video|embed|su_[a-z_]+)[^\]]*\]/i.test(row.content_html ?? "")) residue++;
      }
      add({
        id: 2,
        name: "内容完整性(154 篇标题/时间/正文哈希一致)+ 抽样无 WP 残留",
        status: mismatch === 0 && residue === 0 ? "PASS" : "FAIL",
        details: `mismatch=${mismatch} residue=${residue}`,
      });
    }

    // ── 3. 图片闭环(正文引用 + 封面 → media/ 文件 + content_media 行)──
    {
      const rows = await q<{ wp_post_id: string; content_html: string; cover_path: string | null }>(
        "SELECT wp_post_id::text, content_html, cover_path FROM content_post WHERE wp_post_id IS NOT NULL",
      );
      const mediaPaths = new Set(
        (await q<{ path: string }>("SELECT path FROM content_media")).map((r) => r.path),
      );
      let bad = 0;
      const checked = new Set<string>();
      for (const row of rows) {
        for (const p of [
          ...extractUploadPaths(row.content_html ?? ""),
          ...(row.cover_path ? [row.cover_path] : []),
        ]) {
          if (checked.has(p)) continue;
          checked.add(p);
          const rel = p.replace(/^\/wp-content\/uploads\//, "");
          if (!mediaPaths.has(p) || !(await fileExists(join(mediaDir, rel)))) bad++;
        }
      }
      add({
        id: 3,
        name: "图片闭环(正文+封面引用 100% 有 content_media 行且 media/ 下有文件)",
        status: bad === 0 && checked.size > 0 ? "PASS" : "FAIL",
        details: `checked=${checked.size} bad=${bad}`,
      });
    }

    // ── 4. URL 抽样(资讯 301 映射存在 + 文章 slug 在库)──
    {
      const rand = makeSampler(42);
      const newsEntries = sample(
        result.legacyMap.filter((m) => m.targetUrl === "/articles" && m.note.includes("文章")),
        30,
        rand,
      );
      const postSlugs = sample(result.posts, 30, rand);
      const mapped = await q<{ old_path: string }>(
        "SELECT old_path FROM legacy_url_map WHERE old_path = ANY($1) AND target_url = '/articles'",
        [newsEntries.map((m) => m.oldPath)],
      );
      const slugsInDb = await q<{ slug: string }>(
        "SELECT slug FROM content_post WHERE slug = ANY($1)",
        [postSlugs.map((p) => p.slug)],
      );
      const okDb = mapped.length === newsEntries.length && slugsInDb.length === postSlugs.length;
      if (opts.http) {
        // HTTP 实测(切换日验收口径,对齐 e2e test2/3):文章直开 200+标题命中;
        // 资讯走 /legacy 路由层精确 301(单段直开的 308 永久类由 e2e 覆盖);/feed.xml 200
        const base = (process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000").replace(
          /\/+$/,
          "",
        );
        const get = async (
          p: string,
        ): Promise<{ status: number; location: string; body: string }> => {
          const res = await fetch(`${base}${p}`, {
            redirect: "manual",
            signal: AbortSignal.timeout(10_000),
          });
          return {
            status: res.status,
            location: res.headers.get("location") ?? "",
            body: res.status === 200 ? await res.text() : "",
          };
        };
        let badPost = 0;
        for (const p of postSlugs) {
          try {
            const r = await get(`/${p.slug}/`);
            if (r.status !== 200 || !r.body.includes(p.title)) badPost++;
          } catch {
            badPost++;
          }
        }
        let badNews = 0;
        for (const m of newsEntries) {
          try {
            const r = await get(`/legacy${m.oldPath}`);
            // Next redirect 可能返回绝对 Location:统一解析 pathname 再比对
            const loc = /^https?:\/\//.test(r.location) ? new URL(r.location).pathname : r.location;
            if (r.status !== 301 || loc !== "/articles") badNews++;
          } catch {
            badNews++;
          }
        }
        let feedOk = false;
        try {
          const r = await get("/feed.xml");
          feedOk = r.status === 200 && r.body.includes("<item>");
        } catch {
          feedOk = false;
        }
        const okHttp = okDb && badPost === 0 && badNews === 0 && feedOk;
        add({
          id: 4,
          name: "URL 抽样(HTTP 实测:文章 200+标题命中 / legacy 路由 301 / feed.xml 200)",
          status: okHttp ? "PASS" : "FAIL",
          details: `base=${base} posts=${postSlugs.length - badPost}/${postSlugs.length} news301=${newsEntries.length - badNews}/${newsEntries.length} feed=${feedOk ? 200 : "FAIL"}`,
        });
      } else {
        add({
          id: 4,
          name: "URL 抽样(DB 层:资讯 301 映射 + 文章 slug 在库;HTTP 待 M3)",
          status: okDb ? "PASS" : "FAIL",
          details: `legacyMapped=${mapped.length}/${newsEntries.length} slugsInDb=${slugsInDb.length}/${postSlugs.length}`,
        });
      }
    }

    // ── 5. 用户对账 ──
    {
      const [counts] = await q<{ active: string; pending: string; admins: string; dup: string }>(
        `SELECT
           count(*) FILTER (WHERE status = 'active')::text AS active,
           count(*) FILTER (WHERE status = 'pending_binding')::text AS pending,
           count(*) FILTER (WHERE role = 'admin')::text AS admins,
           (count(phone) - count(DISTINCT phone))::text AS dup
         FROM user_account WHERE wp_user_id IS NOT NULL`,
      );
      const planActive = result.users.filter((u) => u.status === "active").length;
      const planPending = result.users.filter((u) => u.status === "pending_binding").length;
      const ok =
        Number(counts.active) === planActive &&
        Number(counts.pending) === planPending &&
        Number(counts.admins) === 1 &&
        Number(counts.dup) === 0;
      add({
        id: 5,
        name: "用户(手机号 active/待绑定/admin 唯一/无重复手机号)",
        status: ok ? "PASS" : "FAIL",
        details: `active=${counts.active}/${planActive} pending=${counts.pending}/${planPending} admins=${counts.admins} dupPhones=${counts.dup}`,
      });
    }

    // ── 6. 浏览量(插件真实口径 type=4;Top10 与总量一致)──
    {
      const top10Db = await q<{ slug: string; views_count: string }>(
        // 注意:必须用表限定排序列 —— ORDER BY views_count 会命中输出别名(text)按字典序排
        "SELECT slug, views_count::text FROM content_post WHERE wp_post_id IS NOT NULL ORDER BY content_post.views_count DESC LIMIT 10",
      );
      const planTop10 = [...result.posts]
        .sort((a, b) => b.viewsCount - a.viewsCount)
        .slice(0, 10)
        .map((p) => ({ slug: p.slug, views: p.viewsCount }));
      const okOrder = top10Db.every(
        (r, i) => r.slug === planTop10[i].slug && Number(r.views_count) === planTop10[i].views,
      );
      const [{ total_db }] = await q<{ total_db: string }>(
        "SELECT COALESCE(sum(views_count), 0)::text AS total_db FROM content_post WHERE wp_post_id IS NOT NULL",
      );
      const totalDb = total_db;
      const totalPlan = result.posts.reduce((s, p) => s + p.viewsCount, 0);
      add({
        id: 6,
        name: "浏览量(Top10 顺序与数值、全量总和;口径=插件 type=4)",
        status: okOrder && Number(totalDb) === totalPlan ? "PASS" : "FAIL",
        details: `top1=${top10Db[0]?.slug}:${top10Db[0]?.views_count} total=${totalDb}/${totalPlan}`,
      });
    }

    // ── 7. 汇总报告 ──
    {
      const failed = checks.filter((c) => c.status === "FAIL");
      add({
        id: 7,
        name: "汇总(verify_report.json 落盘)",
        status: failed.length === 0 ? "PASS" : "FAIL",
        details:
          failed.length === 0 ? "全部 PASS" : `FAIL 项:${failed.map((f) => f.name).join(";")}`,
      });
      await writeFile(
        join(config.artifactsDir(), ARTIFACTS.verify),
        JSON.stringify({ generatedAt: new Date().toISOString(), checks }, null, 2),
        "utf8",
      );
    }
  } finally {
    await pool.end();
  }

  for (const c of checks) {
    console.log(JSON.stringify({ event: "verify.check", ...c }));
  }
  return checks;
}

if (process.argv[1]?.endsWith("verify.ts")) {
  runVerify({ http: process.argv.includes("--http") }).then((checks) => {
    const failed = checks.filter((c) => c.status === "FAIL");
    console.log(JSON.stringify({ event: "verify.done", failed: failed.length }));
    process.exit(failed.length > 0 ? 1 : 0);
  });
}
