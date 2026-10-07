/**
 * 会话管理页(K2.6 需求5,原型参照 admin/users):成员(admin 登录)与游客
 * 会话一屏可见——成员=会话行,游客=台账聚合(不落行,过期仅留统计)。分段
 * + 搜索 + 分页整页服务端渲染;详情走行内弹窗(checkpoint 时间线)。
 */
import AgentSessionDetailDialog from "@/components/admin/AgentSessionDetailDialog";
import AdminPagination from "@/components/admin/AdminPagination";
import { requireAdminPage } from "@/lib/auth/guard";
import { formatCnDateTime } from "@/lib/datetime";
import { adminListHref, parseListSegment, parsePage } from "@/lib/admin/list";
import {
  AGENT_SESSION_KINDS,
  AGENT_SESSIONS_PAGE_SIZE,
  listAgentSessionsAdmin,
  type AgentSessionKindFilter,
  type AgentSessionKind,
} from "@/lib/agent/admin-sessions";

export const dynamic = "force-dynamic";

const SEG_LABELS: Record<AgentSessionKindFilter, string> = {
  all: "全部",
  member: "成员会话",
  guest: "游客会话",
};

interface PageProps {
  searchParams: Promise<{ status?: string; page?: string; q?: string }>;
}

function listHref(kind: AgentSessionKindFilter, page: number, q?: string): string {
  return adminListHref("/admin/agent-sessions/", {
    status: kind === "all" ? undefined : kind,
    page,
    q,
  });
}

function KindBadge({ kind }: { kind: AgentSessionKind }) {
  return kind === "member" ? (
    <span className="rounded-sm bg-accent-dim px-1.5 py-0.5 font-mono text-[11px] text-accent">
      成员
    </span>
  ) : (
    <span className="rounded-sm bg-panel-2 px-1.5 py-0.5 font-mono text-[11px] text-text-2">
      游客
    </span>
  );
}

/** 游客活跃态:live true=活跃/false=已过期/null=不可判;成员恒「在档」 */
function LiveBadge({ kind, live }: { kind: AgentSessionKind; live: boolean | null }) {
  if (kind === "member") {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-sm bg-green/12 px-2 py-0.5 text-xs font-medium text-green">
        <span className="h-1.5 w-1.5 rounded-full bg-green" aria-hidden="true" />
        在档
      </span>
    );
  }
  if (live === true) {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-sm bg-green/12 px-2 py-0.5 text-xs font-medium text-green">
        <span className="h-1.5 w-1.5 rounded-full bg-green" aria-hidden="true" />
        活跃
      </span>
    );
  }
  if (live === false) {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-sm bg-amber/12 px-2 py-0.5 text-xs font-medium text-amber">
        <span className="h-1.5 w-1.5 rounded-full bg-amber" aria-hidden="true" />
        已过期
      </span>
    );
  }
  return <span className="font-mono text-[11px] text-text-3">—</span>;
}

