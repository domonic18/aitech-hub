/**
 * 会话管理页(K2.6 需求5;侧栏精简批② 起为 AI 用量「会话」页签,原型参照
 * admin/users):成员(登录账号)与游客会话一屏可见——均以会话行为准;
 * 游客行匿名(不存访客标识)、归属键 2 小时未活动即不可继续追问,内容随行
 * 留档 30 天后日清。分段 + 搜索 + 分页整页服务端渲染;详情走行内弹窗
 * (checkpoint 时间线)。
 */
import AgentSessionDetailDialog from "@/components/admin/AgentSessionDetailDialog";
import AdminPagination from "@/components/admin/AdminPagination";
import { requireAdminPage } from "@/lib/auth/guard";
import { formatCnDateTime } from "@/lib/datetime";
import { adminListHref, parseListSegment, parsePage } from "@/lib/admin/list";
import {
  AGENT_SESSION_KINDS,
  AGENT_SESSIONS_PAGE_SIZE,
  ANSWER_LOGS_PAGE_SIZE,
  ANSWER_LOG_STATUSES,
  displayVisitor,
  listAgentSessionsAdmin,
  listAnswerLogsAdmin,
  type AgentSessionKindFilter,
  type AgentSessionKind,
  type AnswerLogStatusFilter,
} from "@/lib/agent/admin-sessions";

export const dynamic = "force-dynamic";

const SEG_LABELS: Record<AgentSessionKindFilter, string> = {
  all: "全部",
  member: "成员会话",
  guest: "游客会话",
  answer: "答案卡",
};

const ANSWER_STATUS_LABELS: Record<string, string> = {
  ok: "正常",
  degraded: "降级",
  failed: "失败",
};

interface PageProps {
  searchParams: Promise<{ status?: string; page?: string; q?: string; st?: string }>;
}

