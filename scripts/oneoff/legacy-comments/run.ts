/**
 * 旧站评论导入(M23 批①脚本/批④执行):旧 WP 库 wp_comments →
 * content_post_comment(status=visible)。取舍(requirement §5 修订后口径):
 * 仅 comment_approved IN ('1','approved') AND comment_type='comment'
 * (spam 与 qapress 问答 answer 不迁——问答帖无目标文章)。
 *
 * 映射与保真:文章走 content_post.wp_post_id;作者 user_id>0 走
 * user_account.wp_user_id 挂 userId,authorName 一律取 WP comment_author
 * 原名(登录者昵称可能已改,保旧站观感);email/IP/agent 不迁。
 * 内容:WP 编辑器 HTML 剥标签+解实体转纯文字(评论纯文字口径,见
 * normalizeContent);时间取 comment_date_gmt(UTC,连接 timezone:"Z")。
 * 嵌套:WP 任意深度 → 沿祖先链找根,parentId 一律挂根新 id(两级封顶),
 * 跨层子标 promoted;祖先链断裂(父不在候选集)标 orphan_parent 阻塞。
 * 幂等:wpCommentId 唯一,--apply 重跑对已导入只跳过。
 *
 * @status oneoff(生产导入执行后删除本目录,git 历史存档)
 *
 * 用法:
 *   LEGACY_WP_DB_URL=mysql://user:pass@host:port/wordpress \
 *     npx tsx scripts/oneoff/legacy-comments/run.ts            # dry-run(默认,只读双侧)
 *   LEGACY_WP_DB_URL=… npx tsx scripts/oneoff/legacy-comments/run.ts --apply
 *
 * 报告输出:审核态分布/可导入/阻塞明细/作者映射/根-子-提升计数/时间范围/
 * 逐条明细。连接串只从 env 读,不打印不入库。迁移后零 revalidate
 * (评论区 client fetch 天然即时,无需刷新缓存)。
 */
import { loadEnvConfig } from "@next/env";

loadEnvConfig(process.cwd());

interface LegacyCommentRow {
  comment_ID: string;
  comment_post_ID: string;
  comment_author: string;
  comment_date_gmt: Date;
  comment_content: string;
  comment_approved: string;
  comment_type: string;
  comment_parent: string;
  user_id: string;
}

/** WP 原文换行归一(库内 \r\n → \n)后超列宽即阻塞(列 VarChar(4000)) */
const CONTENT_COLUMN_MAX = 4000;

/**
 * WP 原文 → 纯文本(评论纯文字口径,requirement §4:前台 React 转义渲染,
 * 标签/实体会当字面文字显示,须入库前清洗)。顺序敏感:先剥标签再解实体——
 * 反过来会把作者写的 `&lt;code&gt;` 字面文本误当标签剥掉。块级闭标签与 br
 * 折行,3+ 连续空行压 2;内容只缩不涨,列宽阻塞检查在归一后判断。
 */
function normalizeContent(raw: string): string {
  const noTags = raw
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|pre|li|blockquote)>/gi, "\n")
    .replace(/<[^>]+>/g, "");
  return noTags
    .replace(/&nbsp;/gi, " ")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#0?39;|&apos;/gi, "'")
    .replace(/&amp;/gi, "&")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

