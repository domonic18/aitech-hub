/**
 * 屏蔽词管理(M7 批④,arch/02 §3.1):词表 CRUD + 启停。
 * 停用词只影响新条目准入;已在库条目不回溯改写(观测口径稳定)。
 */
import { z } from "zod";

import { isP2002, prisma } from "../db";
import { logger } from "../logger";
import { BLOCKLIST_SCOPES } from "./constants";

export const BlocklistAddSchema = z.object({
  word: z.string().trim().min(1).max(100),
  scope: z.enum(BLOCKLIST_SCOPES),
});
export type BlocklistAdd = z.infer<typeof BlocklistAddSchema>;

export type BlocklistAdminErrorCode = "exists" | "not_found";

export class BlocklistAdminError extends Error {
  constructor(
    public code: BlocklistAdminErrorCode,
    message: string,
  ) {
    super(message);
  }
}

/** 词表全量(个位数量级,不分页);命中计数供误杀观测 */
export async function listBlocklist() {
  return prisma.blocklist.findMany({ orderBy: [{ enabled: "desc" }, { id: "asc" }] });
}
export type BlocklistWordRow = Awaited<ReturnType<typeof listBlocklist>>[number];

export async function addBlocklistWord(input: BlocklistAdd): Promise<{ id: number }> {
  try {
    const created = await prisma.blocklist.create({ data: input, select: { id: true } });
    logger.info({ event: "blocklist.added", wordId: created.id, scope: input.scope });
    return created;
  } catch (e) {
    if (isP2002(e)) throw new BlocklistAdminError("exists", "该词已在屏蔽词表");
    throw e;
  }
}

export async function setBlocklistEnabled(id: number, enabled: boolean): Promise<void> {
  const row = await prisma.blocklist.findUnique({ where: { id }, select: { id: true } });
  if (!row) throw new BlocklistAdminError("not_found", "屏蔽词不存在");
  await prisma.blocklist.update({ where: { id }, data: { enabled } });
  logger.info({ event: "blocklist.enabled_changed", wordId: id, enabled });
}

export async function deleteBlocklistWord(id: number): Promise<void> {
  const row = await prisma.blocklist.findUnique({ where: { id }, select: { id: true } });
  if (!row) throw new BlocklistAdminError("not_found", "屏蔽词不存在");
  await prisma.blocklist.delete({ where: { id } });
  logger.info({ event: "blocklist.removed", wordId: id });
}
