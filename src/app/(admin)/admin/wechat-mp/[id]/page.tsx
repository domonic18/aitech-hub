/**
 * 公众号单会话详情(M66):用户档案 + 时间轴(最近 200 条)+ 转人工线索处置。
 * 时间轴按「新→旧」呈现(运营先看最后一条);线索未清空时该会话的 AI 回复
 * 处于暂停态,全部标记已处理后自动恢复。
 */
import Link from "next/link";
import { notFound } from "next/navigation";

import LeadResolveControl from "@/components/admin/wechat-mp/LeadResolveControl";
import { requireAdminPage } from "@/lib/auth/guard";
import { getSessionAdmin } from "@/lib/channel/wechat-mp/admin";
import { formatCnDateTime } from "@/lib/datetime";

export const dynamic = "force-dynamic";

const REPLY_KIND_LABELS: Record<string, string> = {
  welcome: "欢迎语",
  keyword: "关键词",
  rag: "AI 答案",
  timeout: "超时回执",
  continue: "续读",
  handoff: "转人工",
  fallback: "无命中",
  help: "帮助",
  blocked: "已拦截",
  bind: "绑定",
  unsupported: "不支持类型",
};

const ANSWER_STATUS_LABELS: Record<string, string> = {
  ok: "已作答",
  no_evidence: "无站内命中",
  error: "生成失败",
  truncated: "已截断",
  blocked: "已拦截",
};

const MSG_TYPE_LABELS: Record<string, string> = {
  text: "文本",
  image: "图片",
  voice: "语音",
  video: "视频",
  shortvideo: "小视频",
  location: "位置",
  link: "链接",
  event: "事件",
  file: "文件",
};

interface PageProps {
  params: Promise<{ id: string }>;
}

/** admin 列表/时间轴统一按库里的 ISO 字符串渲染(空值回 —) */
function fmtIso(iso: string | null): string {
  return iso ? formatCnDateTime(new Date(iso)) : "—";
}

