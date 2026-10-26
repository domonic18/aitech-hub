"use client";

/**
 * 导出队列面板(M14 批⑤):勾选模板逐行状态(pending/running/done/failed)
 * + 一键导出按钮;选中集由勾选态派生,状态字典由弹窗 generate() 推进。
 */

/** 行级导出状态 */
export type QueueState = "pending" | "running" | "done" | "failed";

import { COVER_TEMPLATES } from "./templates";

const STATE_LABEL: Record<QueueState, { text: string; cls: string }> = {
  done: { text: "已导出", cls: "bg-green/10 text-green" },
  failed: { text: "失败", cls: "bg-red/10 text-red" },
  running: { text: "处理中", cls: "bg-amber/10 text-amber" },
  pending: { text: "待导出", cls: "bg-panel-2 text-text-3" },
};

export default function CoverExportQueue({
  checked,
  queue,
  busy,
  canGenerate,
  onGenerate,
}: {
  checked: Set<string>;
  /** 模板 key → 行级状态(generate 推进;换源清空) */
  queue: Record<string, QueueState>;
  busy: boolean;
  /** 已有有效裁剪选区(未裁剪时导出不可用) */
  canGenerate: boolean;
  onGenerate: () => void;
}): React.ReactElement {
  const templates = COVER_TEMPLATES.filter((t) => checked.has(t.key));
  return (
    <>
      <div className="text-xs font-medium text-text-2">导出队列</div>
      <ul className="mt-2 flex flex-col gap-1.5">
        {templates.map((t) => {
          const st = queue[t.key];
          const meta = STATE_LABEL[st ?? "pending"];
          return (
            <li key={t.key} className="flex items-center gap-2 text-[11px]">
              <span
                className={`w-14 flex-none rounded-sm px-1 py-px text-center text-[10px] ${meta.cls}`}
              >
                {meta.text}
              </span>
              <span className="min-w-0 flex-1 truncate text-text-2">{t.label}</span>
              <span className="flex-none font-mono text-text-3">
                {t.w}×{t.h}
              </span>
            </li>
          );
        })}
        {templates.length === 0 && <li className="text-[11px] text-text-3">未勾选任何模板</li>}
      </ul>
      <button
        type="button"
        disabled={busy || templates.length === 0 || !canGenerate}
        onClick={onGenerate}
        className="mt-3 w-full cursor-pointer rounded-sm bg-accent px-3 py-2 text-xs font-medium text-white hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-60"
      >
        {busy ? "导出上传中…" : `⤓ 按模板一键导出 ${templates.length} 尺寸`}
      </button>
    </>
  );
}
