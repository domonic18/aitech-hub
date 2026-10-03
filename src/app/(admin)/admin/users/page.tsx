/**
 * 用户管理页(M5-c;原型 admin-users.html):四分段 + 搜索 + 分页,整页服务端
 * 渲染;行内操作唯一(禁用/启用),当前登录行不提供操作。列定稿砍原型的
 * 「评论/最近登录/批量勾选」(无采集来源,注记页脚);手机号按掩码展示。
 */
import Link from "next/link";

import { requireAdminPage } from "@/lib/auth/guard";
import { maskPhone } from "@/lib/auth/mask";
import { formatCnDateTime } from "@/lib/datetime";
import {
  USER_LIST_SEGMENTS,
  USERS_PAGE_SIZE,
  listUsersAdmin,
  type UserListSegment,
} from "@/lib/users/admin-users";

import UserStatusButton from "@/components/admin/UserStatusButton";

export const dynamic = "force-dynamic";

const SEG_LABELS: Record<UserListSegment, string> = {
  all: "全部",
  active: "active",
  pending_binding: "待绑定",
  disabled: "已禁用",
};

interface PageProps {
  searchParams: Promise<{ status?: string; page?: string; q?: string }>;
}

function parseSegment(raw: string | undefined): UserListSegment {
  return (USER_LIST_SEGMENTS as readonly string[]).includes(raw ?? "")
    ? (raw as UserListSegment)
    : "all";
}

function parsePage(raw: string | undefined): number {
  const n = Number.parseInt(raw ?? "1", 10);
  return Number.isInteger(n) && n >= 1 ? n : 1;
}

function listHref(segment: UserListSegment, page: number, q?: string): string {
  const params = new URLSearchParams();
  if (segment !== "all") params.set("status", segment);
  if (q) params.set("q", q);
  if (page > 1) params.set("page", String(page));
  const qs = params.toString();
  return qs ? `/admin/users/?${qs}` : "/admin/users/";
}

/** 页码窗口(当前页居中,首尾恒在;null = 省略号) */
function pageWindow(cur: number, total: number): Array<number | null> {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
  const pages = new Set([1, total, cur - 1, cur, cur + 1].filter((p) => p >= 1 && p <= total));
  const sorted = [...pages].sort((a, b) => a - b);
  const out: Array<number | null> = [];
  let prev = 0;
  for (const p of sorted) {
    if (p - prev > 1) out.push(null);
    out.push(p);
    prev = p;
  }
  return out;
}

function StatusBadge({ status }: { status: string }) {
  if (status === "active") {
    return (
      <span className="rounded-sm bg-green/10 px-1.5 py-px text-[10px] text-green">active</span>
    );
  }
  if (status === "pending_binding") {
    return (
      <span className="rounded-sm bg-amber/10 px-1.5 py-px text-[10px] text-amber">待绑定</span>
    );
  }
  return <span className="rounded-sm bg-panel-2 px-1.5 py-px text-[10px] text-text-3">已禁用</span>;
}

