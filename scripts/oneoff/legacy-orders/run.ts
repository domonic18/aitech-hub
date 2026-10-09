/**
 * 历史订单导入(M21 批⑥,提案 §5.3):旧 WP 库 wp_wpcom_orders → 影子单
 * pay_order(gateway=legacy_xunhu,status=paid,paidAt=旧 time)+ pay_order_item
 * + 权益 content_post_purchase(source=import);顺带回填命中文章付费开关与
 * 价格(旧 _wpcom_metas.unlock_price,已是付费的文不覆盖)。
 *
 * 订单号 = `L` + 旧 number(19 位 bigint,连接须 bigNumberStrings,防 float
 * 损坏);order_no 唯一索引天然幂等,--apply 重跑对已导入单只跳过。
 * 文章映射走 content_post.wp_post_id;wp_user_id 命中 user_account。
 *
 * @status oneoff(生产导入执行后删除本目录,git 历史存档;7 单 36131 等 D2 补迁后重跑补齐)
 *
 * 用法:
 *   LEGACY_WP_DB_URL=mysql://user:pass@host:port/wordpress \
 *     npx tsx scripts/oneoff/legacy-orders/run.ts            # dry-run(默认,只读双侧)
 *   LEGACY_WP_DB_URL=… npx tsx scripts/oneoff/legacy-orders/run.ts --apply
 *
 * 报告输出:可导入/跳过/阻塞明细 + 金额合计;36131 未补迁(D2)前其订单
 * 阻塞,补迁后重跑自动补齐。连接串只从 env 读,不打印不入库。
 */
import { loadEnvConfig } from "@next/env";

loadEnvConfig(process.cwd());

interface LegacyOrderRow {
  ID: number;
  number: string;
  price: string;
  user: string;
  time: Date;
  status: string;
  payment_gateway: string | null;
}
interface LegacyItemRow {
  order_id: number;
  price: string;
  title: string | null;
  type_id: string | null;
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

  // ── 1. 读旧库(bigint 全字符串化;utf8mb4 显式声明) ──
  const conn = await createConnection({ uri: dbUrl, charset: "utf8mb4" });
  const [orderRowRaw] = await conn.query(
    "SELECT ID, number, price, user, time, status, payment_gateway FROM wp_wpcom_orders ORDER BY ID",
  );
  const orderRows = orderRowRaw as LegacyOrderRow[];
  const [itemRowRaw] = await conn.query(
    "SELECT order_id, price, title, type_id FROM wp_wpcom_order_items ORDER BY ID",
  );
  const itemRows = itemRowRaw as LegacyItemRow[];
  const wpPostIds = [
    ...new Set(itemRows.map((i) => Number.parseInt((i.type_id ?? "").split("::")[0] ?? "", 10))),
  ].filter((n) => Number.isInteger(n) && n > 0);
  const [metaRowRaw] = await conn.query(
    "SELECT post_id, meta_value FROM wp_postmeta WHERE meta_key = '_wpcom_metas' AND post_id IN (?)",
    [wpPostIds],
  );
  const metaRows = metaRowRaw as Array<{ post_id: number; meta_value: string }>;
  await conn.end();

  // 旧付费价:unlock_type=3(付费解锁)才有效
  const legacyPrice = new Map<number, number>();
  for (const m of metaRows) {
    try {
      const meta = JSON.parse(m.meta_value) as { unlock_type?: string; unlock_price?: string };
      if (meta.unlock_type === "3" && meta.unlock_price) {
        legacyPrice.set(m.post_id, Number.parseFloat(meta.unlock_price));
      }
    } catch {
      // 坏 JSON 不入定价映射,明细行会标 price_missing
    }
  }

  // ── 2. 新库映射:文章 + 用户 ──
  const posts = await prisma.post.findMany({
    where: { wpPostId: { in: wpPostIds.map((n) => BigInt(n)) } },
    select: { id: true, wpPostId: true, title: true, isPurchasable: true },
  });
  const postByWpId = new Map<number, (typeof posts)[number]>();
  for (const p of posts) postByWpId.set(Number(p.wpPostId), p);

  const userIds = [...new Set(orderRows.map((o) => Number(o.user)))].filter((n) => n > 0);
  const users = await prisma.userAccount.findMany({
    where: { wpUserId: { in: userIds.map((n) => BigInt(n)) } },
    select: { id: true, wpUserId: true },
  });
  const userByWpId = new Map<number, bigint>();
  for (const u of users) userByWpId.set(Number(u.wpUserId), u.id);

  // ── 3. 逐单裁定 ──
  const itemsByOrder = new Map<number, LegacyItemRow[]>();
  for (const it of itemRows) {
    const list = itemsByOrder.get(it.order_id) ?? [];
    list.push(it);
    itemsByOrder.set(it.order_id, list);
  }

  type Plan = {
    order: LegacyOrderRow;
    items: Array<{ row: LegacyItemRow; wpPostId: number; postId: bigint }>;
  };
  const importable: Plan[] = [];
  const blocked: Array<{ order: LegacyOrderRow; reason: string }> = [];
  let cancelCount = 0;

  for (const order of orderRows) {
    if (order.status !== "paid") {
      cancelCount += 1;
      continue;
    }
    const user = userByWpId.get(Number(order.user));
    if (!user) {
      blocked.push({ order, reason: `用户未命中(wp_user_id=${order.user})` });
      continue;
    }
    const items: Plan["items"] = [];
    let reason = "";
    for (const row of itemsByOrder.get(order.ID) ?? []) {
      const wpPostId = Number.parseInt((row.type_id ?? "").split("::")[0] ?? "", 10);
      const post = postByWpId.get(wpPostId);
      if (!post) {
        reason = `文章未迁移(wp_post_id=${wpPostId},D2 补迁后重跑)`;
        break;
      }
      items.push({ row, wpPostId, postId: post.id });
    }
    if (reason) blocked.push({ order, reason });
    else if (items.length === 0) blocked.push({ order, reason: "无订单明细行" });
    else importable.push({ order, items });
  }

