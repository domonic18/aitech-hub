"use client";

/**
 * Agent skill 台账表(M30 批①):key/场景/启停/编辑;agent 侧经批② 工具
 * 渐进披露取用,后台建改即时生效零发版。
 */
import { useRouter } from "next/navigation";
import { useState } from "react";

import { formatCnDate } from "@/lib/datetime";
import type { AgentSkillRow } from "@/lib/ai/agent-skills-admin";
import type { ApiEnvelope } from "@/lib/http/response";

import SkillDialog from "./SkillDialog";

const opLink = "cursor-pointer text-xs text-text-2 hover:text-accent disabled:opacity-50";

function Row({ skill }: { skill: AgentSkillRow }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function call(url: string, init: RequestInit): Promise<void> {
    setBusy(true);
    try {
      const res = await fetch(url, init);
      const body = (await res.json()) as ApiEnvelope;
      if (body.code !== 0) alert(body.message || `HTTP ${res.status}`);
      router.refresh();
    } catch (e) {
      alert(String(e));
    } finally {
      setBusy(false);
    }
  }

  const toggleEnabled = (): void => {
    void call(`/api/agent-skills/${skill.id}/status`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ enabled: !skill.enabled }),
    });
  };

  const remove = (): void => {
    if (!confirm(`确认删除技能「${skill.name}」(${skill.key})?引用它的专题将回落为无 skill。`))
      return;
    void call(`/api/agent-skills/${skill.id}`, { method: "DELETE" });
  };

  return (
    <tr
      className={`border-b border-line last:border-b-0 hover:bg-panel-2 ${skill.enabled ? "" : "opacity-60"}`}
    >
      <td className="px-4 py-2.5">
        <div className="font-mono text-[12px] text-text-1">{skill.key}</div>
        <div className="mt-0.5 text-[11px] text-text-3">{formatCnDate(skill.updatedAt)} 更新</div>
      </td>
      <td className="px-3 py-2.5 font-medium text-text-1">{skill.name}</td>
      <td className="px-3 py-2.5 text-xs text-text-2">{skill.scenario}</td>
      <td className="px-3 py-2.5 font-mono text-[11px] text-text-3" title="markdown 字符数">
        {[...skill.guideMd].length}
      </td>
      <td className="px-3 py-2.5">
        <button
          type="button"
          role="switch"
          aria-checked={skill.enabled}
          aria-label={`启用 ${skill.name}`}
          disabled={busy}
          onClick={toggleEnabled}
          className={`relative h-[18px] w-8 cursor-pointer rounded-full transition-colors disabled:opacity-50 ${
            skill.enabled ? "bg-accent" : "border border-line bg-panel-2"
          }`}
        >
          <span
            className={`absolute top-[2px] h-3.5 w-3.5 rounded-full bg-white transition-all ${
              skill.enabled ? "left-[16px]" : "left-[2px]"
            }`}
          />
        </button>
      </td>
      <td className="px-4 py-2.5 text-right">
        <div className="flex justify-end gap-2.5">
          <SkillDialog label="编辑" skill={skill} buttonClass={opLink} />
          <button
            type="button"
            disabled={busy}
            onClick={remove}
            className="cursor-pointer text-xs text-red hover:opacity-80 disabled:opacity-50"
          >
            删除
          </button>
        </div>
      </td>
    </tr>
  );
}

export default function SkillTable({ skills }: { skills: AgentSkillRow[] }) {
  return (
    <div className="overflow-x-auto rounded-md border border-line bg-panel">
      <table className="w-full text-left text-[13px]">
        <thead>
          <tr className="border-b border-line bg-panel-2 text-xs text-text-2">
            <th className="px-4 py-2.5 font-medium">key</th>
            <th className="px-3 py-2.5 font-medium">名称</th>
            <th className="px-3 py-2.5 font-medium">适用场景</th>
            <th className="px-3 py-2.5 font-medium">指南字数</th>
            <th className="px-3 py-2.5 font-medium">启用</th>
            <th className="px-4 py-2.5 text-right font-medium">操作</th>
          </tr>
        </thead>
        <tbody>
          {skills.map((s) => (
            <Row key={s.id} skill={s} />
          ))}
          {skills.length === 0 && (
            <tr>
              <td colSpan={6} className="px-4 py-10 text-center text-xs text-text-3">
                还没有技能,点右上角「新增技能」沉淀第一份流程纪律
              </td>
            </tr>
          )}
        </tbody>
      </table>
      <div className="border-t border-line px-4 py-2.5 font-mono text-[11px] text-text-3">
        GET/POST /api/agent-skills · PUT/DELETE /api/agent-skills/[id] · PUT
        /api/agent-skills/[id]/status — key 建后不可改;停用/删除即时生效,agent 侧经工具渐进披露取用
      </div>
    </div>
  );
}
