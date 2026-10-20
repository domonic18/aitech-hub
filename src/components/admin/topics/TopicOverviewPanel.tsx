"use client";

/**
 * 专题概览区(2026-10-20 详情页重构:替代 TopicMetaPanel)——详情页第①区,
 * 回答「这个专题现在到哪一步了、接下来做什么」:状态步进条 + 标题编辑 +
 * 事实行(内容形式/关联文章/各时间点)+ 当前态语义说明与人工流转钮。
 * 写作要求的编辑不在这里(第②区 TopicWritingConfigPanel 单点),本件只读
 * 展示派生出的内容形式,避免双入口。
 */
import { useState } from "react";
import { useRouter } from "next/navigation";

import {
  MANUAL_STATUS_TARGETS,
  TOPIC_STATUS_LABEL,
  type TopicStatus,
} from "@/lib/topics/constants";
import type { ApiEnvelope } from "@/lib/http/response";

import TopicStatusStepper from "./TopicStatusStepper";

/** 当前态语义说明(这一步意味着什么、下一步做什么;与步进条 STEP_HINT 互补) */
const STATUS_HINT: Record<TopicStatus, string> = {
  collecting: "素材收集中:添加视频/文章素材、写批注,攒够 2~3 条即可到「初稿」区生成初稿。",
  drafted: "初稿已生成:建议打开文档人工定稿后发布;补充了素材可回来重新生成。",
  published: "已发布:文章前台可见,可到文档编辑页同步公众号草稿。",
};

/** 状态钮语义命名(按目标态;人工迁移目标只有这三个方向) */
function statusAction(target: TopicStatus): { label: string; confirm: string | null } {
  switch (target) {
    case "collecting":
      return {
        label: "退回收集素材",
        confirm: "退回后可继续添加素材;已生成的初稿文档保留不动,重新生成初稿时会覆盖。确认退回?",
      };
    case "drafted":
      return {
        label: "撤回发布",
        confirm: "只回退专题状态,文章本身不变(下架文章请到文档编辑页操作)。确认撤回?",
      };
    case "published":
      return { label: "标记为已发布", confirm: null };
  }
}

export default function TopicOverviewPanel({
  id,
  title,
  status,
  linkedPostId,
  purposeLabel,
  purposeCustom,
  createdAt,
  updatedAt,
  composedAt,
  publishedAt,
}: {
  id: string;
  title: string;
  status: string;
  linkedPostId: string | null;
  /** 内容形式展示名(服务端 resolvePurpose 由写作要求派生,此处只读) */
  purposeLabel: string;
  purposeCustom: boolean;
  createdAt: Date;
  updatedAt: Date;
  composedAt: Date | null;
  publishedAt: Date | null;
}) {
  const router = useRouter();
  const [titleDraft, setTitleDraft] = useState(title);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: "ok" | "err"; text: string } | null>(null);

  const fmt = (d: Date) =>
    d.toLocaleString("zh-CN", { hour12: false, year: "numeric", month: "2-digit", day: "2-digit" });

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

  async function saveTitle(): Promise<void> {
    const next = titleDraft.trim();
    if (busy || next === "" || next === title) return;
    const ok = await patch({ title: next }, "标题已保存");
    if (ok) setTitleDraft(next);
  }

  /** 状态流转:回退类先确认(写明后果),取消即不动 */
  async function changeStatus(target: TopicStatus): Promise<void> {
    const { confirm: hint } = statusAction(target);
    if (hint && !window.confirm(hint)) return;
    await patch({ status: target }, `已流转为「${TOPIC_STATUS_LABEL[target]}」`);
  }

  const targets = MANUAL_STATUS_TARGETS[status as TopicStatus] ?? [];

  return (
    <div className="flex flex-col gap-3 rounded-sm border border-line bg-panel p-3">
      <TopicStatusStepper status={status} />
      <div className="flex items-center gap-2">
        <input
          value={titleDraft}
          maxLength={200}
          onChange={(e) => setTitleDraft(e.target.value)}
          onBlur={() => void saveTitle()}
          onKeyDown={(e) => {
            if (e.key === "Enter") void saveTitle();
          }}
          className="min-w-0 flex-1 rounded-sm border border-transparent bg-panel px-1 py-0.5 text-[15px] font-semibold outline-none hover:border-line focus:border-accent"
          aria-label="专题标题"
          placeholder="专题标题…"
        />
        {titleDraft.trim() !== title && titleDraft.trim() !== "" && (
          <button
            type="button"
            onClick={() => void saveTitle()}
            disabled={busy}
            className="rounded-sm bg-accent px-3 py-1 text-xs font-medium text-[color:var(--accent-contrast)] hover:opacity-90 disabled:opacity-50"
          >
            保存标题
          </button>
        )}
      </div>
      {/* 事实行:内容形式 + 关联文章 + 时间线(原「定位备注」下方散落的元信息收拢) */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-text-3">
        <span>
          内容形式:<span className="text-text-2">{purposeLabel}</span>
          {purposeCustom && <span className="ml-1 text-amber-hi">(自定义)</span>}
        </span>
        <span>
          关联文章:
          {linkedPostId ? (
            <a
              href={`/admin/posts/${linkedPostId}`}
              className="text-text-2 underline decoration-line hover:text-accent"
            >
              #{linkedPostId}
            </a>
          ) : (
            "生成初稿后自动回填"
          )}
        </span>
        <span>创建 {fmt(createdAt)}</span>
        <span>更新 {fmt(updatedAt)}</span>
        {composedAt && <span>最近生成 {fmt(composedAt)}</span>}
        {publishedAt && <span>文章发布 {fmt(publishedAt)}</span>}
      </div>
      {/* 状态操作:当前态语义一行 + 语义化流转钮(回退弹确认写后果) */}
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