  // ── 4. 报告 ──
  const yuan = (v: string) => `¥${Number.parseFloat(v).toFixed(2)}`;
  const fmtTime = (d: Date) =>
    d.toLocaleString("zh-CN", {
      timeZone: "Asia/Shanghai",
      dateStyle: "short",
      timeStyle: "short",
    });
  console.log(`\n===== 历史订单导入${apply ? "【APPLY】" : "(dry-run)"} =====`);
  console.log(
    `旧库订单 ${orderRows.length} 笔:paid ${importable.length + blocked.length}(可导入 ${importable.length} / 阻塞 ${blocked.length}),cancel 跳过 ${cancelCount}`,
  );

  // 订单号重复预检:重复号会使 --apply 的幂等跳过吞单,发现即中止
  const seen = new Set<string>();
  const dup = orderRows
    .map((o) => o.number)
    .filter((n) => (seen.has(n) ? true : (seen.add(n), false)));
  if (dup.length > 0) {
    throw new Error(`旧库订单号重复,中止:${dup.join(",")}`);
  }

  console.log(
    `\n—— 可导入明细(${importable.length} 笔,合计 ${yuan(String(importable.reduce((s, p) => s + Number.parseFloat(p.order.price), 0)))})——`,
  );
  for (const p of importable) {
    const postsDesc = p.items.map((i) => `wp${i.wpPostId}→post${i.postId.toString()}`).join(", ");
    console.log(
      `  L${p.order.number}  ${yuan(p.order.price)}  用户wp${p.order.user}→user${userByWpId.get(Number(p.order.user))?.toString()}  ${postsDesc}  ${fmtTime(p.order.time)}  ${p.order.payment_gateway ?? "-"}`,
    );
  }
  if (blocked.length > 0) {
    console.log(
      `\n—— 阻塞/跳过(${blocked.length} 笔,合计 ${yuan(String(blocked.reduce((s, b) => s + Number.parseFloat(b.order.price), 0)))})——`,
    );
    for (const b of blocked) {
      console.log(`  L${b.order.number}  ${yuan(b.order.price)}  ${b.reason}`);
    }
  }

  const backfill = wpPostIds.filter((wp) => {
    const p = postByWpId.get(wp);
    return p && !p.isPurchasable && legacyPrice.has(wp);
  });
  console.log(`\n—— 付费定价回填(旧 unlock_price,已是付费的不动)——`);
  for (const wp of backfill) {
    const p = postByWpId.get(wp)!;
    console.log(
      `  wp${wp}→post${p.id.toString()}  ¥${legacyPrice.get(wp)?.toFixed(2)}  ${p.title}`,
    );
  }
  if (backfill.length === 0) console.log("  (无)");

  if (!apply) {
    console.log("\ndry-run 完成。评审确认后加 --apply 执行导入(幂等,重跑只跳过已导入单)。");
    await prisma.$disconnect();
    return;
  }

  // ── 5. apply:逐单事务导入(幂等:order_no 唯一) ──
  let created = 0;
  let existed = 0;
  for (const p of importable) {
    const orderNo = `L${p.order.number}`;
    const existing = await prisma.payOrder.findUnique({ where: { orderNo }, select: { id: true } });
    if (existing) {
      existed += 1;
      continue;
    }
    await prisma.$transaction(async (tx) => {
      const order = await tx.payOrder.create({
        data: {
          orderNo,
          userId: userByWpId.get(Number(p.order.user))!,
          status: "paid",
          amount: p.order.price,
          gateway: "legacy_xunhu",
          paidAt: p.order.time,
          expiresAt: p.order.time, // 已终结单,占位满足非空约束
          createdAt: p.order.time,
        },
      });
      await tx.payOrderItem.createMany({
        data: p.items.map((i) => ({
          orderId: order.id,
          postId: i.postId,
          title: (i.row.title ?? "").slice(0, 200),
          unitPrice: i.row.price,
        })),
      });
      for (const i of p.items) {
        const has = await tx.contentPostPurchase.findUnique({
          where: {
            userId_postId: { userId: userByWpId.get(Number(p.order.user))!, postId: i.postId },
          },
          select: { id: true },
        });
        // 已有权益不刷新(不重置 grantedAt);无则补 source=import,paidAt 为授予时点
        if (!has) {
          await tx.contentPostPurchase.create({
            data: {
              userId: userByWpId.get(Number(p.order.user))!,
              postId: i.postId,
              orderId: order.id,
              source: "import",
              grantedAt: p.order.time,
            },
          });
        }
      }
    });
    created += 1;
  }

  // 付费定价回填:只动当前关闭付费的命中文
  let priced = 0;
  for (const wp of backfill) {
    const r = await prisma.post.updateMany({
      where: { wpPostId: BigInt(wp), isPurchasable: false },
      data: { isPurchasable: true, purchasePrice: legacyPrice.get(wp)! },
    });
    priced += r.count;
  }

  console.log(`\n===== apply 完成 =====`);
  console.log(`订单:新建 ${created},已存在跳过 ${existed},阻塞未导 ${blocked.length}`);
  console.log(`权益:随单授予(import;已持有不刷新 grantedAt)`);
  console.log(`定价回填:${priced} 篇`);
  console.log(`注意:回填文章若已在 ISR 缓存,需触发一次 revalidate(admin 编辑器保存或等定时刷新)。`);
  await prisma.$disconnect();
}

void main().catch((e) => {
  console.error("导入失败:", e instanceof Error ? e.message : e);
  process.exit(1);
});
