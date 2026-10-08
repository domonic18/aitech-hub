/**
 * embedding 向量仓集成测试(依赖 dev compose PG,须带 pgvector 扩展镜像)。
 * 覆盖:stale 扫描(缺向量)→ upsert(幂等覆盖)→ 余弦近邻排序 →
 * 孤儿清理(下架/隐藏/回草稿后删除向量)。自建行自清理,不触碰既有数据。
 */
import { loadEnvConfig } from "@next/env";
import type { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

loadEnvConfig(process.cwd());
process.env.LOG_LEVEL = "silent";

const MARK = `embedit${Date.now()}`;

describe("embedding-repo(集成,dev PG)", () => {
  let postId = BigInt(0);
  let telegramId = BigInt(0);
  let repoId = 0;
  let prisma: PrismaClient;

  beforeAll(async () => {
    ({ prisma } = await import("@/lib/db"));
    const category = await prisma.category.findFirst({ select: { id: true } });
    const source = await prisma.crawlSource.findFirst({ select: { id: true } });
    if (!category || !source) throw new Error("dev 库缺 category/crawlSource 基础行");

    const post = await prisma.post.create({
      data: {
        title: `${MARK} 标题`,
        contentMd: "正文",
        categoryId: category.id,
        status: "published",
      },
      select: { id: true },
    });
    postId = post.id;
    const tg = await prisma.telegram.create({
      data: {
        sourceId: source.id,
        title: `${MARK} 电报`,
        summary: "摘要",
        url: `https://example.com/${MARK}`,
        contentHash: MARK,
        status: "visible",
      },
      select: { id: true },
    });
    telegramId = tg.id;
    const repo = await prisma.githubRepo.create({
      data: {
        fullName: `owner/${MARK}`,
        slug: MARK,
        htmlUrl: `https://github.com/owner/${MARK}`,
      },
      select: { id: true },
    });
    repoId = repo.id;
  });

  afterAll(async () => {
    if (!prisma) return;
    await prisma.$executeRawUnsafe(
      `DELETE FROM search_embedding WHERE entity_id IN (${postId}, ${telegramId}, ${repoId})`,
    );
    await prisma.post.deleteMany({ where: { title: { contains: MARK } } });
    await prisma.telegram.deleteMany({ where: { title: { contains: MARK } } });
    await prisma.githubRepo.deleteMany({ where: { fullName: { contains: MARK } } });
    await prisma.$disconnect();
  });

  it("stale 扫描 → upsert 幂等 → 余弦近邻 → 孤儿清理", async () => {
    const { EMBEDDING_DIMS } = await import("./embedding");
    const repo = await import("./embedding-repo");

    // 1. 三域新行都是 stale(本轮 limit 覆盖到自建行;按 (域,id) 对匹配——
    // post/telegram 是独立序列,id 数值可撞车,单比 id 会误匹配他域行)
    const stale = await repo.findStaleEmbedSources(500);
    const myKeys = [`post:${postId}`, `telegram:${telegramId}`, `repo:${BigInt(repoId)}`];
    const mine = stale.filter((r) => myKeys.includes(`${r.entityType}:${r.entityId}`));
    expect(mine.map((r) => r.entityType).sort()).toEqual(["post", "repo", "telegram"]);

    // 2. upsert 后重放幂等(行数不增);缺向量行数归零(本组)
    const vec = (base: number): number[] =>
      Array.from({ length: EMBEDDING_DIMS }, (_, i) => (i % 5 === 0 ? base : base * 0.5));
    const rows = [
      { entityType: "post" as const, entityId: postId, model: "it-emb", vector: vec(1) },
      { entityType: "telegram" as const, entityId: telegramId, model: "it-emb", vector: vec(0.9) },
      { entityType: "repo" as const, entityId: BigInt(repoId), model: "it-emb", vector: vec(0.1) },
    ];
    await repo.upsertEmbeddings(rows);
    await repo.upsertEmbeddings([rows[0]!]); // 幂等重放
    const count = await prisma.$queryRaw<{ n: bigint }[]>`
      SELECT count(*)::bigint AS n FROM search_embedding
       WHERE entity_id IN (${postId}, ${telegramId}, ${repoId})`;
    expect(count[0]?.n).toBe(BigInt(3));
    const staleAgain = await repo.findStaleEmbedSources(500);
    expect(staleAgain.filter((r) => myKeys.includes(`${r.entityType}:${r.entityId}`))).toEqual([]);

    // 3. 余弦近邻:同向向量距离 0 排首;返回按距离升序
    const postHits = await repo.topVectorMatches("post", vec(1), 5);
    expect(postHits[0]?.entityId).toBe(postId);
    expect(postHits[0]?.distance).toBeCloseTo(0, 6);
    const repoHits = await repo.topVectorMatches("repo", vec(1), 5);
    expect(repoHits[0]?.entityId).toBe(BigInt(repoId));
    const distances = repoHits.map((h) => h.distance);
    expect([...distances].sort((a, b) => a - b)).toEqual(distances);

    // 4. 孤儿清理:post 回草稿 + telegram 隐藏 + repo 下架 → 三条向量全清
    await prisma.post.update({ where: { id: postId }, data: { status: "draft" } });
    await prisma.telegram.update({ where: { id: telegramId }, data: { status: "hidden" } });
    await prisma.githubRepo.update({ where: { id: repoId }, data: { display: false } });
    const removed = await repo.cleanupOrphanEmbeddings();
    expect(removed).toBeGreaterThanOrEqual(3);
    const left = await prisma.$queryRaw<{ n: bigint }[]>`
      SELECT count(*)::bigint AS n FROM search_embedding
       WHERE entity_id IN (${postId}, ${telegramId}, ${repoId})`;
    expect(left[0]?.n).toBe(BigInt(0));
  });
});
