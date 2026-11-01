"use client";

/**
 * 领域词表 CRUD 段(M54 批D,洞察·发现?t=taxonomy):分类器 Choice 与洞察页
 * 领域 chips 的唯一真相源管理。行内启停(PUT enabled)/label·排序行内编辑
 * (PUT;key 禁改)/删除(DELETE,在用守卫 409 人话透出,建议停用替代);
 * 新建(kind=key/label/parent/sortOrder,子域必选启用领域)。行数据由服务端
 * 页签注水,变更后 router.refresh 重取;409/400 报文直显零转译。
 */
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";

import type { TaxonomyRow } from "@/lib/insight/taxonomy";
import type { ApiEnvelope } from "@/lib/http/response";

type Msg = { tone: "ok" | "err"; text: string } | null;

const KEY_RE = /^[a-z][a-z0-9-]{1,28}$/;

/** 启用领域键(子域 parent 下拉与校验共用;停用领域不得挂新子域) */
function enabledDomains(rows: TaxonomyRow[]): TaxonomyRow[] {
  return rows.filter((r) => r.kind === "domain" && r.enabled);
}

export default function TaxonomyManager({ rows }: { rows: TaxonomyRow[] }): React.ReactElement {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<Msg>(null);
  // 新建表单
  const [kind, setKind] = useState<"domain" | "subdomain">("domain");
  const [key, setKey] = useState("");
  const [label, setLabel] = useState("");
  const [parent, setParent] = useState("");
  const [sortOrder, setSortOrder] = useState("");
  // 行内编辑(label+sortOrder 同时编辑;key 禁改)
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editLabel, setEditLabel] = useState("");
  const [editOrder, setEditOrder] = useState("");

  const domains = useMemo(() => enabledDomains(rows), [rows]);
  const domainLabel = useMemo(
    () => new Map(rows.filter((r) => r.kind === "domain").map((r) => [r.key, r.label])),
    [rows],
  );

  async function send(
    url: string,
    method: string,
    body?: unknown,
  ): Promise<{ ok: boolean; message: string }> {
    const res = await fetch(url, {
      method,
      headers: body === undefined ? undefined : { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const env = (await res.json().catch(() => null)) as ApiEnvelope<unknown> | null;
    if (!res.ok || !env || env.code !== 0) {
      return { ok: false, message: env?.message || `请求失败(${res.status})` };
    }
    return { ok: true, message: env.message };
  }

  async function run(action: () => Promise<{ ok: boolean; message: string }>): Promise<void> {
    if (busy) return;
    setBusy(true);
    setMsg(null);
    const r = await action();
    setMsg({ tone: r.ok ? "ok" : "err", text: r.message });
    if (r.ok) router.refresh();
    setBusy(false);
  }

  function submitNew(): void {
    const k = key.trim();
    if (k === "" || label.trim() === "") {
      setMsg({ tone: "err", text: "key 与名称必填" });
      return;
    }
    if (!KEY_RE.test(k)) {
      setMsg({ tone: "err", text: "key 须小写字母开头,2-29 位小写字母/数字/连字符" });
      return;
    }
    if (kind === "subdomain" && parent === "") {
      setMsg({ tone: "err", text: "子域必选所属领域" });
      return;
    }
    void run(async () => {
      const r = await send("/api/insight/taxonomy", "POST", {
        kind,
        key: k,
        label: label.trim(),
        parent: kind === "subdomain" ? parent : null,
        sortOrder: sortOrder.trim() === "" ? undefined : Number(sortOrder),
      });
      if (r.ok) {
        setKey("");
        setLabel("");
        setSortOrder("");
      }
      return r;
    });
  }

  function startEdit(row: TaxonomyRow): void {
    setEditingId(row.id);
    setEditLabel(row.label);
    setEditOrder(String(row.sortOrder));
    setMsg(null);
  }

  function saveEdit(id: number): void {
    void run(async () => {
      const r = await send(`/api/insight/taxonomy/${id}`, "PUT", {
        label: editLabel.trim(),
        sortOrder: Number(editOrder),
      });
      if (r.ok) setEditingId(null);
      return r;
    });
  }

  return (
    <div className="flex flex-col gap-3">
      <div>
        <h2 className="text-base font-semibold">领域词表</h2>
        <p className="mt-0.5 text-xs text-text-3">
          洞察分类器与领域 chips 的唯一真相源 · 停用即退出分类与视图(存量引用保留)·
          被信号/簇引用的行禁删,请用停用替代
        </p>
      </div>

      {/* 新建行:kind 切换决定 parent 槽位 */}
      <div className="flex flex-wrap items-center gap-1.5 rounded-md border border-line bg-panel px-4 py-2.5">
        <select
          value={kind}
          onChange={(e) => setKind(e.target.value as "domain" | "subdomain")}
          className="rounded-sm border border-line bg-panel-2 px-2 py-1 text-xs"
          aria-label="词表类型"
        >
          <option value="domain">领域</option>
          <option value="subdomain">子域</option>
        </select>
        <input
          value={key}
          onChange={(e) => setKey(e.target.value)}
          placeholder="key(如 finance)"
          className="w-36 rounded-sm border border-line bg-panel-2 px-2 py-1 font-mono text-xs outline-none focus:border-accent"
        />
        <input
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          placeholder="名称(如 金融)"
          className="w-32 rounded-sm border border-line bg-panel-2 px-2 py-1 text-xs outline-none focus:border-accent"
        />
        {kind === "subdomain" && (
          <select
            value={parent}
            onChange={(e) => setParent(e.target.value)}
            className="rounded-sm border border-line bg-panel-2 px-2 py-1 text-xs"
            aria-label="所属领域"
          >
            <option value="">所属领域…</option>
            {domains.map((d) => (
              <option key={d.key} value={d.key}>
                {d.label}
              </option>
            ))}
          </select>
        )}
        <input
          value={sortOrder}
          onChange={(e) => setSortOrder(e.target.value.replace(/[^\d-]/g, ""))}
          placeholder="排序"
          className="w-16 rounded-sm border border-line bg-panel-2 px-2 py-1 font-mono text-xs outline-none focus:border-accent"
        />
        <button
          type="button"
          onClick={submitNew}
          disabled={busy}
          className="rounded-sm bg-accent px-3 py-1 text-xs font-medium text-[color:var(--accent-contrast)] hover:opacity-90 disabled:opacity-50"
        >
          添加
        </button>
        {msg !== null && (
          <span className={`text-xs ${msg.tone === "ok" ? "text-green" : "text-red"}`}>
            {msg.text}
          </span>
        )}
      </div>

      <div className="overflow-x-auto rounded-md border border-line bg-panel">
        <table className="w-full min-w-[560px] text-left text-[13px]">
          <thead>
            <tr className="border-b border-line bg-panel-2 text-[11px] text-text-3">
              <th className="px-4 py-2 font-medium">类型</th>
              <th className="px-2 py-2 font-medium">key</th>
              <th className="px-2 py-2 font-medium">名称</th>
              <th className="px-2 py-2 font-medium">排序</th>
              <th className="px-2 py-2 font-medium">状态</th>
              <th className="px-2 py-2 font-medium">操作</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const editing = editingId === r.id;
              return (
                <tr
                  key={r.id}
                  className={`border-b border-line/60 last:border-0 ${r.enabled ? "" : "opacity-50"}`}
                >
                  <td className="px-4 py-2 text-xs text-text-2">
                    {r.kind === "domain" ? (
                      "领域"
                    ) : (
                      <span className="text-text-3">
                        ↳ {domainLabel.get(r.parent ?? "") ?? r.parent}
                      </span>
                    )}
                  </td>
                  <td className="px-2 py-2 font-mono text-xs">{r.key}</td>
                  <td className="px-2 py-2">
                    {editing ? (
                      <input
                        value={editLabel}
                        onChange={(e) => setEditLabel(e.target.value)}
                        className="w-28 rounded-sm border border-accent bg-panel-2 px-1.5 py-0.5 text-[13px] outline-none"
                      />
                    ) : (
                      r.label
                    )}
                  </td>
                  <td className="px-2 py-2">
                    {editing ? (
                      <input
                        value={editOrder}
                        onChange={(e) => setEditOrder(e.target.value.replace(/[^\d-]/g, ""))}
                        className="w-14 rounded-sm border border-accent bg-panel-2 px-1.5 py-0.5 font-mono text-xs outline-none"
                      />
                    ) : (
                      <span className="font-mono text-xs text-text-3">{r.sortOrder}</span>
                    )}
                  </td>
                  <td className="px-2 py-2">
                    <button
                      type="button"
                      disabled={busy || editing}
                      onClick={() =>
                        void run(() =>
                          send(`/api/insight/taxonomy/${r.id}`, "PUT", { enabled: !r.enabled }),
                        )
                      }
                      className={`rounded-sm px-2 py-0.5 text-[11px] ${
                        r.enabled
                          ? "bg-green/12 text-green"
                          : "bg-panel-2 text-text-3 hover:text-text-1"
                      } disabled:opacity-50`}
                    >
                      {r.enabled ? "启用" : "停用"}
                    </button>
                  </td>
                  <td className="px-2 py-2">
                    <div className="flex items-center gap-1.5 text-xs">
                      {editing ? (
                        <>
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => saveEdit(r.id)}
                            className="text-accent hover:underline disabled:opacity-50"
                          >
                            保存
                          </button>
                          <button
                            type="button"
                            onClick={() => setEditingId(null)}
                            className="text-text-3 hover:text-text-1"
                          >
                            取消
                          </button>
                        </>
                      ) : (
                        <>
                          <button
                            type="button"
                            onClick={() => startEdit(r)}
                            className="text-text-2 hover:text-text-1"
                          >
                            改
                          </button>
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => {
                              if (!window.confirm(`删除「${r.label}」?被引用行会被拒绝(建议停用)`))
                                return;
                              void run(() => send(`/api/insight/taxonomy/${r.id}`, "DELETE"));
                            }}
                            className="text-text-3 hover:text-red disabled:opacity-50"
                          >
                            删
                          </button>
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
