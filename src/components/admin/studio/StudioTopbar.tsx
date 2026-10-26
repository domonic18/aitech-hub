"use client";

/**
 * 创作顶栏(v2 工作台重构,自 TopicOverviewPanel 收编):返回 + 行内标题编辑
 * + 状态徽标 + 主意图 chip + 人工流转钮组;第二行当前态语义说明与时间线。
 * 状态机纪律不变:collecting→drafted 仅由生成驱动,API/钮组口径同源
 * (MANUAL_STATUS_TARGETS;回退钮弹确认写后果)。
 */
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

import {
  MANUAL_STATUS_TARGETS,
  TOPIC_STATUS_LABEL,
  type TopicStatus,
} from "@/lib/topics/constants";
import type { ApiEnvelope } from "@/lib/http/response";

/** 当前态语义说明(这一步意味着什么、下一步做什么) */
const STATUS_HINT: Record<TopicStatus, string> = {
  collecting: "素材收集中:添加视频/文章/电报素材、写批注,攒够 2~3 条即可在产出区创作。",
  drafted: "已出稿:长文/贴图已落库,可继续精修或再生成一组;补充素材后可回来重做。",
  published: "已发布:文章前台可见,可到文档编辑页同步公众号草稿。",
};

const STATUS_PILL: Record<TopicStatus, string> = {
  collecting: "bg-amber/12 text-amber-hi",
  drafted: "bg-accent/12 text-accent",
  published: "bg-green/12 text-green",
};

/** 状态钮语义命名(按目标态;人工迁移目标只有这三个方向) */
function statusAction(target: TopicStatus): { label: string; confirm: string | null } {
  switch (target) {
    case "collecting":
      return {
        label: "退回收集素材",
        confirm: "退回后可继续添加素材;已生成的长文与贴图保留不动,重新生成时才会覆盖。确认退回?",
      };
    case "drafted":
      return {
        label: "撤回发布",
        confirm: "只回退创作状态,文章本身不变(下架文章请到文档编辑页操作)。确认撤回?",
      };
    case "published":
      return { label: "标记为已发布", confirm: null };
  }
}

export default function StudioTopbar({
  id,
  title,
  status,
  outputLabel,
  createdAt,
  updatedAt,
}: {
  id: string;
  title: string;
  status: string;
  /** 主意图展示名(长文创作/贴图创作) */
  outputLabel: string;
  createdAt: Date;
  updatedAt: Date;
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

  /**
   * 删除创作(M46 验收补:v2 重构丢失入口):确认写明边界——创作与素材挂载
   * 关系删除;已生成长文/贴图是软引用保留(文档管理/组装台)。成功即回列表。
   */
  async function remove(): Promise<void> {
    if (busy) return;
    if (
      !window.confirm(
        `删除创作《${title}》?素材挂载关系一并删除;已生成的长文与贴图保留(分别到文档管理、组装台查看)。确认删除?`,
      )
    )
      return;
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch(`/api/topics/${id}`, { method: "DELETE" });
      const resp = (await res.json()) as ApiEnvelope;
      if (!res.ok || resp.code !== 0) {
        setMsg({ tone: "err", text: resp.message || `删除失败(${res.status})` });
        return;
      }
      router.push("/admin/studio/");
    } catch {
      setMsg({ tone: "err", text: "网络异常,请重试" });
    } finally {
      setBusy(false);
    }
  }

  const targets = MANUAL_STATUS_TARGETS[status as TopicStatus] ?? [];

  return (
    <div className="mb-3 flex flex-col gap-1.5 rounded-sm border border-line bg-panel px-3 py-2.5">
      <div className="flex flex-wrap items-center gap-2">
        <Link
          href="/admin/studio/"
          className="shrink-0 text-xs text-text-3 hover:text-accent"
          title="返回创作中心列表"
        >
          ← 创作中心
        </Link>
        <span
          className={`rounded-sm px-1.5 py-0.5 text-[11px] font-medium ${STATUS_PILL[status as TopicStatus] ?? ""}`}
        >
          {TOPIC_STATUS_LABEL[status as TopicStatus] ?? status}
        </span>
        <input
          value={titleDraft}
          maxLength={200}
          onChange={(e) => setTitleDraft(e.target.value)}
          onBlur={() => void saveTitle()}
          onKeyDown={(e) => {
            if (e.key === "Enter") void saveTitle();
          }}
          className="min-w-0 flex-1 rounded-sm border border-transparent bg-panel px-1 py-0.5 text-[15px] font-semibold outline-none hover:border-line focus:border-accent"
          aria-label="创作标题"
          placeholder="创作标题…"
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
        <span className="shrink-0 rounded-sm border border-line px-1.5 py-0.5 text-[11px] text-text-2">
          {outputLabel}
        </span>
        {targets.map((t) => {
          const { label } = statusAction(t);
          return (
            <button
              key={t}
              type="button"
              disabled={busy}
              onClick={() => void changeStatus(t)}
              title={`流转到「${TOPIC_STATUS_LABEL[t]}」`}
              className="shrink-0 rounded-sm border border-line px-2 py-0.5 text-[11px] text-text-2 hover:border-accent hover:text-text-1 disabled:opacity-50"
            >
              {label}
            </button>
          );
        })}
        <button
          type="button"
          disabled={busy}
          onClick={() => void remove()}
          title="删除本创作(素材挂载关系一并删除,已生成长文/贴图保留)"
          className="ml-1 shrink-0 rounded-sm border border-line px-2 py-0.5 text-[11px] text-text-3 hover:border-red hover:text-red disabled:opacity-50"
        >
          删除创作
        </button>
      </div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-text-3">
        <span>{STATUS_HINT[status as TopicStatus]}</span>
        <span className="ml-auto">
          创建 {fmt(createdAt)} · 更新 {fmt(updatedAt)}
        </span>
      </div>
      {msg && (
        <span className={`text-[11px] ${msg.tone === "ok" ? "text-green" : "text-red"}`}>
          {msg.text}
        </span>
      )}
    </div>
  );
}