async function main(): Promise<void> {
  const apply = process.argv.includes("--apply");
  const dbUrl = process.env.LEGACY_WP_DB_URL;
  if (!dbUrl) {
    throw new Error("缺少 LEGACY_WP_DB_URL 环境变量(旧 WP MySQL 连接串)");
  }

  const [{ createConnection }, { prisma }] = await Promise.all([
    import("mysql2/promise"),
    import("../../../src/lib/db"),
  ]);

  // ── 1. 读旧库(bigint 全字符串化:supportBigNumbers+bigNumberStrings 必须成对,
  //      缺前者 BIGINT 仍落 JS number,越界即静默失真;连接按 UTC 解读 DATETIME)──
  const conn = await createConnection({
    uri: dbUrl,
    charset: "utf8mb4",
    timezone: "Z",
    supportBigNumbers: true,
    bigNumberStrings: true,
  });
  const [allRaw] = await conn.query(
    `SELECT comment_ID, comment_post_ID, comment_author, comment_date_gmt,
            comment_content, comment_approved, comment_type, comment_parent, user_id
       FROM wp_comments ORDER BY comment_ID`,
  );
  const allRows: LegacyCommentRow[] = (allRaw as Array<Record<string, unknown>>).map((r) => ({
    comment_ID: String(r.comment_ID),
    comment_post_ID: String(r.comment_post_ID),
    comment_author: String(r.comment_author ?? ""),
    comment_date_gmt: r.comment_date_gmt as Date,
    comment_content: String(r.comment_content ?? ""),
    comment_approved: String(r.comment_approved),
    comment_type: String(r.comment_type ?? ""),
    comment_parent: String(r.comment_parent),
    user_id: String(r.user_id),
  }));
  await conn.end();

  // 全量审核态/类型分布(报告口径 1)
  const approvedDist: Record<string, number> = {};
  const typeDist: Record<string, number> = {};
  for (const r of allRows) {
    approvedDist[r.comment_approved] = (approvedDist[r.comment_approved] ?? 0) + 1;
    typeDist[r.comment_type || "(empty)"] = (typeDist[r.comment_type || "(empty)"] ?? 0) + 1;
  }
  const candidates = allRows.filter(
    (r) =>
      (r.comment_approved === "1" || r.comment_approved === "approved") &&
      r.comment_type === "comment",
  );

  // ── 2. 新库映射:文章 + 用户 ──
  const wpPostIds = [...new Set(candidates.map((r) => r.comment_post_ID))].map((n) => BigInt(n));
  const posts = await prisma.post.findMany({
    where: { wpPostId: { in: wpPostIds } },
    select: { id: true, wpPostId: true, title: true },
  });
  const postByWpId = new Map<string, (typeof posts)[number]>();
  for (const p of posts) if (p.wpPostId !== null) postByWpId.set(p.wpPostId.toString(), p);

  const userIds = [...new Set(candidates.map((r) => r.user_id))]
    .filter((n) => n !== "0")
    .map((n) => BigInt(n));
  const users = await prisma.userAccount.findMany({
    where: { wpUserId: { in: userIds } },
    select: { id: true, wpUserId: true },
  });
  const userByWpId = new Map<string, bigint>();
  for (const u of users) if (u.wpUserId !== null) userByWpId.set(u.wpUserId.toString(), u.id);

  const byOldId = new Map(candidates.map((r) => [r.comment_ID, r]));

  // ── 3. 按 ID 升序裁定(父必先于子被处理;父阻塞则子连带阻塞)──
  type Importable = {
    row: LegacyCommentRow;
    wpPostId: string;
    postId: bigint;
    userId: bigint | null;
    content: string;
    rootOldId: string;
    promoted: boolean;
    depth: number; // 距根层数(0=根)
  };
  const importable: Importable[] = [];
  const blocked: Array<{ row: LegacyCommentRow; reason: string }> = [];
  const blockedOldIds = new Set<string>();

  for (const row of candidates) {
    const post = postByWpId.get(row.comment_post_ID);
    if (!post) {
      blocked.push({ row, reason: `文章未迁移(wp_post_id=${row.comment_post_ID})` });
      blockedOldIds.add(row.comment_ID);
      continue;
    }
    const content = normalizeContent(row.comment_content);
    if (content.length === 0) {
      blocked.push({ row, reason: "归一后内容为空" });
      blockedOldIds.add(row.comment_ID);
      continue;
    }
    if (content.length > CONTENT_COLUMN_MAX) {
      blocked.push({ row, reason: `归一后超列宽(${content.length} > ${CONTENT_COLUMN_MAX})` });
      blockedOldIds.add(row.comment_ID);
      continue;
    }
    // 沿父链找根:父不在候选集 = 孤儿父;父已阻塞 = 连带阻塞
    let rootOldId = row.comment_ID;
    let depth = 0;
    let chainBroken = false;
    let inherited = false;
    let cur: LegacyCommentRow | undefined = row;
    const seen = new Set<string>([row.comment_ID]);
    while (cur && cur.comment_parent !== "0") {
      if (seen.has(cur.comment_parent)) {
        chainBroken = true; // 环(理论不应出现,防御)
        break;
      }
      seen.add(cur.comment_parent);
      const parent = byOldId.get(cur.comment_parent);
      if (!parent) {
        chainBroken = true; // 孤儿父:父不在迁移候选集
        break;
      }
      if (blockedOldIds.has(cur.comment_parent)) {
        inherited = true;
        break;
      }
      cur = parent;
      rootOldId = cur.comment_ID;
      depth += 1;
    }
    if (chainBroken) {
      blocked.push({
        row,
        reason: `祖先链断裂(直接父 comment_parent=${row.comment_parent} 不在候选集)`,
      });
      blockedOldIds.add(row.comment_ID);
      continue;
    }
    if (inherited) {
      blocked.push({ row, reason: "父级评论被阻塞,连带不迁" });
      blockedOldIds.add(row.comment_ID);
      continue;
    }
    const userId = row.user_id !== "0" ? (userByWpId.get(row.user_id) ?? null) : null;
    importable.push({
      row,
      wpPostId: row.comment_post_ID,
      postId: post.id,
      userId,
      content,
      rootOldId,
      promoted: depth > 1, // depth=1 挂直接父(即根)= 原样;≥2 才是跨层提升
      depth,
    });
  }

  // ── 4. 报告 ──
  const fmtTime = (d: Date) =>
    d.toLocaleString("zh-CN", {
      timeZone: "Asia/Shanghai",
      dateStyle: "short",
      timeStyle: "short",
    });
  const times = importable
    .map((i) => i.row.comment_date_gmt)
    .sort((a, b) => a.getTime() - b.getTime());
  const roots = importable.filter((i) => i.depth === 0);
  const replies = importable.filter((i) => i.depth > 0);
  const promoted = importable.filter((i) => i.promoted);
  const withUser = importable.filter((i) => i.userId !== null);
  const userUnmapped = importable.filter((i) => i.row.user_id !== "0" && i.userId === null);
  const postsInvolved = new Map<string, number>();
  for (const i of importable)
    postsInvolved.set(i.wpPostId, (postsInvolved.get(i.wpPostId) ?? 0) + 1);

  console.log(`\n===== 旧站评论导入${apply ? "【APPLY】" : "(dry-run)"} =====`);
  console.log(`旧库 wp_comments 总数 ${allRows.length}`);
  console.log(`  审核态分布:${JSON.stringify(approvedDist)}`);
  console.log(`  类型分布:${JSON.stringify(typeDist)}`);
  console.log(`迁移候选(approved=1 且 type=comment):${candidates.length}`);
  console.log(
    `  可导入 ${importable.length}(根 ${roots.length} / 回复 ${replies.length},跨层提升挂根 ${promoted.length})`,
  );
  console.log(`  阻塞 ${blocked.length}`);
  console.log(
    `作者:挂账号 ${withUser.length},游客 ${importable.length - withUser.length},账号未命中(落游客)${userUnmapped.length}`,
  );
  if (userUnmapped.length > 0) {
    console.log(
      `  未命中 wp_user_id:${userUnmapped.map((i) => `c${i.row.comment_ID}:u${i.row.user_id}`).join(" ")}`,
    );
  }
  console.log(
    `涉及文章 ${postsInvolved.size} 篇;时间范围 ${times.length > 0 ? `${fmtTime(times[0])} ~ ${fmtTime(times[times.length - 1])}` : "-"}`,
  );

  const postTitle = (wpId: string) => postByWpId.get(wpId)?.title ?? "?";
  console.log(`\n—— 可导入明细(按旧 ID 升序,apply 顺序)——`);
  for (const i of importable) {
    const depthTag = i.depth === 0 ? "根" : `回复·挂根c${i.rootOldId}${i.promoted ? "(提升)" : ""}`;
    const author =
      i.userId !== null ? `user${i.userId.toString()}` : `游客:${i.row.comment_author}`;
    console.log(
      `  c${i.row.comment_ID} → post${i.postId.toString()}(wp${i.wpPostId}《${postTitle(i.wpPostId)}》)  ${depthTag}  ${author}  ${fmtTime(i.row.comment_date_gmt)}  ${i.content.slice(0, 40).replace(/\n/g, "\\n")}${i.content.length > 40 ? "…" : ""}`,
    );
  }
  if (blocked.length > 0) {
    console.log(`\n—— 阻塞明细(${blocked.length})——`);
    for (const b of blocked) {
      console.log(
        `  c${b.row.comment_ID} wp${b.row.comment_post_ID} ${b.reason}  ${b.row.comment_content.slice(0, 30).replace(/\r?\n/g, "\\n")}`,
      );
    }
  }

  if (!apply) {
    console.log("\ndry-run 完成。评审确认后加 --apply 执行导入(幂等,重跑只跳过已导入评论)。");
    await prisma.$disconnect();
    return;
  }

  // ── 5. apply:按序逐条事务导入(幂等:wpCommentId 唯一;旧ID→新ID映射供子挂根)──
  let created = 0;
  let existed = 0;
  const newIdByOldId = new Map<string, bigint>();
  for (const i of importable) {
    const existing = await prisma.postComment.findUnique({
      where: { wpCommentId: BigInt(i.row.comment_ID) },
      select: { id: true },
    });
    if (existing) {
      newIdByOldId.set(i.row.comment_ID, existing.id);
      existed += 1;
      continue;
    }
    const parentId = i.depth === 0 ? null : (newIdByOldId.get(i.rootOldId) ?? null);
    if (i.depth > 0 && parentId === null) {
      // 理论不可达(父必先处理);防御:不静默挂错
      throw new Error(`c${i.row.comment_ID} 的根 c${i.rootOldId} 无新 id,中止`);
    }
    const createdRow = await prisma.postComment.create({
      data: {
        postId: i.postId,
        userId: i.userId,
        authorName: i.row.comment_author.slice(0, 100),
        content: i.content,
        status: "visible",
        parentId,
        wpCommentId: BigInt(i.row.comment_ID),
        createdAt: i.row.comment_date_gmt,
      },
      select: { id: true },
    });
    newIdByOldId.set(i.row.comment_ID, createdRow.id);
    created += 1;
  }

  console.log(`\n===== apply 完成 =====`);
  console.log(`评论:新建 ${created},已存在跳过 ${existed},阻塞未导 ${blocked.length}`);
  console.log(`迁移后零 revalidate(评论区 client fetch 天然即时);重跑应全量已存在跳过。`);
  await prisma.$disconnect();
}

void main().catch((e) => {
  console.error("导入失败:", e instanceof Error ? e.message : e);
  process.exit(1);
});
