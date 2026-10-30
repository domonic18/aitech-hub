/**
 * 洞察信号向量仓(M34 批②):insight_signal.embedding 列唯一读写出口。
 * 向量列是 pgvector 自定义类型(Prisma Unsupported)——读写一律 raw SQL
 * (search/embedding-repo 同款取向)。回填态=embedding IS NULL;归簇态=
 * 已嵌向量且无 member 行。
 */
import { Prisma } from "@prisma/client";

import { prisma } from "../db";
import { EMBEDDING_DIMS, serializeVector } from "../search/embedding";

/** 待回填信号(先到先嵌,id 即时间序;归一文本即向量输入,2000 字符留足余量)。
 * M58 批①:pending 译文未落定前不进 embedding——译文完成后 normalized_text 顶替
 * 并保持 embedding NULL,自然进入下一轮(幂等重嵌,不重复计费) */
export async function findUnembeddedSignals(
  limit: number,
): Promise<{ id: bigint; normalizedText: string }[]> {
  return prisma.$queryRaw<{ id: bigint; normalizedText: string }[]>`
    SELECT id, normalized_text AS "normalizedText"
      FROM insight_signal
     WHERE embedding IS NULL
       AND translation_status IN ('none', 'done', 'failed')
     ORDER BY id
     LIMIT ${limit}`;
}

/** 批量回填(参数化 ::vector;分片控制单语句参数量) */
export async function saveSignalEmbeddings(
  rows: { id: bigint; vector: number[] }[],
): Promise<void> {
  const CHUNK = 25;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const slice = rows.slice(i, i + CHUNK);
    const values = slice.map(
      (r) => Prisma.sql`(${r.id}::bigint, ${serializeVector(r.vector)}::vector)`,
    );
    await prisma.$executeRaw`
      UPDATE insight_signal s SET embedding = v.vec
        FROM (VALUES ${Prisma.join(values)}) AS v(id, vec)
       WHERE s.id = v.id`;
  }
}

/** 已嵌向量且未归簇的信号(聚类工作集;向量随行带出避免逐信号 N+1 查询。
 * 过短文本不入簇,长度阈值参数化传入;只取在役源——停接源(批③ 渠道转向)
 * 存量行不参与新簇) */
export async function findUnclusteredSignals(
  limit: number,
  minTextLen: number,
  enabledSources: readonly string[],
): Promise<
  {
    id: bigint;
    source: string;
    medium: string;
    domain: string;
    region: string | null;
    normalizedText: string;
    vector: number[];
  }[]
> {
  const rows = await prisma.$queryRaw<
    {
      id: bigint;
      source: string;
      medium: string;
      domain: string;
      region: string | null;
      normalizedText: string;
      vec: string;
    }[]
  >`
    SELECT s.id, s.source, s.medium, s.domain, s.region, s.normalized_text AS "normalizedText",
           s.embedding::text AS vec
      FROM insight_signal s
     WHERE s.embedding IS NOT NULL
       AND s.source IN (${Prisma.join(enabledSources)})
       AND char_length(s.normalized_text) >= ${minTextLen}
       AND NOT EXISTS (SELECT 1 FROM insight_cluster_member m WHERE m.signal_id = s.id)
     ORDER BY s.id
     LIMIT ${limit}`;
  return rows.map((r) => ({
    id: r.id,
    source: r.source,
    medium: r.medium,
    domain: r.domain,
    region: r.region,
    normalizedText: r.normalizedText,
    vector: r.vec
      .slice(1, -1)
      .split(",")
      .map((x) => Number(x)),
  }));
}

export interface ClusterNearMatch {
  clusterId: bigint;
  /** 成员向量与候选信号的余弦距离最小值(0=同向) */
  distance: number;
}

/** 既有簇近邻(按成员向量聚合取每簇最小距离;domain 等值过滤不混簇)。
 * kind 不再分池(批③ 验收三轮·痛点扩围):热点/痛点由簇内容语义决定,归簇
 * 只看语义距离,kind 判定移交 LLM 打标(label.ts)。现规模(数千信号)逐信号
 * 查询可承受;批③④ 外部源洪峰前如成瓶颈,再上簇质心表 + HNSW 分层(此注释
 * 即扩容锚)。 */
export async function nearestClustersByMembers(
  vector: number[],
  domain: string,
  limit = 5,
): Promise<ClusterNearMatch[]> {
  const vec = serializeVector(vector);
  const rows = await prisma.$queryRaw<{ cluster_id: bigint; distance: number }[]>`
    SELECT c.id AS cluster_id, n.distance
      FROM insight_cluster c
      JOIN (
        SELECT m.cluster_id, min(s.embedding <=> ${vec}::vector) AS distance
          FROM insight_cluster_member m
          JOIN insight_signal s ON s.id = m.signal_id
         WHERE s.embedding IS NOT NULL
         GROUP BY m.cluster_id
      ) n ON n.cluster_id = c.id
     WHERE c.domain = ${domain}::varchar
     ORDER BY n.distance
     LIMIT ${limit}`;
  return rows.map((r) => ({ clusterId: r.cluster_id, distance: r.distance }));
}

/** 簇质心(成员向量均值;pgvector avg 聚合;全成员未嵌返回 null)。
 * 覆盖度匹配的查询向量用质心而非 LLM 文本再嵌——零额外 embedding 调用 */
export async function getClusterCentroid(clusterId: bigint): Promise<number[] | null> {
  const rows = await prisma.$queryRaw<{ vec: string | null }[]>`
    SELECT avg(s.embedding)::text AS vec
      FROM insight_cluster_member m
      JOIN insight_signal s ON s.id = m.signal_id
     WHERE m.cluster_id = ${clusterId} AND s.embedding IS NOT NULL`;
  const raw = rows[0]?.vec;
  if (raw === null || raw === undefined || raw === "") return null;
  const v = raw
    .slice(1, -1)
    .split(",")
    .map((x) => Number(x));
  return v.length === EMBEDDING_DIMS ? v : null;
}
