"use client";

/**
 * 会话详情弹窗(K2.6 需求5):按行「详情」打开,拉 /api/agent-sessions/[id]
 * 展示 meta 统计 + checkpoint 消息时间线;assistant 正文走共享 AnswerMarkdown
 * (与前台 Drawer 同一渲染子集)。游客过期只显 meta + 过期标注。
 */
import { useState } from "react";

import AnswerMarkdown from "@/components/site/search/AnswerMarkdown";
import DialogShell, { DialogActions } from "@/components/admin/DialogShell";
import type { ApiEnvelope } from "@/lib/http/response";

interface DetailMeta {
  threadId: string;
  kind: "member" | "guest";
  title: string | null;
  owner: string;
  runs: number;
  tokensTotal: number;
  firstAt: string;
  lastAt: string;
  live: boolean | null;
}

interface DetailPayload {
  meta: DetailMeta;
  expired: boolean;
  messages: Array<{
    type: string;
    content: string | Array<{ type?: string; text?: string }>;
  }> | null;
}

/** content 多模态块只留文本(admin 详情无图像面,同 wire 口径) */
function toText(content: string | Array<{ type?: string; text?: string }>): string {
  if (typeof content === "string") return content;
  return content
    .filter((c) => c.type === "text" || c.type === "text_delta")
    .map((c) => c.text ?? "")
    .join("");
}

const KIND_LABEL: Record<DetailMeta["kind"], string> = { member: "成员", guest: "游客" };

export default function AgentSessionDetailDialog({
  threadId,
  label,
}: {
  threadId: string;
  label: string;
}): React.ReactElement {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [detail, setDetail] = useState<DetailPayload | null>(null);

  async function load(): Promise<void> {
    setOpen(true);
    setBusy(true);
    setError(null);
    setDetail(null);
    try {
      const res = await fetch(`/api/agent-sessions/${threadId}`);
      const body = (await res.json()) as ApiEnvelope & { data?: DetailPayload };
      if (body.code !== 0) {
        setError(body.message || `HTTP ${res.status}`);
        return;
      }
      setDetail(body.data ?? null);
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }

  const meta = detail?.meta;

  return (
    <>
      <button
        type="button"
        onClick={() => void load()}
        className="cursor-pointer rounded-sm border border-line px-2 py-1 text-[11px] text-text-2 hover:bg-panel-2"
      >
        详情
      </button>
      {open && (
        <DialogShell width="2xl" scroll title={`会话详情 · ${label}`}>
          {busy && <p className="mt-2 text-xs text-text-3">加载中…</p>}
          {!busy && error && <p className="mt-2 font-mono text-xs text-red">{error}</p>}
          {!busy && !error && meta && (
            <>
              <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 rounded-sm bg-panel-2 px-3 py-2.5 text-[11px] leading-relaxed text-text-2">
                <span>
                  类型:<b className="text-text-1">{KIND_LABEL[meta.kind]}</b>
                  {meta.kind === "guest" && meta.live !== null && (
                    <b className={`ml-1.5 ${meta.live ? "text-green" : "text-amber"}`}>
                      {meta.live ? "活跃中" : "已过期"}
                    </b>
                  )}
                </span>
                <span>
                  提问:<b className="text-text-1">{meta.runs}</b> 次 · tokens:
                  <b className="text-text-1">{meta.tokensTotal}</b>
                </span>
                <span className="font-mono text-text-3" title={meta.owner}>
                  归属:{meta.kind === "member" ? meta.owner : `游客 ${meta.threadId.slice(0, 10)}…`}
                </span>
                <span className="font-mono text-text-3">
                  {meta.firstAt.slice(0, 16).replace("T", " ")} →{" "}
                  {meta.lastAt.slice(0, 16).replace("T", " ")}
                </span>
              </div>

              {detail?.expired && (
                <div className="mt-3 rounded-sm border border-amber/35 bg-amber/10 px-3 py-2 text-xs text-amber">
                  会话数据已过期清退,消息正文不可查看(仅保留台账统计)。
                </div>
              )}

              {detail?.messages && detail.messages.length > 0 && (
                <div className="mt-3 flex flex-col gap-3">
                  {detail.messages
                    .filter((m) => m.type === "human" || m.type === "ai")
                    .map((m, i) => {
                      const text = toText(m.content).trim();
                      if (!text) return null; // 纯工具调用/空内容帧不进时间线
                      return m.type === "human" ? (
                        <div
                          key={i}
                          className="ml-auto max-w-[80%] rounded-md rounded-br-sm bg-accent-dim px-3 py-2 text-[13px] leading-relaxed text-text-1 whitespace-pre-wrap"
                        >
                          {text}
                        </div>
                      ) : (
                        <div
                          key={i}
                          className="max-w-[92%] rounded-md rounded-bl-sm border border-line bg-panel-2 px-3 py-2"
                        >
                          <AnswerMarkdown text={text} />
                        </div>
                      );
                    })}
                </div>
              )}
              {detail?.messages && detail.messages.length === 0 && !detail.expired && (
                <p className="mt-3 text-xs text-text-3">会话暂无消息。</p>
              )}
            </>
          )}
          <DialogActions>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="rounded-sm border border-line px-3 py-1.5 text-xs text-text-2 hover:bg-panel-2"
            >
              关闭
            </button>
          </DialogActions>
        </DialogShell>
      )}
    </>
  );
}
