/**
 * 领域词表读/写侧(M54 批A):领域/子域两层 taxonomy——分类器(Jev Choice)
 * 输出的合法键域与呈现层领域 chips 的唯一真相源。key=稳定标识(禁改);
 * 删除有在用守卫(信号/簇引用中禁删);CRUD 走 /api/insight/taxonomy(会话)。
 */
import { prisma } from "../db";

export type TaxonomyKind = "domain" | "subdomain";

export interface TaxonomyRow {
  id: number;
  kind: TaxonomyKind;
  key: string;
  label: string;
  parent: string | null;
  enabled: boolean;
  sortOrder: number;
}

/** 分类器输出键的合法形态(小写字母开头,小写字母/数字/连字符) */
const KEY_RE = /^[a-z][a-z0-9-]{1,28}$/;

export function isValidTaxonomyKey(key: string): boolean {
  return KEY_RE.test(key);
}

/** 子域 parent 必须是已存在的 domain 行;domain 行禁带 parent */
export async function validateParent(
  kind: TaxonomyKind,
  parent: string | null | undefined,
): Promise<string | null> {
  if (kind === "domain") return parent ? "domain 行不能带 parent" : null;
  if (!parent) return "subdomain 行必须指定所属领域(parent)";
  const row = await prisma.insightTaxonomy.findFirst({
    where: { key: parent, kind: "domain" },
    select: { key: true },
  });
  return row ? null : `parent 领域不存在:${parent}`;
}

export async function listTaxonomy(enabledOnly = false): Promise<TaxonomyRow[]> {
  const rows = await prisma.insightTaxonomy.findMany({
    where: enabledOnly ? { enabled: true } : undefined,
    orderBy: [{ kind: "desc" }, { sortOrder: "asc" }, { key: "asc" }], // domain 段在前
  });
  return rows.map((r) => ({
    id: r.id,
    kind: r.kind as TaxonomyKind,
    key: r.key,
    label: r.label,
    parent: r.parent,
    enabled: r.enabled,
    sortOrder: r.sortOrder,
  }));
}

/** 启用领域键集(分类器 Choice 的合法选项域) */
export async function listEnabledDomainKeys(): Promise<string[]> {
  const rows = await prisma.insightTaxonomy.findMany({
    where: { kind: "domain", enabled: true },
    select: { key: true },
    orderBy: { sortOrder: "asc" },
  });
  return rows.map((r) => r.key);
}

/** 启用子域键集(指定领域下;分类器第二问的合法选项域) */
export async function listEnabledSubdomainKeys(domain: string): Promise<string[]> {
  const rows = await prisma.insightTaxonomy.findMany({
    where: { kind: "subdomain", parent: domain, enabled: true },
    select: { key: true },
    orderBy: { sortOrder: "asc" },
  });
  return rows.map((r) => r.key);
}

export interface TaxonomyCreateInput {
  kind: TaxonomyKind;
  key: string;
  label: string;
  parent?: string | null;
  enabled?: boolean;
  sortOrder?: number;
}

export async function createTaxonomy(input: TaxonomyCreateInput): Promise<TaxonomyRow> {
  if (!isValidTaxonomyKey(input.key)) {
    throw new Error(`key 不合法(须为小写字母开头,2-29 位小写字母/数字/连字符):${input.key}`);
  }
  const parentErr = await validateParent(input.kind, input.parent ?? null);
  if (parentErr) throw new Error(parentErr);
  const row = await prisma.insightTaxonomy.create({
    data: {
      kind: input.kind,
      key: input.key,
      label: input.label,
      parent: input.kind === "subdomain" ? (input.parent ?? null) : null,
      enabled: input.enabled ?? true,
      sortOrder: input.sortOrder ?? 0,
    },
  });
  return { ...row, kind: row.kind as TaxonomyKind };
}

export interface TaxonomyUpdateInput {
  label?: string;
  parent?: string;
  enabled?: boolean;
  sortOrder?: number;
}

/** 更新(label/排序/启停/子域 parent 可改;key 禁改)。停用时不清存量数据
 * (信号/簇引用保留,仅不参与分类与筛选)。 */
export async function updateTaxonomy(
  id: number,
  input: TaxonomyUpdateInput,
): Promise<TaxonomyRow | null> {
  const row = await prisma.insightTaxonomy.findUnique({ where: { id } });
  if (!row) return null;
  if (input.parent !== undefined && row.kind === "subdomain") {
    const err = await validateParent("subdomain", input.parent);
    if (err) throw new Error(err);
  }
  const updated = await prisma.insightTaxonomy.update({
    where: { id },
    data: {
      ...(input.label !== undefined ? { label: input.label } : {}),
      ...(input.enabled !== undefined ? { enabled: input.enabled } : {}),
      ...(input.sortOrder !== undefined ? { sortOrder: input.sortOrder } : {}),
      ...(input.parent !== undefined && row.kind === "subdomain" ? { parent: input.parent } : {}),
    },
  });
  return { ...updated, kind: updated.kind as TaxonomyKind };
}

/** 删除(在用守卫:有信号或簇引用 → 抛错;建议用 enabled=false 停用替代) */
export async function deleteTaxonomy(id: number): Promise<void> {
  const row = await prisma.insightTaxonomy.findUnique({ where: { id } });
  if (!row) throw new Error("词表行不存在");
  if (row.kind === "domain") {
    const usedBySub = await prisma.insightTaxonomy.count({ where: { parent: row.key } });
    if (usedBySub > 0) throw new Error(`领域「${row.label}」下有 ${usedBySub} 个子域,先处理子域`);
  }
  const usedBySignal = await prisma.insightSignal.count({
    where: row.kind === "domain" ? { domain: row.key } : { subdomain: row.key },
  });
  const usedByCluster = await prisma.insightCluster.count({
    where: { domain: row.key },
  });
  if (usedBySignal + usedByCluster > 0) {
    throw new Error(
      `词表行被 ${usedBySignal + usedByCluster} 条信号/簇引用,请用「停用」替代删除(存量行保留)`,
    );
  }
  await prisma.insightTaxonomy.delete({ where: { id } });
}
