/**
 * embedding 向量仓(M20 批②):search_embedding 表唯一读写出口。
 * 向量列是 pgvector 自定义类型(Prisma Unsupported)——读写一律 raw SQL;
 * 三域源行经 Prisma 模型查询。stale 判定:向量缺失或 updated_at 早于源行
 * 变更(telegram 无 updated_at,以 COALESCE(ai_ran_at, created_at) 为源时钟)。
 */
import { Prisma } from "@prisma/client";

import { prisma } from "../db";
import {
  EMBEDDING_DIMS,
  type EmbedEntityType,
  type PostEmbedSource,
  type RepoEmbedSource,
  type TelegramEmbedSource,
  serializeVector,
} from "./embedding";

export interface EmbedSourceRef {
  entityType: EmbedEntityType;
  entityId: bigint;
}

/** 待嵌/需重嵌源行(三域 UNION,updated 倒序取 limit;批② 对账与批③ 复测共用) */
export async function findStaleEmbedSources(limit: number): Promise<EmbedSourceRef[]> {
  const rows = await prisma.$queryRaw<{ entity_type: string; entity_id: bigint }[]>(
    Prisma.sql`SELECT s.entity_type, s.entity_id FROM (
      SELECT 'post' AS entity_type, p.id AS entity_id, p.updated_at AS src_updated
        FROM content_post p
        LEFT JOIN search_embedding e ON e.entity_type = 'post' AND e.entity_id = p.id
       WHERE p.status = 'published' AND (e.id IS NULL OR e.updated_at < p.updated_at)
      UNION ALL
      SELECT 'telegram', t.id, COALESCE(t.ai_ran_at, t.created_at)
        FROM telegram t
        LEFT JOIN search_embedding e ON e.entity_type = 'telegram' AND e.entity_id = t.id
       WHERE t.status = 'visible'
         AND (e.id IS NULL OR e.updated_at < COALESCE(t.ai_ran_at, t.created_at))
      UNION ALL
      SELECT 'repo', r.id, r.updated_at
        FROM github_repo r
        LEFT JOIN search_embedding e ON e.entity_type = 'repo' AND e.entity_id = r.id
       WHERE r.display = true
         AND (e.id IS NULL OR e.updated_at < r.updated_at)
    ) s ORDER BY s.src_updated DESC LIMIT ${limit}`,
  );
  return rows.map((r) => ({
    entityType: r.entity_type as EmbedEntityType,
    entityId: r.entity_id,
  }));
}

/** 孤儿向量清理(下架/软删/隐藏内容的向量;三语句合计删除行数) */
export async function cleanupOrphanEmbeddings(): Promise<number> {
  const removed = await prisma.$executeRaw`
    DELETE FROM search_embedding e
     WHERE e.entity_type = 'post'
       AND NOT EXISTS (
         SELECT 1 FROM content_post p WHERE p.id = e.entity_id AND p.status = 'published')`;
  const removedTg = await prisma.$executeRaw`
    DELETE FROM search_embedding e
     WHERE e.entity_type = 'telegram'
       AND NOT EXISTS (
         SELECT 1 FROM telegram t WHERE t.id = e.entity_id AND t.status = 'visible')`;
  const removedRepo = await prisma.$executeRaw`
    DELETE FROM search_embedding e
     WHERE e.entity_type = 'repo'
       AND NOT EXISTS (
         SELECT 1 FROM github_repo r WHERE r.id = e.entity_id AND r.display = true)`;
  return removed + removedTg + removedRepo;
}

export interface EmbedUpsertRow {
  entityType: EmbedEntityType;
  entityId: bigint;
  model: string;
  vector: number[];
}

/** 批量 upsert(ON CONFLICT 原位覆盖;分片控制单语句参数量) */
export async function upsertEmbeddings(rows: EmbedUpsertRow[]): Promise<void> {
  const CHUNK = 25;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const slice = rows.slice(i, i + CHUNK);
    const values = slice.map(
      (r) =>
        Prisma.sql`(${r.entityType}, ${r.entityId}, ${r.model}, ${EMBEDDING_DIMS}, ${serializeVector(r.vector)}::vector)`,
    );
    await prisma.$executeRaw`
      INSERT INTO search_embedding (entity_type, entity_id, model, dims, embedding)
      VALUES ${Prisma.join(values)}
      ON CONFLICT (entity_type, entity_id) DO UPDATE
        SET model = EXCLUDED.model, dims = EXCLUDED.dims,
            embedding = EXCLUDED.embedding, updated_at = now()`;
  }
}

export interface VectorMatch {
  entityId: bigint;
  /** 余弦距离(0=同向;召回侧只排不显,无需转相似度) */
  distance: number;
}

/** 余弦近邻(检索查询侧入口;HNSW 分部索引,恒带 entity_type 等值) */
export async function topVectorMatches(
  entityType: EmbedEntityType,
  vector: number[],
  limit: number,
): Promise<VectorMatch[]> {
  const vec = serializeVector(vector);
  const rows = await prisma.$queryRaw<{ entity_id: bigint; distance: number }[]>(
    Prisma.sql`SELECT entity_id, embedding <=> ${vec}::vector AS distance
      FROM search_embedding WHERE entity_type = ${entityType}
      ORDER BY embedding <=> ${vec}::vector LIMIT ${limit}`,
  );
  return rows.map((r) => ({ entityId: r.entity_id, distance: r.distance }));
}

/** 三域源文本拉取(只取所需列;已不可见的 id 自然缺位于 Map,调用方跳过) */
export async function fetchPostEmbedSources(ids: bigint[]): Promise<Map<bigint, PostEmbedSource>> {
  const rows = await prisma.post.findMany({
    where: { id: { in: ids }, status: "published" },
    select: { id: true, title: true, excerpt: true, contentMd: true },
  });
  return new Map(
    rows.map((r) => [r.id, { title: r.title, excerpt: r.excerpt, contentMd: r.contentMd }]),
  );
}

export async function fetchTelegramEmbedSources(
  ids: bigint[],
): Promise<Map<bigint, TelegramEmbedSource>> {
  const rows = await prisma.telegram.findMany({
    where: { id: { in: ids }, status: "visible" },
    select: { id: true, title: true, summary: true, aiSummary: true, aiTopic: true },
  });
  return new Map(
    rows.map((r) => [
      r.id,
      { title: r.title, summary: r.summary, aiSummary: r.aiSummary, aiTopic: r.aiTopic },
    ]),
  );
}

export async function fetchRepoEmbedSources(ids: bigint[]): Promise<Map<bigint, RepoEmbedSource>> {
  const rows = await prisma.githubRepo.findMany({
    where: { id: { in: ids.map(Number) }, display: true }, // repo.id Int,向量表侧 bigint
    select: { id: true, fullName: true, description: true, readmeMd: true },
  });
  return new Map(
    rows.map((r) => [
      BigInt(r.id),
      { fullName: r.fullName, description: r.description, readmeMd: r.readmeMd },
    ]),
  );
}
