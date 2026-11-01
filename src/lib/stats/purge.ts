/**
 * 统计明细保留清理(worker 日调度,M10 批⑥;2026-11-01 批D 自 service.ts 拆出)。
 * 只删保留窗口外的明细行,不碰聚合表;返回删除行数(0 不打日志,由 worker 汇总)。
 * 分批删除走 deleteBatchedWhere(M48 批F):prisma deleteMany 无 take,大窗口单条
 * 删除会在 statement_timeout=30s 下被掐死,而日清 job attempts=1 当日不重试。
 */
import { deleteBatchedWhere, prisma } from "@/lib/db";
import { DAY_MS } from "@/lib/datetime";

/** 明细保留天数(2026-10-04 用户定调:全量 IP + 7 天短留存) */
const VISIT_LOG_RETENTION_DAYS = 7;

/** 清理保留窗口外的访问明细;返回删除行数 */
export async function purgeVisitLogs(): Promise<number> {
  const cutoff = new Date(Date.now() - VISIT_LOG_RETENTION_DAYS * DAY_MS);
  return deleteBatchedWhere(prisma.statsVisitLog, { createdAt: { lt: cutoff } });
}

/** 搜索词明细保留天数(无 PII,比访问明细长;排行「全部」窗口的实际上界) */
const SEARCH_LOG_RETENTION_DAYS = 180;

/** 清理保留窗口外的搜索词明细;返回删除行数 */
export async function purgeSearchLogs(): Promise<number> {
  const cutoff = new Date(Date.now() - SEARCH_LOG_RETENTION_DAYS * DAY_MS);
  return deleteBatchedWhere(prisma.statsSearchLog, { createdAt: { lt: cutoff } });
}
