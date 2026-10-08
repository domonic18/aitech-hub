/**
 * transform 阶段编排:读 extract 产物 → 纯函数映射 →
 * 写 transform-result.json(load 计划)与 migration_report.json(对账/警告)。
 * --dry-run 到此为止,不落库不拷贝媒体。
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { ARTIFACTS, config } from "./config";
import { buildLegacyMap, transformPosts } from "./transform-posts";
import { transformUsers } from "./transform-users";
import type {
  TransformResult,
  WpLegacyPostRow,
  WpPostMetaRow,
  WpPostRow,
  WpRelRow,
  WpTermRow,
  WpUserMetaRow,
  WpUserRow,
  WpViewTotalRow,
  WpYoastRow,
} from "./types";

async function read<T>(name: string): Promise<T> {
  return JSON.parse(await readFile(join(config.artifactsDir(), name), "utf8")) as T;
}

export async function runTransform(): Promise<TransformResult> {
  const dir = config.artifactsDir();

  const [posts, legacyPosts, postMeta, terms, rels, yoast, viewsTotal] = await Promise.all([
    read<WpPostRow[]>(ARTIFACTS.posts),
    read<WpLegacyPostRow[]>(ARTIFACTS.legacyPosts),
    read<WpPostMetaRow[]>(ARTIFACTS.postMeta),
    read<WpTermRow[]>(ARTIFACTS.terms),
    read<WpRelRow[]>(ARTIFACTS.rels),
    read<WpYoastRow[]>(ARTIFACTS.yoast),
    read<WpViewTotalRow[]>(ARTIFACTS.viewsTotal),
  ]);

  const base64Dir = join(dir, ARTIFACTS.transform.base64Dir);
  await mkdir(base64Dir, { recursive: true });

  // base64 解码图先攒内存,transform 收尾统一落盘(media 阶段要读,必须等写完)
  const pendingBase64: Array<{ name: string; buffer: Buffer }> = [];
  const postsOut = transformPosts({
    posts,
    postMeta,
    terms,
    rels,
    yoast,
    viewsTotal,
    onBase64: (name, buffer) => {
      pendingBase64.push({ name, buffer });
    },
  });
  await Promise.all(pendingBase64.map((f) => writeFile(join(base64Dir, f.name), f.buffer)));

  const usersOut = await (async () => {
    const [users, userMeta] = await Promise.all([
      read<WpUserRow[]>(ARTIFACTS.users),
      read<WpUserMetaRow[]>(ARTIFACTS.userMeta),
    ]);
    return transformUsers(users, userMeta);
  })();

  const legacy = buildLegacyMap({
    posts,
    legacyPosts,
    terms,
    rels,
    scopedWpIds: postsOut.scopedWpIds,
    migratedTagSlugs: new Set(postsOut.tags.map((t) => t.slug)),
  });

  // views 日明细:仅范围内文章
  const viewsDailyAll = await read<Array<{ id: number; period: string; count: number }>>(
    ARTIFACTS.viewsDaily,
  );
  const viewsDaily = viewsDailyAll
    .filter((v) => postsOut.scopedWpIds.has(v.id))
    .map((v) => ({
      postWpId: v.id,
      viewDate: `${v.period.slice(0, 4)}-${v.period.slice(4, 6)}-${v.period.slice(6, 8)}`,
      count: Number(v.count),
    }));

  const result: TransformResult = {
    posts: postsOut.posts,
    tags: postsOut.tags,
    media: postsOut.media,
    mediaRefs: postsOut.mediaRefs,
    users: usersOut.users,
    viewsDaily,
    legacyMap: legacy.legacyMap,
    warnings: [...postsOut.warnings, ...usersOut.warnings, ...legacy.warnings],
  };

  await writeFile(join(dir, ARTIFACTS.transform.result), JSON.stringify(result), "utf8");

  // migration_report:汇总 + 每篇清洗报告(无未确认警告 = 疑似丢失类告警需人工过目)
  const lossWarnings = result.warnings.filter(
    (w) => !w.scope.startsWith("post.base64") && w.scope !== "user.phone_duplicate",
  );
  const report = {
    generatedAt: new Date().toISOString(),
    summary: {
      posts: result.posts.length,
      tags: result.tags.length,
      media: result.media.length,
      mediaRefs: result.mediaRefs.length,
      users: result.users.length,
      usersActive: result.users.filter((u) => u.status === "active").length,
      usersPendingBinding: result.users.filter((u) => u.status === "pending_binding").length,
      viewsDailyRows: result.viewsDaily.length,
      legacyMapEntries: result.legacyMap.length,
      warnings: result.warnings.length,
    },
    cleanAggregates: aggregateCleanReports(result.posts),
    warnings: result.warnings,
    lossWarningsNeedingReview: lossWarnings,
  };
  await writeFile(join(dir, ARTIFACTS.transform.report), JSON.stringify(report, null, 2), "utf8");

  console.log(JSON.stringify({ event: "transform.done", summary: report.summary }));
  return result;
}

function aggregateCleanReports(posts: TransformResult["posts"]): Record<string, number> {
  const agg: Record<string, number> = {};
  for (const p of posts) {
    const r = p.cleanReport;
    const add = (k: string, v: number): void => {
      agg[k] = (agg[k] ?? 0) + v;
    };
    add("gutenbergCommentsRemoved", r.gutenbergCommentsRemoved);
    add("otherCommentsRemoved", r.otherCommentsRemoved);
    add("scriptsRemoved", r.scriptsRemoved);
    add("stylesRemoved", r.stylesRemoved);
    add("iframesKept", r.iframesKept);
    add("iframesRemoved", r.iframesRemoved.length);
    add("attributesStripped", r.attributesStripped);
    add("internalLinksRelativized", r.internalLinksRelativized);
    for (const [k, v] of Object.entries(r.tagsUnwrapped)) add(`unwrapped:${k}`, v);
    for (const [k, v] of Object.entries(r.tagsRenamed)) add(`renamed:${k}`, v);
    for (const s of r.shortcodesConverted) add(`shortcodeConverted:${s}`, 1);
    for (const s of r.shortcodesRemoved) add(`shortcodeRemoved:${s.code}`, 1);
    if (r.suspiciousResidue.length > 0) add("postsWithSuspiciousResidue", 1);
    if (r.warnings.length > 0) add("postsWithWarnings", 1);
  }
  return agg;
}

if (process.argv[1]?.endsWith("transform.ts")) {
  runTransform().catch((e) => {
    console.error(JSON.stringify({ event: "transform.failed", error: String(e) }));
    process.exit(1);
  });
}
