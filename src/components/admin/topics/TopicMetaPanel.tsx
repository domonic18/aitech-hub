"use client";

/**
 * 专题定位编辑 + 人工状态流转(M26 批③治理台;2026-10-18 体裁治理收编):
 * 撰写目的下拉取代「绑定技能」下拉(目的=定位模板+合成话术体裁词,落库走
 * positioning,技能一律自动匹配——体裁唯一入口,治 post-319「教程意图无
 * 入口」);定位 textarea 降级为备注(切目的仅在其为空或等于某预置模板时
 * 自动带模板,自定义文案不覆盖);关联文章 id 改只读展示(合成后自动回填);
 * 标题可改(PATCH /api/topics/[id]);状态钮组只出人工迁移目标
 * (MANUAL_STATUS_TARGETS,§10-7 collecting→drafted 仅合成驱动不出钮),流转
 * 失败(如逆跳)行内红字。
 */
import { useState } from "react";
import { useRouter } from "next/navigation";

import { matchTopicPurpose, TOPIC_PURPOSES, type TopicPurposeKey } from "@/lib/topics/constants";
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
  const [purpose, setPurpose] = useState<TopicPurposeKey | null>(() =>
    matchTopicPurpose(positioning),
  );
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: "ok" | "err"; text: string } | null>(null);

  const dirty = titleDraft.trim() !== title || positioningDraft !== (positioning ?? "");

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
      },
      "已保存",
    );
    if (ok && titleDraft.trim() !== title) setTitleDraft(titleDraft.trim());
  }

  /** 切撰写目的:现定位为空或等于某预置模板时自动带入新模板;自定义文案
   * 不覆盖(提示可手改),custom 态下拉保留「自定义」展示项 */
  function switchPurpose(key: TopicPurposeKey): void {
    setPurpose(key);
    const target = TOPIC_PURPOSES.find((t) => t.key === key);
    if (!target) return;
    const cur = positioningDraft.trim();
    if (cur === "" || matchTopicPurpose(cur) !== null) {
      setPositioningDraft(target.positioningTemplate);
    }
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
      <div className="flex flex-wrap items-center gap-2">
        <label className="flex items-center gap-1.5 text-xs text-text-2">
          撰写目的
          <select
            value={purpose ?? "custom"}
            onChange={(e) => {
              if (e.target.value === "custom") return;
              switchPurpose(e.target.value as TopicPurposeKey);
            }}
            className="max-w-56 rounded-sm border border-line bg-panel px-2 py-1 text-[12px] outline-none focus:border-accent"
            aria-label="撰写目的"
          >
            {TOPIC_PURPOSES.map((t) => (
              <option key={t.key} value={t.key}>
                {t.label}
              </option>
            ))}
            {purpose === null && <option value="custom">自定义(保留现文案)</option>}
          </select>
        </label>
        <span className="text-xs text-text-2">关联文章</span>
        {linkedPostId ? (
          <a
            href={`/admin/posts/${linkedPostId}`}
            className="text-xs text-text-2 underline decoration-line hover:text-accent"
          >
            #{linkedPostId}
          </a>
        ) : (
          <span className="text-xs text-text-3">合成后自动回填</span>
        )}
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
      <textarea
        value={positioningDraft}
        maxLength={1000}
        rows={2}
        onChange={(e) => setPositioningDraft(e.target.value)}
        placeholder="定位备注(切撰写目的自动带入模板;可手改选材口吻)…"
        className="rounded-sm border border-line bg-panel px-2.5 py-1.5 text-[13px] outline-none focus:border-accent placeholder:text-text-3"
        aria-label="专题定位"
      />
      {msg && (
        <span className={`text-[11px] ${msg.tone === "ok" ? "text-green" : "text-red"}`}>
          {msg.text}
        </span>
      )}
    </div>
  );
}
