/**
 * 公众号会话列表(M66):认证订阅号只走 5s 被动回复,所有私信落
 * channel_wechat_mp_user/message;本页是运营唯一处置入口——未处理线索
 * 优先、可直接进会话时间轴。分段 + 搜索 + 分页(users/feedback 同模式)。
 */
import Link from "next/link";

import AdminPagination from "@/components/admin/AdminPagination";
import { adminListHref, parseListSegment, parsePage } from "@/lib/admin/list";
import { requireAdminPage } from "@/lib/auth/guard";
import {
  listSessionsAdmin,
  SESSION_PAGE_SIZE,
  type SessionStatus,
} from "@/lib/channel/wechat-mp/admin";
import { formatCnDateTime } from "@/lib/datetime";

export const dynamic = "force-dynamic";

const SEGMENTS = ["all", "pending", "bound", "unsubscribed"] as const;

const SEG_LABELS: Record<SessionStatus, string> = {
  all: "全部",
  pending: "待处理",
  bound: "已绑定",
  unsubscribed: "已取关",
};

const REPLY_KIND_LABELS: Record<string, string> = {
  welcome: "欢迎语",
  keyword: "关键词",
  rag: "AI 答案",
  timeout: "超时回执",
  continue: "续读",
  handoff: "转人工",
  manual: "人工答复",
  fallback: "无命中",
  help: "帮助",
  blocked: "已拦截",
  bind: "绑定",
  unsupported: "不支持类型",
};

interface PageProps {
  searchParams: Promise<{ status?: string; page?: string; q?: string }>;
}

/** 列表时间统一按库里的 ISO 字符串渲染(空值回 —) */
function fmtIso(iso: string | null): string {
  return iso ? formatCnDateTime(new Date(iso)) : "—";
}

function listHref(segment: SessionStatus, page: number, q?: string): string {
  return adminListHref("/admin/wechat-mp/", {
    status: segment === "all" ? undefined : segment,
    page,
    q,
  });
}

