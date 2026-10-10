/**
 * 反馈管理读侧 + 流转写侧(M22 批①,仿 admin-users 模式):列表按状态分段
 * (原型 tab 惯例)+ 关键词搜索 + 分页;写侧仅 status/adminNote 流转,无删除
 * (反馈是用户声音留档,与 pay_notify_log 同纪律)。归属列(userId/visitorId)
 * 均无 FK,展示侧空值兜底——账号删除/游客过期不影响留档可读。
 */
import { prisma } from "@/lib/db";
import { logger } from "@/lib/logger";

import { FEEDBACK_STATUSES, FEEDBACK_STATUS_LABELS, type FeedbackStatus } from "./feedback-schema";

export const FEEDBACK_PAGE_SIZE = 15;

/** 分段(原型 admin tab 惯例):全部 + 三状态 */
export const FEEDBACK_LIST_SEGMENTS = ["all", ...FEEDBACK_STATUSES] as const;
export type FeedbackListSegment = (typeof FEEDBACK_LIST_SEGMENTS)[number];

/** 业务错误 → Handler 按码映射 HTTP 状态,不裸抛(UserAdminError 同款) */
export type FeedbackAdminErrorCode = "not_found";

export class FeedbackAdminError extends Error {
  constructor(
    public code: FeedbackAdminErrorCode,
    message: string,
  ) {
    super(message);
  }
}

export interface FeedbackListQuery {
  page: number;
  segment: FeedbackListSegment;
  q?: string;
}

const FEEDBACK_LIST_SELECT = {
  id: true,
  userId: true,
  visitorId: true,
  category: true,
  content: true,
  contact: true,
  status: true,
  adminNote: true,
  sessionId: true,
  createdAt: true,
  updatedAt: true,
} as const;

export interface AdminFeedbackRow {
  id: string;
  userId: string | null;
  visitorId: string | null;
  category: string;
  content: string;
  contact: string | null;
  status: string;
  adminNote: string | null;
  sessionId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

function segmentWhere(segment: FeedbackListSegment, q?: string) {
  const text = q
    ? {
        OR: [
          { content: { contains: q } },
          { contact: { contains: q } },
          { visitorId: { contains: q } },
        ],
      }
    : {};
  if (segment === "all") return text;
  return { ...text, status: segment };
}

/** 反馈列表 + 分段计数(listUsersAdmin 同模式);新反馈优先 */
export async function listFeedbackAdmin({ page, segment, q }: FeedbackListQuery) {
  const where = segmentWhere(segment, q);
  const countWhere = (seg: FeedbackListSegment) => segmentWhere(seg, q);
  const [items, all, open, processing, resolved] = await prisma.$transaction([
    prisma.feedback.findMany({
      where,
      select: FEEDBACK_LIST_SELECT,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      skip: (page - 1) * FEEDBACK_PAGE_SIZE,
      take: FEEDBACK_PAGE_SIZE,
    }),
    prisma.feedback.count({ where: countWhere("all") }),
    prisma.feedback.count({ where: countWhere("open") }),
    prisma.feedback.count({ where: countWhere("processing") }),
    prisma.feedback.count({ where: countWhere("resolved") }),
  ]);
  const rows: AdminFeedbackRow[] = items.map((r) => ({
    id: r.id.toString(),
    userId: r.userId?.toString() ?? null,
    visitorId: r.visitorId,
    category: r.category,
    content: r.content,
    contact: r.contact,
    status: r.status,
    adminNote: r.adminNote,
    sessionId: r.sessionId,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  }));
  return {
    items: rows,
    total: all,
    counts: { all, open, processing, resolved },
    page,
    segment,
  };
}

/**
 * 流转变更(status + 处理备注,一次整行覆盖);不存在的 id 报 not_found。
 * 状态机 open → processing → resolved 由 zod 值域约束,无向序校验(admin
 * 可回退重开,与 pay 后台手工口径一致)。
 */
export async function updateFeedbackStatus(
  id: bigint,
  status: FeedbackStatus,
  adminNote?: string,
): Promise<AdminFeedbackRow> {
  const updated = await prisma.feedback.update({
    where: { id },
    data: { status, ...(adminNote === undefined ? {} : { adminNote }) },
    select: FEEDBACK_LIST_SELECT,
  });
  logger.info({
    event: "feedback.status_changed",
    feedbackId: id.toString(),
    status,
    label: FEEDBACK_STATUS_LABELS[status],
  });
  return {
    id: updated.id.toString(),
    userId: updated.userId?.toString() ?? null,
    visitorId: updated.visitorId,
    category: updated.category,
    content: updated.content,
    contact: updated.contact,
    status: updated.status,
    adminNote: updated.adminNote,
    sessionId: updated.sessionId,
    createdAt: updated.createdAt,
    updatedAt: updated.updatedAt,
  };
}

/** 流转前存在性检查(update 不命中时 prisma 抛 P2025,统一转业务错误) */
export async function requireFeedback(id: bigint): Promise<void> {
  const hit = await prisma.feedback.findUnique({ where: { id }, select: { id: true } });
  if (!hit) throw new FeedbackAdminError("not_found", "反馈不存在");
}