export default async function AdminWechatMpSessionPage({
  params,
}: PageProps): Promise<React.ReactElement> {
  await requireAdminPage();
  const { id } = await params;
  if (!/^\d+$/.test(id)) notFound();

  const detail = await getSessionAdmin(BigInt(id));
  if (!detail) notFound();

  const { user, messages, leads } = detail;
  const openLeads = leads.filter((l) => l.status !== "handled");

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-start gap-3">
        <div className="min-w-0">
          <h2 className="flex items-center gap-2 text-base font-semibold">
            {user.nickname ?? "微信用户"}
            {user.isManualPending ? (
              <span className="rounded-sm bg-amber/12 px-1.5 py-0.5 text-[11px] font-medium text-amber-hi">
                待处理
              </span>
            ) : null}
          </h2>
          <p className="mt-0.5 break-all font-mono text-[11px] text-text-3">{user.openid}</p>
        </div>
        <Link
          href="/admin/wechat-mp/"
          className="ml-auto shrink-0 rounded-sm border border-line bg-panel px-3 py-1.5 text-xs text-text-2 hover:border-line-hover hover:text-text-1"
        >
          ‹ 返回列表
        </Link>
      </div>

      <div className="grid gap-3 rounded-md border border-line bg-panel px-4 py-3 text-xs text-text-2 sm:grid-cols-2 lg:grid-cols-4">
        <div>
          <div className="text-[11px] text-text-3">订阅状态</div>
          <div className="mt-0.5 font-medium text-text-1">
            {user.isSubscribed ? "已关注" : "已取关"}
          </div>
          {user.unsubscribedAt ? (
            <div className="mt-0.5 text-[11px] text-text-3">
              取关于 {fmtIso(user.unsubscribedAt)}
            </div>
          ) : null}
        </div>
        <div>
          <div className="text-[11px] text-text-3">绑定账号</div>
          <div className="mt-0.5 font-medium text-text-1">
            {user.boundUserName ?? <span className="text-text-3">未绑定</span>}
          </div>
        </div>
        <div>
          <div className="text-[11px] text-text-3">消息总数</div>
          <div className="mt-0.5 font-mono text-text-1">{user.messageCount}</div>
        </div>
        <div>
          <div className="text-[11px] text-text-3">最后活跃</div>
          <div className="mt-0.5 font-mono text-text-1">{fmtIso(user.lastMessageAt)}</div>
        </div>
      </div>

      {openLeads.length > 0 ? (
        <section className="rounded-md border border-amber/30 bg-amber/5">
          <header className="border-b border-amber/20 px-4 py-2.5 text-xs font-semibold text-amber-hi">
            转人工线索 · 待处理 {openLeads.length} 条
            <span className="ml-2 font-normal text-text-3">清空后 AI 回复自动恢复</span>
          </header>
          <ul className="divide-y divide-amber/15">
            {openLeads.map((l) => (
              <li key={l.id} className="flex flex-col gap-2 px-4 py-3">
                <div className="flex flex-wrap items-baseline gap-2 text-xs">
                  <span className="rounded-sm bg-amber/12 px-1.5 py-0.5 text-[11px] text-amber-hi">
                    {l.reason}
                  </span>
                  <span className="font-mono text-[11px] text-text-3">{fmtIso(l.createdAt)}</span>
                </div>
                <LeadResolveControl sessionId={user.id} leadId={l.id} />
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {leads.some((l) => l.status === "handled") ? (
        <details className="rounded-md border border-line bg-panel">
          <summary className="cursor-pointer px-4 py-2.5 text-xs text-text-2">
            已处理线索({leads.length - openLeads.length})
          </summary>
          <ul className="divide-y divide-line border-t border-line">
            {leads
              .filter((l) => l.status === "handled")
              .map((l) => (
                <li key={l.id} className="px-4 py-2.5 text-xs text-text-2">
                  <div className="flex flex-wrap items-baseline gap-2">
                    <span className="rounded-sm bg-panel-2 px-1.5 py-0.5 text-[11px] text-text-3">
                      {l.reason}
                    </span>
                    <span className="font-mono text-[11px] text-text-3">{fmtIso(l.handledAt)}</span>
                  </div>
                  {l.note ? <p className="mt-1 whitespace-pre-wrap text-text-2">{l.note}</p> : null}
                </li>
              ))}
          </ul>
        </details>
      ) : null}

      <section className="overflow-hidden rounded-md border border-line bg-panel">
        <header className="flex items-baseline justify-between border-b border-line px-4 py-2.5">
          <h3 className="text-sm font-semibold">消息时间轴</h3>
          <span className="text-[11px] text-text-3">最近 {messages.length} 条 · 新→旧</span>
        </header>
        <ul className="divide-y divide-line">
          {messages.map((m) => (
            <li key={m.id} className="px-4 py-3">
              <div className="flex flex-wrap items-center gap-2 text-[11px]">
                <span
                  className={`rounded-sm px-1.5 py-0.5 font-medium ${
                    m.direction === "in" ? "bg-panel-2 text-text-2" : "bg-accent-dim text-accent"
                  }`}
                >
                  {m.direction === "in" ? "用户" : "公众号"}
                </span>
                <span className="text-text-3">{MSG_TYPE_LABELS[m.msgType] ?? m.msgType}</span>
                {m.event ? <span className="text-text-3">事件 {m.event}</span> : null}
                {m.replyKind ? (
                  <span className="text-text-3">
                    {REPLY_KIND_LABELS[m.replyKind] ?? m.replyKind}
                  </span>
                ) : null}
                {m.answerStatus ? (
                  <span className={m.answerStatus === "ok" ? "text-green" : "text-amber-hi"}>
                    {ANSWER_STATUS_LABELS[m.answerStatus] ?? m.answerStatus}
                  </span>
                ) : null}
                {m.latencyMs !== null ? (
                  <span className="font-mono text-text-3">{m.latencyMs}ms</span>
                ) : null}
                <span className="ml-auto font-mono text-text-3">{fmtIso(m.createdAt)}</span>
              </div>
              <p className="mt-1.5 whitespace-pre-wrap break-words text-[13px] text-text-1">
                {m.content}
              </p>
            </li>
          ))}
          {messages.length === 0 && (
            <li className="px-4 py-10 text-center text-xs text-text-3">暂无消息</li>
          )}
        </ul>
      </section>
    </div>
  );
}