export default async function AdminWechatMpPage({
  searchParams,
}: PageProps): Promise<React.ReactElement> {
  await requireAdminPage();
  const sp = await searchParams;
  const segment = parseListSegment(SEGMENTS, sp.status, "all");
  const page = parsePage(sp.page);
  const q = sp.q?.trim() || undefined;

  const { items, total } = await listSessionsAdmin({ page, q, status: segment });
  const totalPages = Math.max(1, Math.ceil(total / SESSION_PAGE_SIZE));

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h2 className="text-base font-semibold">公众号会话</h2>
        <p className="mt-0.5 text-xs text-text-3">
          公众号私信 → 站内检索 + LLM 答案(5 秒被动回复窗口);点进单会话可看完整时间轴、
          处置转人工线索。消息明细保留 180 天(渠道用户与线索不动)。
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <div className="flex overflow-hidden rounded-sm border border-line">
          {SEGMENTS.map((seg) => (
            <Link
              key={seg}
              href={listHref(seg, 1, q)}
              className={`border-r border-line px-4 py-2 text-[13px] last:border-r-0 ${
                seg === segment
                  ? "bg-accent-dim font-semibold text-accent"
                  : "bg-panel text-text-2 hover:bg-panel-2"
              }`}
            >
              {SEG_LABELS[seg]}
            </Link>
          ))}
        </div>
        <form
          method="GET"
          action="/admin/wechat-mp/"
          className="ml-auto flex w-full items-center gap-2 rounded-sm border border-line bg-panel px-2.5 py-1.5 focus-within:border-accent sm:w-auto"
        >
          <input type="hidden" name="status" value={segment} />
          <svg className="ic ic-sm text-text-3" aria-hidden="true">
            <use href="#i-search" />
          </svg>
          <input
            name="q"
            defaultValue={q ?? ""}
            placeholder="搜索 openid / 微信昵称 / 绑定账号…"
            className="w-full bg-transparent text-[13px] outline-none placeholder:text-text-3 sm:w-56"
          />
        </form>
      </div>

      <div className="overflow-x-auto rounded-md border border-line bg-panel">
        <table className="w-full text-left text-[13px]">
          <thead>
            <tr className="border-b border-line bg-panel-2 text-xs text-text-2">
              <th className="px-4 py-2.5 font-medium">用户</th>
              <th className="px-3 py-2.5 font-medium">绑定账号</th>
              <th className="px-3 py-2.5 font-medium">订阅</th>
              <th className="px-3 py-2.5 font-medium">最近消息</th>
              <th className="px-3 py-2.5 font-medium">消息数</th>
              <th className="px-3 py-2.5 font-medium">最后活跃</th>
              <th className="px-4 py-2.5 text-right font-medium">操作</th>
            </tr>
          </thead>
          <tbody>
            {items.map((s) => (
              <tr key={s.id} className="border-b border-line last:border-b-0 hover:bg-panel-2">
                <td className="max-w-[240px] px-4 py-2.5">
                  <div className="flex items-center gap-1.5">
                    <span className="truncate text-text-1">{s.displayName}</span>
                    {s.isManualPending ? (
                      <span className="shrink-0 rounded-sm bg-amber/12 px-1.5 py-0.5 text-[11px] font-medium text-amber-hi">
                        待处理
                      </span>
                    ) : null}
                  </div>
                  <div
                    className="mt-0.5 truncate font-mono text-[11px] text-text-3"
                    title={s.openid}
                  >
                    {s.openid.slice(0, 10)}…
                  </div>
                </td>
                <td className="max-w-[160px] truncate px-3 py-2.5 text-xs text-text-2">
                  {s.boundUserName ?? <span className="text-text-3">未绑定</span>}
                </td>
                <td className="px-3 py-2.5">
                  <span
                    className={`inline-block rounded-sm px-1.5 py-0.5 text-xs font-medium ${
                      s.isSubscribed ? "bg-green/12 text-green" : "bg-panel-2 text-text-3"
                    }`}
                  >
                    {s.isSubscribed ? "已关注" : "已取关"}
                  </span>
                </td>
                <td className="max-w-[300px] px-3 py-2.5">
                  <div className="truncate text-text-1" title={s.lastContent ?? undefined}>
                    {s.lastContent ?? <span className="text-text-3">—</span>}
                  </div>
                  <div className="mt-0.5 text-[11px] text-text-3">
                    {s.lastDirection === "out"
                      ? "回复 · "
                      : s.lastDirection === "in"
                        ? "来件 · "
                        : ""}
                    {s.lastReplyKind
                      ? (REPLY_KIND_LABELS[s.lastReplyKind] ?? s.lastReplyKind)
                      : "—"}
                  </div>
                </td>
                <td className="px-3 py-2.5 font-mono text-xs text-text-2">{s.messageCount}</td>
                <td className="px-3 py-2.5 font-mono text-xs text-text-2">
                  {fmtIso(s.lastMessageAt)}
                </td>
                <td className="px-4 py-2.5 text-right">
                  <Link
                    href={`/admin/wechat-mp/${s.id}/`}
                    className="rounded-sm border border-line bg-panel px-2.5 py-1 text-xs text-text-2 hover:border-line-hover hover:text-text-1"
                  >
                    查看
                  </Link>
                </td>
              </tr>
            ))}
            {items.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-10 text-center text-xs text-text-3">
                  还没有公众号私信
                </td>
              </tr>
            )}
          </tbody>
        </table>

        <AdminPagination
          page={page}
          totalPages={totalPages}
          total={total}
          hrefFor={(p) => listHref(segment, p, q)}
          unit="位"
        />
      </div>

      <p className="text-[11px] leading-relaxed text-text-3">
        说明:公众号后台「服务器配置」指向 <code className="font-mono">/api/wechat/mp</code>,
        加密方式与 Token/AESKey 在「接入配置」页维护;API:GET /api/wechat-mp/sessions。
      </p>
    </div>
  );
}