export default async function AdminAgentSessionsPage({
  searchParams,
}: PageProps): Promise<React.ReactElement> {
  await requireAdminPage();
  const sp = await searchParams;
  const kind = parseListSegment(AGENT_SESSION_KINDS, sp.status, "all");
  const page = parsePage(sp.page);
  const q = sp.q?.trim() || undefined;

  const { items, total, counts } = await listAgentSessionsAdmin({ page, kind, q });
  const totalPages = Math.max(1, Math.ceil(total / AGENT_SESSIONS_PAGE_SIZE));

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h2 className="text-base font-semibold">会话管理</h2>
        <p className="mt-0.5 text-xs text-text-3">
          站内搜索 Agent 会话审计:成员(登录账号)落会话行;游客不落行,台账聚合统计, 归属键 2
          小时未活动自动清退、checkpoint 随日清删除。
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <div className="flex overflow-hidden rounded-sm border border-line">
          {AGENT_SESSION_KINDS.map((seg) => (
            <a
              key={seg}
              href={listHref(seg, 1, q)}
              className={`border-r border-line px-4 py-2 text-[13px] last:border-r-0 ${
                seg === kind
                  ? "bg-accent-dim font-semibold text-accent"
                  : "bg-panel text-text-2 hover:bg-panel-2"
              }`}
            >
              {SEG_LABELS[seg]} {counts[seg]}
            </a>
          ))}
        </div>
        <form
          method="GET"
          action="/admin/agent-sessions/"
          className="ml-auto flex w-full items-center gap-2 rounded-sm border border-line bg-panel px-2.5 py-1.5 focus-within:border-accent sm:w-auto"
        >
          <input type="hidden" name="status" value={kind} />
          <svg className="ic ic-sm text-text-3" aria-hidden="true">
            <use href="#i-search" />
          </svg>
          <input
            name="q"
            defaultValue={q ?? ""}
            placeholder="搜索标题 / 会话 ID…"
            className="w-full bg-transparent text-[13px] outline-none placeholder:text-text-3 sm:w-56"
          />
        </form>
      </div>

      <div className="overflow-x-auto rounded-md border border-line bg-panel">
        <table className="w-full text-left text-[13px]">
          <thead>
            <tr className="border-b border-line bg-panel-2 text-xs text-text-2">
              <th className="px-4 py-2.5 font-medium">会话</th>
              <th className="px-3 py-2.5 font-medium">类型</th>
              <th className="px-3 py-2.5 font-medium">提问</th>
              <th className="px-3 py-2.5 font-medium">Tokens</th>
              <th className="px-3 py-2.5 font-medium">最近活动</th>
              <th className="px-3 py-2.5 font-medium">状态</th>
              <th className="px-4 py-2.5 text-right font-medium">操作</th>
            </tr>
          </thead>
          <tbody>
            {items.map((s) => (
              <tr
                key={s.threadId}
                className="border-b border-line last:border-b-0 hover:bg-panel-2"
              >
                <td className="max-w-[280px] px-4 py-2.5">
                  <div className="truncate font-medium text-text-1">
                    {s.title ?? (s.kind === "guest" ? "游客会话" : "未命名会话")}
                  </div>
                  <div
                    className="mt-0.5 truncate font-mono text-[11px] text-text-3"
                    title={`${s.threadId} · ${s.owner}`}
                  >
                    {s.threadId} · {s.kind === "member" ? s.owner : "游客"}
                  </div>
                </td>
                <td className="px-3 py-2.5">
                  <KindBadge kind={s.kind} />
                </td>
                <td className="px-3 py-2.5 font-mono text-xs text-text-2">{s.runs}</td>
                <td className="px-3 py-2.5 font-mono text-xs text-text-2">{s.tokensTotal}</td>
                <td className="px-3 py-2.5 font-mono text-xs text-text-2">
                  {formatCnDateTime(s.lastAt)}
                </td>
                <td className="px-3 py-2.5">
                  <LiveBadge kind={s.kind} live={s.live} />
                </td>
                <td className="px-4 py-2.5 text-right">
                  <AgentSessionDetailDialog
                    threadId={s.threadId}
                    label={s.title ?? (s.kind === "guest" ? "游客会话" : s.threadId)}
                  />
                </td>
              </tr>
            ))}
            {items.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-10 text-center text-xs text-text-3">
                  没有符合条件的会话
                </td>
              </tr>
            )}
          </tbody>
        </table>

        <AdminPagination
          page={page}
          totalPages={totalPages}
          total={total}
          hrefFor={(p) => listHref(kind, p, q)}
          unit="个"
        />
      </div>

      <p className="text-[11px] leading-relaxed text-text-3">
        说明:成员会话保留 30 天(每日 04:33 日清);游客会话归属键 2 小时未活动过期, checkpoint
        由日清删除,此后仅剩台账统计(ai_usage_log 按 session_id 聚合)。 API:GET
        /api/agent-sessions?page=&amp;kind=&amp;q= · GET /api/agent-sessions/[threadId]。
      </p>
    </div>
  );
}
