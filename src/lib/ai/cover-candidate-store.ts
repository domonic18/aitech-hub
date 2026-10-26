/**
 * 封面 hold 候选临时仓(M31 agent 封面候选;M47 批D 自 cover-generate.ts 切出,
 * 拆文件守 350 行线):临时盘落盘/读取/清扫/存活批次查询。只落临时盘不进
 * 媒体库,候选经预览接口 + HITL 卡交管理员确认,adopt 时才 uploadMedia。
 * 兼容出口住 cover-generate.ts。
 */
import { mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import type { Dirent } from "node:fs";
import path from "node:path";

import { prisma } from "../db";
import { env } from "../env";
import { logger } from "../logger";
import { parsePostId } from "../content/posts-admin";

/** hold 候选虚拟路径前缀(candidate.mediaPath 以此开头 = 未入库临时件) */
export const COVER_TEMP_PREFIX = "/.cover-gen-tmp/";

function coverTempAbs(virtualPath: string): string {
  // 虚拟路径形如 /.cover-gen-tmp/<token>/<file>;盘上 = $MEDIA_DIR 同构相对
  return path.resolve(env.MEDIA_DIR, virtualPath.slice(1));
}

/** hold 候选落盘(worker 消费):写 $MEDIA_DIR/.cover-gen-tmp/<token>/,返回虚拟路径 */
export async function writeHoldCandidate(
  token: string,
  index: number,
  bytes: Uint8Array,
  mime: string,
): Promise<string> {
  const ext = mime === "image/png" ? "png" : mime === "image/jpeg" ? "jpg" : "webp";
  const name = `candidate-${index + 1}.${ext}`;
  const dir = coverTempAbs(`${COVER_TEMP_PREFIX}${token}`);
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, name), bytes);
  return `${COVER_TEMP_PREFIX}${token}/${name}`;
}

/** 读 hold 候选字节(preview 路由 / adopt 消费;越界路径防御性拒读) */
export async function readHoldCandidate(virtualPath: string): Promise<Uint8Array | null> {
  if (!virtualPath.startsWith(COVER_TEMP_PREFIX)) return null;
  const abs = path.resolve(coverTempAbs(virtualPath));
  if (!abs.startsWith(path.resolve(env.MEDIA_DIR, COVER_TEMP_PREFIX.slice(1)))) return null;
  try {
    return await readFile(abs);
  } catch {
    return null;
  }
}

/** 清空一批 hold 候选(整批放弃/入库完成后调用;目录不存在静默) */
export async function deleteCoverTemp(token: string): Promise<void> {
  await rm(coverTempAbs(`${COVER_TEMP_PREFIX}${token}`), { recursive: true, force: true });
}

/** hold 候选保留期:交互流(生成→确认)分钟级完成,24h 已足够宽 */
export const COVER_TEMP_MAX_AGE_MS = 24 * 60 * 60 * 1000;

/**
 * 定时清扫 hold 候选孤儿目录(技术债批①):悬空中断/被顶替的 run 无人
 * adopt/discard,临时盘只增不减;逐 token 目录按 mtime 判陈旧,超龄整目录
 * 删除。清扫后迟到的 adopt 报「候选临时文件已失效,请重新生成」(人话已有)。
 * 临时根不存在 = 从无临时件,静默零清扫;单目录失败计 failed 不废整轮。
 */
export async function sweepStaleCoverTemp(
  maxAgeMs = COVER_TEMP_MAX_AGE_MS,
): Promise<{ removed: number; failed: number }> {
  const root = path.resolve(env.MEDIA_DIR, COVER_TEMP_PREFIX.slice(1));
  let entries: Dirent[];
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch {
    return { removed: 0, failed: 0 };
  }
  const cutoff = Date.now() - maxAgeMs;
  let removed = 0;
  let failed = 0;
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const abs = path.join(root, entry.name);
    try {
      const st = await stat(abs);
      if (st.mtimeMs > cutoff) continue;
      await rm(abs, { recursive: true, force: true });
      removed += 1;
    } catch {
      failed += 1;
    }
  }
  if (removed > 0 || failed > 0) {
    logger.info({ event: "cover.temp_swept", removed, failed, maxAgeMs });
  }
  return { removed, failed };
}

/**
 * 取该文仍存活的 hold 候选批次(工具体 resume 重放防重消费,2026-10-16 反馈
 * 问题一):mediaPath 以临时前缀开头且临时文件仍在(adopt 切正式路径、discard
 * /清扫删文件,悬空行不误判);只看近 30 分钟交互窗口,更老的孤儿不拦新一次
 * 生成。按 id 升序保持候选展示序,token 取首行(同批)。
 */
export async function listHeldCandidatesForPost(
  postId: string,
): Promise<Array<{ id: string; token: string; mediaPath: string }>> {
  const id = parsePostId(postId);
  if (id === null) return [];
  const rows = await prisma.coverCandidate.findMany({
    where: {
      postId: id,
      mediaPath: { startsWith: COVER_TEMP_PREFIX },
      createdAt: { gte: new Date(Date.now() - 30 * 60 * 1000) },
    },
    orderBy: { id: "asc" },
    select: { id: true, token: true, mediaPath: true },
  });
  const alive: Array<{ id: string; token: string; mediaPath: string }> = [];
  for (const r of rows) {
    if ((await readHoldCandidate(r.mediaPath)) !== null) {
      alive.push({ id: r.id.toString(), token: r.token, mediaPath: r.mediaPath });
    }
  }
  return alive;
}
