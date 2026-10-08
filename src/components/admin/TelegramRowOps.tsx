"use client";

/**
 * 电报条目行操作(M7 批④):状态迁移(按当前态给 恢复/隐藏/归档)+ 标题摘要
 * 人工修正弹窗。deleted 终态不经 UI。
 * M9:视频行加「解读」按钮(存量补读与失败重试同入口;POST interpret 入队即返回)。
 * M12 批⑥(2026-10-05 验收反馈):文字行加「摘要」按钮(POST summarize,done 态
 * 显「重摘要」= 重新生成入口);解读/摘要入队成功给行内「已加入处理队列」提示
 * (此前仅静默 refresh,用户不知道点没点生效),失败仍 alert。
 */
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { field } from "@/components/admin/form-fields";
import type { ApiEnvelope } from "@/lib/http/response";
import DialogShell, { DialogActions } from "@/components/admin/DialogShell";

const ACTIONS: Record<string, Array<{ label: string; to: string; danger?: boolean }>> = {
  visible: [
    { label: "隐藏", to: "hidden", danger: true },
    { label: "归档", to: "archived" },
  ],
  hidden: [
    { label: "恢复", to: "visible" },
    { label: "归档", to: "archived" },
  ],
  archived: [
    { label: "恢复", to: "visible" },
    { label: "隐藏", to: "hidden", danger: true },
  ],
};

const QUEUED_HINT_MS = 5000;

export default function TelegramRowOps({
  id,
  title,
  summary,
  status,
  mediaType,
  aiStatus,
}: {
  id: string;
  title: string | null;
  summary: string;
  status: string;
  mediaType?: string;
  /** 解读态(批⑥):决定 AI 按钮「首次/重新生成」措辞;pending/processing 加提示 */
  aiStatus?: string | null;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [queued, setQueued] = useState(false);
  const queuedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [open, setOpen] = useState(false);
  const [editTitle, setEditTitle] = useState(title ?? "");
  const [editSummary, setEditSummary] = useState(summary);

  useEffect(
    () => () => {
      if (queuedTimer.current) clearTimeout(queuedTimer.current);
    },
    [],
  );

  /** 手动触发解读/摘要(入队即返回,结果看解读态徽章);失败 alert 不阻断行内其他操作 */
  const triggerAi = async (kind: "interpret" | "summarize"): Promise<void> => {
    setBusy(true);
    try {
      const res = await fetch(`/api/telegram/${id}/${kind}`, { method: "POST" });
      const resp = (await res.json()) as ApiEnvelope;
      if (resp.code !== 0) {
        alert(`${kind === "interpret" ? "解读" : "摘要"}触发失败:${resp.message}`);
        return;
      }
      // 批⑥:入队成功行内提示 + refresh 让徽章翻到「排队中」
      setQueued(true);
      if (queuedTimer.current) clearTimeout(queuedTimer.current);
      queuedTimer.current = setTimeout(() => setQueued(false), QUEUED_HINT_MS);
      router.refresh();
    } finally {
      setBusy(false);
    }
  };

  async function patch(body: Record<string, unknown>): Promise<boolean> {
    setBusy(true);
    try {
      const res = await fetch(`/api/telegram/${id}`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const resp = (await res.json()) as ApiEnvelope;
      if (resp.code !== 0) {
        alert(`操作失败:${resp.message}`);
        return false;
      }
      router.refresh();
      return true;
    } finally {
      setBusy(false);
    }
  }

  const saveEdit = async (): Promise<void> => {
    const ok = await patch({ title: editTitle.trim(), summary: editSummary.trim() });
    if (ok) setOpen(false);
  };

  const isVideo = mediaType === "video";
  const isText = mediaType === "text";
  const aiRerun = aiStatus === "done" || aiStatus === "missing_transcript";
  const aiWorking = aiStatus === "pending" || aiStatus === "processing";

  return (
    <div className="flex items-center justify-end gap-1 text-xs">
      {(ACTIONS[status] ?? []).map((a) => (
        <button
          key={a.to}
          type="button"
          disabled={busy}
          onClick={() => void patch({ status: a.to })}
          className={`cursor-pointer rounded-sm px-2 py-1 disabled:opacity-50 ${
            a.danger ? "text-red hover:bg-red/10" : "text-accent hover:bg-accent-dim"
          }`}
        >
          {a.label}
        </button>
      ))}
      {isVideo && (
        <button
          type="button"
          disabled={busy}
          onClick={() => void triggerAi("interpret")}
          title={
            aiRerun
              ? "重新生成解读:重拉转写/文案 → LLM 概括(覆盖现有结论)"
              : "下载 → 抽轨 → ASR 转写 → LLM 概括(入队即返回)"
          }
          className="cursor-pointer rounded-sm px-2 py-1 text-text-2 hover:bg-panel-2 disabled:opacity-50"
        >
          {aiRerun ? "重解读" : "解读"}
        </button>
      )}
      {isText && (
        <button
          type="button"
          disabled={busy}
          onClick={() => void triggerAi("summarize")}
          title={
            aiRerun
              ? "重新生成摘要:LLM 中心思想 + 要点 + 关键词(覆盖现有结论)"
              : "LLM 一句话中心思想 + 要点 + 关键词(入队即返回)"
          }
          className="cursor-pointer rounded-sm px-2 py-1 text-text-2 hover:bg-panel-2 disabled:opacity-50"
        >
          {aiRerun ? "重摘要" : "摘要"}
        </button>
      )}
      {queued && (
        <span className="whitespace-nowrap rounded-sm bg-green/10 px-1.5 py-px font-mono text-[10px] text-green-hi">
          已加入处理队列
        </span>
      )}
      {!queued && aiWorking && (
        <span className="whitespace-nowrap font-mono text-[10px] text-text-3">队列处理中…</span>
      )}
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="cursor-pointer rounded-sm px-2 py-1 text-text-2 hover:bg-panel-2"
      >
        编辑
      </button>
      {open && (
        <DialogShell width="lg" title={`修正条目(#${id})`}>
          <label className="mt-3 block text-xs text-text-3">
            标题(≤500)
            <input
              value={editTitle}
              onChange={(e) => setEditTitle(e.target.value)}
              maxLength={500}
              className={`mt-1 ${field}`}
            />
          </label>
          <label className="mt-3 block text-xs text-text-3">
            摘要(≤1000)
            <textarea
              value={editSummary}
              onChange={(e) => setEditSummary(e.target.value)}
              rows={4}
              maxLength={1000}
              className={`mt-1 ${field}`}
            />
          </label>
          {busy && <p className="mt-2 font-mono text-xs text-text-3">保存中…</p>}
          <DialogActions>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="rounded-sm border border-line px-3 py-1.5 text-xs text-text-2 hover:bg-panel-2"
            >
              取消
            </button>
            <button
              type="button"
              disabled={busy || editTitle.trim() === "" || editSummary.trim() === ""}
              onClick={() => void saveEdit()}
              className="rounded-sm bg-accent px-3 py-1.5 text-xs font-medium text-white hover:bg-accent-hover disabled:opacity-50"
            >
              {busy ? "保存中…" : "保存"}
            </button>
          </DialogActions>
        </DialogShell>
      )}
    </div>
  );
}
