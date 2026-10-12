"use client";

/**
 * 专题定位编辑 + 人工状态流转(M26 批③治理台):标题/定位/关联文章 id 可改
 * (PATCH /api/topics/[id]);状态钮组只出人工迁移目标(MANUAL_STATUS_TARGETS,
 * §10-7 collecting→drafted 仅合成驱动不出钮),流转失败(如逆跳)行内红字。
 */
import { useState } from "react";
import { useRouter } from "next/navigation";

import {
  MANUAL_STATUS_TARGETS,
  TOPIC_STATUS_LABEL,
  type TopicStatus,
} from "@/lib/topics/constants";
import type { ApiEnvelope } from "@/lib/http/response";

export default function TopicMetaPanel({
  id,
  title,
  positioning,
  linkedPostId,
  status,
}: {
  id: string;
  title: string;
  positioning: string | null;
  linkedPostId: string | null;
  status: string;
}) {
  const router = useRouter();
  const [titleDraft, setTitleDraft] = useState(title);
  const [positioningDraft, setPositioningDraft] = useState(positioning ?? "");
  const [linkedDraft, setLinkedDraft] = useState(linkedPostId ?? "");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: "ok" | "err"; text: string } | null>(null);

  const dirty =
    titleDraft.trim() !== title ||
    positioningDraft !== (positioning ?? "") ||
    linkedDraft !== (linkedPostId ?? "");

  async function patch(body: Record<string, unknown>, okText: string): Promise<boolean> {
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch(`/api/topics/${id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const resp = (await res.json()) as ApiEnvelope;
      if (!res.ok || resp.code !== 0) {
        setMsg({ tone: "err", text: resp.message || `保存失败(${res.status})` });
        return false;
      }
      setMsg({ tone: "ok", text: okText });
      router.refresh();
      return true;
    } catch {
      setMsg({ tone: "err", text: "网络异常,请重试" });
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function saveMeta(): Promise<void> {
    if (busy || !dirty) return;
    const ok = await patch(
      {
        ...(titleDraft.trim() !== title ? { title: titleDraft.trim() } : {}),
        ...(positioningDraft !== (positioning ?? "")
          ? { positioning: positioningDraft.trim() || null }
          : {}),
        ...(linkedDraft !== (linkedPostId ?? "")
          ? { linkedPostId: linkedDraft.trim() === "" ? null : linkedDraft.trim() }
          : {}),
      },
      "已保存",
    );
    if (ok && titleDraft.trim() !== title) setTitleDraft(titleDraft.trim());
  }

  const targets = MANUAL_STATUS_TARGETS[status as TopicStatus] ?? [];

  return (
    <div className="flex flex-col gap-2 rounded-sm border border-line bg-panel p-3">
      <div className="flex items-center gap-2">
        <input
          value={titleDraft}
          maxLength={200}
          onChange={(e) => setTitleDraft(e.target.value)}
          className="flex-1 rounded-sm border border-line bg-panel px-2.5 py-1.5 text-[13px] outline-none focus:border-accent"
          aria-label="专题标题"
        />
        <span className="shrink-0 rounded-sm bg-amber/12 px-1.5 py-0.5 text-xs font-medium text-amber-hi">
          {TOPIC_STATUS_LABEL[status as TopicStatus] ?? status}
        </span>
      </div>
      <textarea
        value={positioningDraft}
        maxLength={1000}
        rows={2}
        onChange={(e) => setPositioningDraft(e.target.value)}
        placeholder="专题定位(合成的选材与口吻指引)…"
        className="rounded-sm border border-line bg-panel px-2.5 py-1.5 text-[13px] outline-none focus:border-accent placeholder:text-text-3"
        aria-label="专题定位"
      />
      <div className="flex flex-wrap items-center gap-2">
        <label className="flex items-center gap-1.5 text-xs text-text-2">
          关联文章 id
          <input
            value={linkedDraft}
            onChange={(e) => setLinkedDraft(e.target.value)}
            placeholder="合成后自动回填;人工关联可直填 id"
            className="w-40 rounded-sm border border-line bg-panel px-2 py-1 text-[12px] outline-none focus:border-accent placeholder:text-text-3"
          />
        </label>
        <button
          type="button"
          onClick={() => void saveMeta()}
          disabled={busy || !dirty}
          className="rounded-sm bg-accent px-3 py-1 text-xs font-medium text-[color:var(--accent-contrast)] hover:opacity-90 disabled:opacity-50"
        >
          保存
        </button>
        {targets.map((t) => (
          <button
            key={t}
            type="button"
            disabled={busy}
            onClick={() => void patch({ status: t }, `已流转为「${TOPIC_STATUS_LABEL[t]}」`)}
            className="rounded-sm border border-line px-2.5 py-1 text-xs text-text-2 hover:border-accent hover:text-text-1 disabled:opacity-50"
          >
            {t === "published" ? "标记发布" : t === "drafted" ? "撤回合成态" : "回到收集"}
          </button>
        ))}
      </div>
      {msg && (
        <span className={`text-[11px] ${msg.tone === "ok" ? "text-green" : "text-red"}`}>
          {msg.text}
        </span>
      )}
    </div>
  );
}
