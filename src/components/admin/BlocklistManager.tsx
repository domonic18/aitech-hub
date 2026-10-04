"use client";

/**
 * 屏蔽词管理岛(M7 批④):添加(scope 三选)+ 行内启停/删除。
 * 停用词只影响新条目准入,已在库条目不回溯。
 */
import { useRouter } from "next/navigation";
import { useState } from "react";

import { BLOCKLIST_SCOPES } from "@/lib/telegram/constants";
import type { ApiEnvelope } from "@/lib/http/response";

const SCOPE_LABELS: Record<string, string> = { title: "标题", summary: "摘要", all: "全部" };

export default function BlocklistManager({
  words,
}: {
  words: Array<{
    id: number;
    word: string;
    scope: string;
    hitCount: number;
    enabled: boolean;
  }>;
}) {
  const router = useRouter();
  const [word, setWord] = useState("");
  const [scope, setScope] = useState<string>("all");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function send(method: string, path: string, body?: Record<string, unknown>): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(path, {
        method,
        headers: body === undefined ? undefined : { "content-type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      const resp = (await res.json()) as ApiEnvelope;
      if (resp.code !== 0) {
        setError(resp.message || `HTTP ${res.status}`);
        return;
      }
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  const add = async (): Promise<void> => {
    await send("POST", "/api/blocklist", { word: word.trim(), scope });
    setWord("");
  };

  return (
    <div className="rounded-md border border-line bg-panel">
      <div className="flex items-center justify-between border-b border-line px-4 py-3">
        <h3 className="text-sm font-semibold">屏蔽词(命中不入流,以 hidden 落库供观测)</h3>
        <div className="flex items-center gap-2">
          <input
            value={word}
            onChange={(e) => setWord(e.target.value)}
            maxLength={100}
            placeholder="新增屏蔽词…"
            className="w-44 rounded-sm border border-line bg-panel-2 px-2.5 py-1.5 text-xs outline-none focus:border-accent"
          />
          <select
            value={scope}
            onChange={(e) => setScope(e.target.value)}
            className="rounded-sm border border-line bg-panel-2 px-2 py-1.5 text-xs outline-none focus:border-accent"
          >
            {BLOCKLIST_SCOPES.map((s) => (
              <option key={s} value={s}>
                {SCOPE_LABELS[s] ?? s}
              </option>
            ))}
          </select>
          <button
            type="button"
            disabled={busy || word.trim() === ""}
            onClick={() => void add()}
            className="rounded-sm bg-accent px-3 py-1.5 text-xs font-medium text-white hover:bg-accent-hover disabled:opacity-50"
          >
            添加
          </button>
        </div>
      </div>
      {error && <p className="px-4 pt-2 font-mono text-xs text-red">{error}</p>}
      <table className="w-full text-left text-[13px]">
        <thead>
          <tr className="border-b border-line text-xs text-text-3">
            <th className="px-4 py-2 font-medium">词</th>
            <th className="px-3 py-2 font-medium">范围</th>
            <th className="px-3 py-2 font-medium">命中</th>
            <th className="px-3 py-2 font-medium">状态</th>
            <th className="px-4 py-2 text-right font-medium">操作</th>
          </tr>
        </thead>
        <tbody>
          {words.map((w) => (
            <tr key={w.id} className="border-b border-line last:border-b-0 hover:bg-panel-2">
              <td className="px-4 py-2 font-medium text-text-1">{w.word}</td>
              <td className="px-3 py-2 text-xs text-text-2">{SCOPE_LABELS[w.scope] ?? w.scope}</td>
              <td className="px-3 py-2 font-mono text-xs text-text-2">{w.hitCount}</td>
              <td className="px-3 py-2">
                {w.enabled ? (
                  <span className="rounded-sm bg-green/10 px-1.5 py-px text-[10px] text-green">
                    启用
                  </span>
                ) : (
                  <span className="rounded-sm bg-panel-2 px-1.5 py-px text-[10px] text-text-3">
                    停用
                  </span>
                )}
              </td>
              <td className="px-4 py-2 text-right">
                <button
                  type="button"
                  disabled={busy}
                  onClick={() =>
                    void send("PUT", `/api/blocklist/${w.id}`, { enabled: !w.enabled })
                  }
                  className="mr-1 cursor-pointer rounded-sm px-2 py-1 text-xs text-accent hover:bg-accent-dim disabled:opacity-50"
                >
                  {w.enabled ? "停用" : "启用"}
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void send("DELETE", `/api/blocklist/${w.id}`)}
                  className="cursor-pointer rounded-sm px-2 py-1 text-xs text-red hover:bg-red/10 disabled:opacity-50"
                >
                  删除
                </button>
              </td>
            </tr>
          ))}
          {words.length === 0 && (
            <tr>
              <td colSpan={5} className="px-4 py-6 text-center text-xs text-text-3">
                词表为空;一期另有代码级启发式(广告导流/标题党/乱码)兜底
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
