/**
 * 用户管理读侧 + 状态写侧(M5-c):296 老用户全量迁移自 WP,管理动作仅
 * 禁用/启用两态(待绑定 pending_binding 不可手动设置)。禁用即吊销该用户
 * 全部 PAT(Bearer 立即 401);会话无 user→jti 索引不补登出(注记三期)。
 */
import { ADMIN_ROLE } from "@/lib/auth/constants";
import { prisma } from "@/lib/db";
import { logger } from "@/lib/logger";

import {
  USER_STATUS_ACTIVE,
  USER_STATUS_DISABLED,
  USER_STATUS_PENDING_BINDING,
  type UserMutableStatus,
} from "./user-status";

export const USERS_PAGE_SIZE = 15;

/** 四分段(原型 admin-users):全部 / active / pending_binding / 已禁用 */
export const USER_LIST_SEGMENTS = [
  "all",
  USER_STATUS_ACTIVE,
  USER_STATUS_PENDING_BINDING,
  USER_STATUS_DISABLED,
] as const;
export type UserListSegment = (typeof USER_LIST_SEGMENTS)[number];

/** 业务错误 → Handler 按码映射 HTTP 状态,不裸抛 */
export type UserAdminErrorCode = "not_found";

export class UserAdminError extends Error {
  constructor(
    public code: UserAdminErrorCode,
    message: string,
  ) {
    super(message);
  }
}

export interface AdminUserListQuery {
  page: number;
  segment: UserListSegment;
  q?: string;
}

const USER_LIST_SELECT = {
  id: true,
  phone: true,
  email: true,
  nickname: true,
  avatarPath: true,
  role: true,
  status: true,
  createdAt: true,
} as const;

export type AdminUserRow = {
  id: string;
  phone: string | null;
  email: string | null;
  nickname: string | null;
  avatarPath: string | null;
  role: string;
  status: string;
  createdAt: Date;
};

function segmentWhere(segment: UserListSegment, q?: string) {
  const text = q
    ? {
        OR: [
          { nickname: { contains: q } },
          { phone: { contains: q } },
          { legacyUsername: { contains: q } },
        ],
      }
    : {};
  if (segment === USER_STATUS_ACTIVE) return { ...text, status: USER_STATUS_ACTIVE };
  if (segment === USER_STATUS_PENDING_BINDING)
    return { ...text, status: USER_STATUS_PENDING_BINDING };
  if (segment === USER_STATUS_DISABLED) return { ...text, status: USER_STATUS_DISABLED };
  return text;
}

/** 用户列表 + 四分段计数(同 listPostsAdmin 模式);新注册优先 */
export async function listUsersAdmin({ page, segment, q }: AdminUserListQuery) {
  const where = segmentWhere(segment, q);
  const countWhere = (seg: UserListSegment) => segmentWhere(seg, q);
  const [items, all, active, pendingBinding, disabled] = await prisma.$transaction([
    prisma.userAccount.findMany({
      where,
      select: USER_LIST_SELECT,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      skip: (page - 1) * USERS_PAGE_SIZE,
      take: USERS_PAGE_SIZE,
    }),
    prisma.userAccount.count({ where: countWhere("all") }),
    prisma.userAccount.count({ where: countWhere(USER_STATUS_ACTIVE) }),
    prisma.userAccount.count({ where: countWhere(USER_STATUS_PENDING_BINDING) }),
    prisma.userAccount.count({ where: countWhere(USER_STATUS_DISABLED) }),
  ]);
  return {
    items: items.map((r): AdminUserRow => ({
      id: r.id.toString(),
      phone: r.phone,
      email: r.email,
      nickname: r.nickname,
      avatarPath: r.avatarPath,
      role: r.role,
      status: r.status,
      createdAt: r.createdAt,
    })),
    total: all,
    counts: { all, active, pending_binding: pendingBinding, disabled },
    page,
    segment,
  };
}

/**
 * 状态变更(active|disabled;不能改自己由路由层守卫):
 * 禁用即吊销该用户全部生效中 PAT,持有客户端下一次请求即 401。
 */
export async function setUserStatus(
  id: bigint,
  status: UserMutableStatus,
): Promise<{ status: string; revokedPats: number }> {
  const user = await prisma.userAccount.findUnique({ where: { id }, select: { id: true } });
  if (!user) throw new UserAdminError("not_found", "用户不存在");
  const updated = await prisma.userAccount.update({
    where: { id },
    data: { status },
    select: { status: true, role: true },
  });
  let revokedPats = 0;
  if (status === USER_STATUS_DISABLED) {
    const r = await prisma.userPat.updateMany({
      where: { userId: id, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    revokedPats = r.count;
  }
  logger.info({
    event: "user.status_changed",
    userId: id.toString(),
    role: updated.role,
    isAdmin: updated.role === ADMIN_ROLE,
    status,
    revokedPats,
  });
  return { status: updated.status, revokedPats };
}
