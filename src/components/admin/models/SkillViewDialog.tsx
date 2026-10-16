"use client";

/**
 * Agent skill 只读查看弹窗(2026-10-16 验收反馈问题二:此前正文只能在编辑
 * 弹窗的 textarea 里看,列表无直接查看面)。指南 markdown 源码等宽展示。
 */
import DialogShell from "@/components/admin/DialogShell";

import type { AgentSkillRow } from "@/lib/ai/agent-skills-admin";

export default function SkillViewDialog({
  skill,
  onClose,
}: {
  skill: AgentSkillRow;
  onClose: () => void;
}) {
  return (
    <DialogShell width="2xl" scroll title={`技能指南:${skill.name}(${skill.key})`}>
      <dl className="mt-3 grid grid-cols-[64px_1fr] gap-x-3 gap-y-1.5 text-xs">
        <dt className="text-text-3">适用场景</dt>
        <dd className="text-text-2">{skill.scenario}</dd>
        <dt className="text-text-3">状态</dt>
        <dd className="text-text-2">{skill.enabled ? "启用中(agent 可取用)" : "已停用"}</dd>
      </dl>
      <pre className="mt-3 rounded-md border border-line bg-panel-2 p-3 font-mono text-[12px] leading-[1.8] whitespace-pre-wrap text-text-1">
        {skill.guideMd}
      </pre>
      <div className="mt-4 flex justify-end">
        <button
          type="button"
          onClick={onClose}
          className="cursor-pointer rounded-sm border border-line px-3 py-1.5 text-xs text-text-2 hover:bg-panel-2"
        >
          关闭
        </button>
      </div>
    </DialogShell>
  );
}
