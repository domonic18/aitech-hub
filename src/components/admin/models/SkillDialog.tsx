"use client";

/**
 * Agent skill 新增/编辑弹窗(M30 批①):key 建后不可改(topic.skillKey 与
 * agent 侧稳定引用);guideMd 为 markdown 流程纪律,可引用既有工具名。
 */
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";

import type { AgentSkillRow } from "@/lib/ai/agent-skills-admin";
import { field } from "@/components/admin/form-fields";
import type { ApiEnvelope } from "@/lib/http/response";
import DialogShell, { DialogActions } from "@/components/admin/DialogShell";

export default function SkillDialog({
  label,
  skill,
  buttonClass,
}: {
  label: string;
  skill?: AgentSkillRow;
  buttonClass?: string;
}) {
  const router = useRouter();
  const editing = skill !== undefined;
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [key, setKey] = useState(skill?.key ?? "");
  const [name, setName] = useState(skill?.name ?? "");
  const [scenario, setScenario] = useState(skill?.scenario ?? "");
  const [guideMd, setGuideMd] = useState(skill?.guideMd ?? "");
  const [enabled, setEnabled] = useState(skill?.enabled ?? true);
  const keyRef = useRef<HTMLInputElement>(null);

  const close = (): void => {
    setOpen(false);
    setError(null);
  };

  const submit = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      // 更新 body 不带 key:建后不可改(稳定引用)
      const body = editing
        ? { name, scenario, guideMd, enabled }
        : { key, name, scenario, guideMd, enabled };
      const res = await fetch(editing ? `/api/agent-skills/${skill.id}` : "/api/agent-skills", {
        method: editing ? "PUT" : "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = (await res.json()) as ApiEnvelope;
      if (data.code !== 0) {
        setError(data.message || `HTTP ${res.status}`);
        return;
      }
      close();
      router.refresh();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };

  const canSubmit =
    key.trim() !== "" && name.trim() !== "" && scenario.trim() !== "" && guideMd.trim() !== "";

  return (
    <>
      <button
        type="button"
        onClick={() => {
          setOpen(true);
          setTimeout(() => (editing ? null : keyRef.current?.focus()), 0);
        }}
        className={
          buttonClass ??
          "cursor-pointer rounded-sm bg-accent px-3 py-1.5 text-xs font-medium text-white hover:bg-accent-hover"
        }
      >
        {label}
      </button>
      {open && (
        <DialogShell width="2xl" scroll title={editing ? `编辑技能:${skill.name}` : "新增技能"}>
          <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
            <label className="text-xs text-text-3">
              key *{editing && <span className="text-amber">(建后不可改,agent 稳定引用)</span>}
              <input
                ref={keyRef}
                value={key}
                onChange={(e) => setKey(e.target.value)}
                maxLength={50}
                disabled={editing}
                placeholder="如 blogger-video"
                className={`mt-1 font-mono ${field} ${editing ? "opacity-60" : ""}`}
              />
              <span className="mt-1 block text-[11px] text-text-3">
                小写字母/数字/连字符,开头结尾须为字母或数字
              </span>
            </label>
            <label className="text-xs text-text-3">
              名称 *
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                maxLength={100}
                placeholder="如:博主×视频推荐短文"
                className={`mt-1 ${field}`}
              />
            </label>
          </div>
          <label className="mt-3 block text-xs text-text-3">
            适用场景 * <span className="text-text-3">(一行,供 agent 选 skill 时对号)</span>
            <input
              value={scenario}
              onChange={(e) => setScenario(e.target.value)}
              maxLength={200}
              placeholder="如:公众号「博主×视频」推荐短文(专题合成默认场景)"
              className={`mt-1 ${field}`}
            />
          </label>
          <label className="mt-3 block text-xs text-text-3">
            指南正文 *{" "}
            <span className="text-text-3">(markdown 流程纪律;机械执行归既有工具/管线)</span>
            <textarea
              value={guideMd}
              onChange={(e) => setGuideMd(e.target.value)}
              rows={14}
              spellCheck={false}
              placeholder={"- 开头钩子不超过 80 字:…\n- 结构:…"}
              className={`mt-1 font-mono ${field}`}
            />
          </label>
          <label className="mt-3 flex items-center gap-2 text-xs text-text-2">
            <input
              type="checkbox"
              checked={enabled}
              onChange={(e) => setEnabled(e.target.checked)}
              className="accent-[var(--accent)]"
            />
            启用(停用后 agent 侧列表/取用立即不可见)
          </label>

          {error && <p className="mt-2 font-mono text-xs text-red">{error}</p>}
          <DialogActions>
            <button
              type="button"
              onClick={close}
              className="cursor-pointer rounded-sm border border-line px-3 py-1.5 text-xs text-text-2 hover:bg-panel-2"
            >
              取消
            </button>
            <button
              type="button"
              disabled={busy || !canSubmit}
              onClick={() => void submit()}
              className="cursor-pointer rounded-sm bg-accent px-3 py-1.5 text-xs font-medium text-white hover:bg-accent-hover disabled:opacity-50"
            >
              {busy ? "保存中…" : "保存"}
            </button>
          </DialogActions>
        </DialogShell>
      )}
    </>
  );
}