export default async function AdminUsersPage({
  searchParams,
}: PageProps): Promise<React.ReactElement> {
  const claims = await requireAdminPage();
  const sp = await searchParams;
  const segment = parseSegment(sp.status);
  const page = parsePage(sp.page);
  const q = sp.q?.trim() || undefined;

  const { items, total, counts } = await listUsersAdmin({ page, segment, q });
  const totalPages = Math.max(1, Math.ceil(total / USERS_PAGE_SIZE));
  const pgBtn =
    "rounded-sm border border-line bg-panel px-2.5 py-1 font-mono text-xs text-text-2 hover:border-line-hover hover:text-text-1";

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h2 className="text-base font-semibold">用户管理</h2>
        <p className="mt-0.5 text-xs text-text-3">旧站用户全量迁移;管理动作仅禁用/启用两态。</p>
      </div>

      <div className="flex items-center gap-2 rounded-sm border border-accent/35 bg-accent-dim px-3 py-2 text-xs text-accent">
        <svg className="ic ic-sm shrink-0" aria-hidden="true">
          <use href="#i-warning" />
        </svg>
        <span>
          旧站 <b>{counts.all}</b> 位用户已全量迁移:<b>{counts.active}</b> active 可直接短信登录 ·{" "}
          <b>{counts.pending_binding}</b> pending_binding 首次登录需绑定手机号后转
          active。旧密码(phpass)未迁移,仅审计字段保留。
        </span>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <div className="flex overflow-hidden rounded-sm border border-line">
          {USER_LIST_SEGMENTS.map((seg) => (
            <Link
              key={seg}
              href={listHref(seg, 1, q)}
              className={`border-r border-line px-4 py-2 text-[13px] last:border-r-0 ${
                seg === segment
                  ? "bg-accent-dim font-semibold text-accent"
                  : "bg-panel text-text-2 hover:bg-panel-2"
              }`}
            >
              {SEG_LABELS[seg]} {counts[seg]}
            </Link>
          ))}
        </div>
        <form
          method="GET"
          action="/admin/users/"
          className="ml-auto flex items-center gap-2 rounded-sm border border-line bg-panel px-2.5 py-1.5 focus-within:border-accent"
        >
          <input type="hidden" name="status" value={segment} />
          <svg className="ic ic-sm text-text-3" aria-hidden="true">
            <use href="#i-search" />
          </svg>
          <input
            name="q"
            defaultValue={q ?? ""}
            placeholder="搜索昵称 / 手机号 / 旧站用户名…"
            className="w-56 bg-transparent text-[13px] outline-none placeholder:text-text-3"
          />
        </form>
      </div>

      <div className="overflow-hidden rounded-md border border-line bg-panel">
        <table className="w-full text-left text-[13px]">
          <thead>
            <tr className="border-b border-line text-xs text-text-3">
              <th className="px-4 py-2.5 font-medium">用户</th>
              <th className="px-3 py-2.5 font-medium">角色</th>
              <th className="px-3 py-2.5 font-medium">状态</th>
              <th className="px-3 py-2.5 font-medium">注册时间</th>
              <th className="px-4 py-2.5 text-right font-medium">操作</th>
            </tr>
          </thead>
          <tbody>
            {items.map((u) => {
              const self = u.id === claims.sub;
              return (
                <tr
                  key={u.id}
                  className={`border-b border-line last:border-b-0 hover:bg-panel-2 ${
                    u.status === "disabled" ? "opacity-70" : ""
                  }`}
                >
                  <td className="px-4 py-2.5">
                    <div className="flex items-center gap-3">
                      {u.avatarPath ? (
                        // eslint-disable-next-line @next/next/no-img-element -- 管理端内部头像,src 为站内动态路径
                        <img
                          src={u.avatarPath}
                          alt=""
                          className="h-9 w-9 rounded-full border border-line object-cover"
                        />
                      ) : (
                        <span className="flex h-9 w-9 items-center justify-center rounded-full border border-line bg-panel-2 text-sm text-text-3">
                          {(u.nickname ?? "?").slice(0, 1)}
                        </span>
                      )}
                      <div>
                        <div className="font-medium text-text-1">{u.nickname ?? "未命名"}</div>
                        <div className="mt-0.5 font-mono text-[11px] text-text-3">
                          {maskPhone(u.phone)} · uid {u.id}
                        </div>
                      </div>
                    </div>
                  </td>
                  <td className="px-3 py-2.5">
                    {u.role === "admin" ? (
                      <span className="rounded-sm bg-accent-dim px-1.5 py-0.5 font-mono text-[11px] text-accent">
                        admin
                      </span>
                    ) : (
                      <span className="rounded-sm bg-panel-2 px-1.5 py-0.5 font-mono text-[11px] text-text-2">
                        user
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2.5">
                    <StatusBadge status={u.status} />
                  </td>
                  <td className="px-3 py-2.5 font-mono text-xs text-text-2">
                    {formatCnDateTime(u.createdAt)}
                  </td>
                  <td className="px-4 py-2.5 text-right">
                    {self ? (
                      <span className="font-mono text-[11px] text-text-3">当前登录</span>
                    ) : (
                      <UserStatusButton id={u.id} nickname={u.nickname} status={u.status} />
                    )}
                  </td>
                </tr>
              );
            })}
            {items.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-10 text-center text-xs text-text-3">
                  没有符合条件的用户
                </td>
              </tr>
            )}
          </tbody>
        </table>

        <div className="flex items-center justify-end gap-2 border-t border-line px-4 py-3">
          <span className="mr-auto text-xs text-text-3">
            共 {total.toLocaleString("en-US")} 位 · 第 {page} / {totalPages} 页
          </span>
          {page > 1 && (
            <Link href={listHref(segment, page - 1, q)} className={pgBtn} aria-label="上一页">
              ‹
            </Link>
          )}
          {pageWindow(page, totalPages).map((p, i) =>
            p === null ? (
              <span key={`gap-${i}`} className="text-xs text-text-3">
                …
              </span>
            ) : p === page ? (
              <span
                key={p}
                className="rounded-sm border border-accent bg-accent-dim px-2.5 py-1 font-mono text-xs font-semibold text-accent"
                aria-current="page"
              >
                {p}
              </span>
            ) : (
              <Link key={p} href={listHref(segment, p, q)} className={pgBtn}>
                {p}
              </Link>
            ),
          )}
          {page < totalPages && (
            <Link href={listHref(segment, page + 1, q)} className={pgBtn} aria-label="下一页">
              ›
            </Link>
          )}
        </div>
      </div>

      <p className="text-[11px] leading-relaxed text-text-3">
        说明:禁用即吊销该用户全部 PAT(持有客户端立即 401);会话侧无 user→jti 索引不强制登出
        (三期补)。API:GET /api/users?page=&amp;status= · PUT /api/users/[id]/status
        (不能变更当前登录账号)。
      </p>
    </div>
  );
}