function listHref(kind: AgentSessionKindFilter, page: number, q?: string): string {
  return adminListHref("/admin/usage/sessions/", {
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

/** 游客活跃态:live true=可继续追问/false=已结束(内容仍留档)/null=不可判;成员恒「在档」 */
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
        已结束
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

  const answerStatus: AnswerLogStatusFilter = ANSWER_LOG_STATUSES.includes(
    sp.st as AnswerLogStatusFilter,
  )
    ? (sp.st as AnswerLogStatusFilter)
    : "all";
  // 答案卡段(批B)走独立读侧;段徽章计数需要 answer 总数,非该段时只查 count
  const isAnswer = kind === "answer";
  const answerList = isAnswer ? await listAnswerLogsAdmin({ page, q, status: answerStatus }) : null;
  const sessionList = isAnswer ? null : await listAgentSessionsAdmin({ page, kind, q });
  const counts = {
    ...(sessionList?.counts ?? { all: 0, member: 0, guest: 0 }),
    answer: answerList?.total ?? 0,
  };
  const total = isAnswer ? answerList!.total : sessionList!.total;
  const totalPages = Math.max(
    1,
    Math.ceil(total / (isAnswer ? ANSWER_LOGS_PAGE_SIZE : AGENT_SESSIONS_PAGE_SIZE)),
  );

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h2 className="text-base font-semibold">会话管理</h2>
        <p className="mt-0.5 text-xs text-text-3">
          站内搜索 Agent 会话审计:成员与游客会话均留档(2026-11-17 起游客行存访客标识 uuid 前 8
          位区分);归属键 2 小时未活动后不可继续追问,内容与行留存 30 天后自动清退; 答案卡问答留档 90
          天。
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
          action="/admin/usage/sessions/"
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

      {isAnswer ? (
        <div className="overflow-x-auto rounded-md border border-line bg-panel">
          <div className="flex flex-wrap items-center gap-2 border-b border-line bg-panel-2/50 px-4 py-2">
            <span className="text-xs text-text-3">状态</span>
            {ANSWER_LOG_STATUSES.map((st) => (
              <a
                key={st}
                href={`/admin/usage/sessions/?status=answer${st === "all" ? "" : `&st=${st}`}${q ? `&q=${encodeURIComponent(q)}` : ""}`}
                className={`rounded-full border px-2.5 py-1 text-[11.5px] ${
                  st === answerStatus
                    ? "border-accent bg-accent text-white"
                    : "border-line bg-panel text-text-2 hover:bg-panel-2"
                }`}
              >
                {st === "all" ? "全部" : (ANSWER_STATUS_LABELS[st] ?? st)}
              </a>
            ))}
            <span className="ml-auto font-mono text-[11px] text-text-3">
              留档 90 天滚动 · 04:41 日清
            </span>
          </div>
          <table className="w-full text-left text-[13px]">
            <thead>
              <tr className="border-b border-line bg-panel-2 text-xs text-text-2">
                <th className="px-4 py-2.5 font-medium">问题</th>
                <th className="px-3 py-2.5 font-medium">状态</th>
                <th className="px-3 py-2.5 font-medium">耗时</th>
                <th className="px-3 py-2.5 font-medium">模型</th>
                <th className="px-3 py-2.5 font-medium">访客</th>
                <th className="px-4 py-2.5 font-medium">时间 / 答案</th>
              </tr>
            </thead>
            <tbody>
              {answerList?.items.map((a) => (
                <tr key={a.id} className="border-b border-line last:border-b-0 hover:bg-panel-2">
                  <td className="max-w-[320px] px-4 py-2.5">
                    <div className="truncate font-medium text-text-1" title={a.question}>
                      {a.question}
                    </div>
                  </td>
                  <td className="px-3 py-2.5">
                    <span
                      className={`rounded-sm px-1.5 py-0.5 font-mono text-[11px] ${
                        a.status === "ok"
                          ? "bg-green/12 text-green"
                          : a.status === "degraded"
                            ? "bg-amber/12 text-amber"
                            : "bg-red/10 text-red"
                      }`}
                    >
                      {ANSWER_STATUS_LABELS[a.status] ?? a.status}
                    </span>
                  </td>
                  <td className="px-3 py-2.5 font-mono text-xs text-text-2">
                    {(a.durationMs / 1000).toFixed(1)}s
                  </td>
                  <td className="px-3 py-2.5 font-mono text-[11px] text-text-3">{a.modelKey}</td>
                  <td className="px-3 py-2.5 font-mono text-[11px] text-text-3">
                    {displayVisitor(a.visitorId)}
                  </td>
                  <td className="px-4 py-2.5">
                    <div className="font-mono text-[11px] text-text-3">
                      {formatCnDateTime(a.createdAt)}
                    </div>
                    <details className="mt-1">
                      <summary className="cursor-pointer select-none text-[11.5px] text-accent hover:text-accent-hover">
                        查看答案{a.cites?.items?.length ? ` · 引用 ${a.cites.items.length} 篇` : ""}
                      </summary>
                      <div className="mt-1.5 max-w-[520px] rounded-sm border border-line bg-panel-2/40 px-3 py-2">
                        <p className="whitespace-pre-wrap text-[12.5px] leading-relaxed text-text-1">
                          {a.answer ?? "(未生成答案)"}
                        </p>
                        {a.cites?.items && a.cites.items.length > 0 && (
                          <ul className="mt-2 flex flex-col gap-1 text-[11px]">
                            {a.cites.items.map((c) => (
                              <li key={c.n} className="truncate">
                                <span className="font-mono text-text-3">[{c.n}] </span>
                                <a
                                  href={c.href}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="text-blue hover:text-blue/80"
                                >
                                  {c.title} ↗
                                </a>
                              </li>
                            ))}
                          </ul>
                        )}
                        {a.cites?.followUps && a.cites.followUps.length > 0 && (
                          <p className="mt-1.5 text-[11px] text-text-3">
                            追问:{a.cites.followUps.join(" / ")}
                          </p>
                        )}
                      </div>
                    </details>
                  </td>
                </tr>
              ))}
              {answerList?.items.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-4 py-10 text-center text-xs text-text-3">
                    暂无答案卡留档(用户在搜索页触发 AI 答案卡后此处可见,90 天滚动)
                  </td>
                </tr>
              )}
            </tbody>
          </table>
          <AdminPagination
            page={page}
            totalPages={totalPages}
            total={total}
            hrefFor={(p) =>
              `/admin/usage/sessions/?status=answer${answerStatus === "all" ? "" : `&st=${answerStatus}`}${q ? `&q=${encodeURIComponent(q)}` : ""}${p > 1 ? `&page=${p}` : ""}`
            }
            unit="条"
          />
        </div>
      ) : (
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
              {sessionList!.items.map((s) => (
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
                      {s.threadId} · {s.owner}
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
              {sessionList!.items.length === 0 && (
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
      )}

      <p className="text-[11px] leading-relaxed text-text-3">
        成员会话保留 30 天,游客会话 2 小时无活动后过期(过期后仅留存统计数据);答案卡问答留档 90
        天。均每日自动清理。
      </p>
    </div>
  );
}
