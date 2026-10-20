"use client";

/**
 * 专题定位编辑 + 人工状态流转(M26 批③治理台;2026-10-18 体裁治理收编):
 * 撰写目的下拉取代「绑定技能」下拉(目的=定位模板+合成话术体裁词,落库走
 * positioning,技能一律自动匹配);定位 textarea 降级为备注;关联文章 id 改
 * 只读展示;标题可改(PATCH /api/topics/[id])。
 * 2026-10-20 验收反馈问题三重排:① 状态徽章上移流程条(TopicStatusStepper),
 * 本件不再重复渲染;② 状态钮按「当前态→目标态」语义命名(「回到收集」→
 * 「撤销合成(回素材收集)」),回退类操作弹确认并写明后果(关联文档保留等),
 * 前向标记发布不弹;③ 当前态语义一行说明(这一步意味着什么、下一步做什么),
 * 状态钮组独立成行,不再与元信息编辑混排。
 */
import { useState } from "react";
import { useRouter } from "next/navigation";

import { matchTopicPurpose, TOPIC_PURPOSES, type TopicPurposeKey } from "@/lib/topics/constants";
import {
  MANUAL_STATUS_TARGETS,
  type TopicStatus,
  TOPIC_STATUS_LABEL,
} from "@/lib/topics/constants";
import type { ApiEnvelope } from "@/lib/http/response";

/** 当前态语义说明(状态可视化:这一步意味着什么、下一步做什么) */
const STATUS_HINT: Record<TopicStatus, string> = {
  collecting: "素材收集中:挂视频/文章素材、写批注,攒够 2~3 条解读即可去「合成」区出稿。",
  drafted: "已合成:关联文档已生成,建议进文档人工定稿后发布;补了素材可回来重新合成。",
  published: "已发布:关联文章前台可见,可到文档编辑页同步公众号草稿。",
};

/** 状态钮语义命名(按目标态;人工迁移目标只有这三个方向) */
function statusAction(target: TopicStatus): { label: string; confirm: string | null } {
  switch (target) {
    case "collecting":
      return {
        label: "撤销合成(回素材收集)",
        confirm:
          "撤销合成会把专题回退到「收集中」:关联文档保留不动,可继续挂素材,重新合成时会覆盖文档。确认回退?",
      };
    case "drafted":
      return {
        label: "撤回发布(回已合成)",
        confirm:
          "撤回发布只回退专题状态,关联文章本身不变(如需下架文章请到文档编辑页操作)。确认回退?",
      };
    case "published":
      return { label: "标记发布", confirm: null };
  }
}

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

  /** 状态流转:回退类先确认(写明后果),取消即不动 */
  async function changeStatus(target: TopicStatus): Promise<void> {
    const { confirm: hint } = statusAction(target);
    if (hint && !window.confirm(hint)) return;
    await patch({ status: target }, `已流转为「${TOPIC_STATUS_LABEL[target]}」`);
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
    <div className="flex flex-col gap-3 rounded-sm border border-line bg-panel p-3">
      <input
        value={titleDraft}
        maxLength={200}
        onChange={(e) => setTitleDraft(e.target.value)}
        className="rounded-sm border border-line bg-panel px-2.5 py-1.5 text-[14px] font-medium outline-none focus:border-accent"
        aria-label="专题标题"
        placeholder="专题标题…"
      />
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
          className="ml-auto rounded-sm bg-accent px-3 py-1 text-xs font-medium text-[color:var(--accent-contrast)] hover:opacity-90 disabled:opacity-50"
        >
          保存
        </button>
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
      {/* 状态操作区:当前态语义一行 + 语义化流转钮(回退弹确认写后果) */}
      <div className="flex flex-col gap-1.5 border-t border-line pt-2.5">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[11px] font-semibold text-text-3">状态操作</span>
          <span className="text-[11px] text-text-2">{STATUS_HINT[status as TopicStatus]}</span>
        </div>
        <div className="flex flex-wrap gap-2">
          {targets.map((t) => {
            const { label } = statusAction(t);
            return (
              <button
                key={t}
                type="button"
                disabled={busy}
                onClick={() => void changeStatus(t)}
                title={`流转到「${TOPIC_STATUS_LABEL[t]}」`}
                className="rounded-sm border border-line px-2.5 py-1 text-xs text-text-2 hover:border-accent hover:text-text-1 disabled:opacity-50"
              >
                {label}
              </button>
            );
          })}
          {targets.length === 0 && (
            <span className="text-[11px] text-text-3">当前状态无人工流转出口</span>
          )}
        </div>
      </div>
      {msg && (
        <span className={`text-[11px] ${msg.tone === "ok" ? "text-green" : "text-red"}`}>
          {msg.text}
        </span>
      )}
    </div>
  );
}
