"use client";

/**
 * Coding Plan 套餐策展台(M55 批A,/admin/pricing 下半区):额度口径按官方
 * 原文呈现不归一;峰/谷倍率分字段存。新建(缺省 pending)/ 行内启停 / 全字段
 * 行内编辑 / 删除。变更走 /api/pricing/plans,router.refresh 重取。
 */
import { useState } from "react";
import { useRouter } from "next/navigation";

import type { CodingPlanRow } from "@/lib/pricing/admin";
import type { ApiEnvelope } from "@/lib/http/response";

type Msg = { tone: "ok" | "err"; text: string } | null;

const STATUS_LABELS: Record<string, string> = {
  pending: "待审",
  enabled: "已发布",
  disabled: "停用",
};

const input =
  "rounded-sm border border-line bg-panel-2 px-2 py-1 text-xs outline-none focus:border-accent";

type PlanForm = {
  vendor: string;
  planName: string;
  currency: string;
  monthlyFee: string;
  quotaDesc: string;
  peakRate: string;
  offPeakRate: string;
  bestFor: string;
  dataAsOf: string;
  sourceUrl: string;
};

const EMPTY_FORM: PlanForm = {
  vendor: "",
  planName: "",
  currency: "CNY",
  monthlyFee: "",
  quotaDesc: "",
  peakRate: "",
  offPeakRate: "",
  bestFor: "",
  dataAsOf: "",
  sourceUrl: "",
};

export default function PlansBoard({ rows }: { rows: CodingPlanRow[] }): React.ReactElement {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<Msg>(null);
  const [form, setForm] = useState<PlanForm>(EMPTY_FORM);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [edit, setEdit] = useState<PlanForm>(EMPTY_FORM);

  async function send(
    url: string,
    method: string,
    body?: unknown,
  ): Promise<ApiEnvelope<unknown> | null> {
    const res = await fetch(url, {
      method,
      headers: body === undefined ? undefined : { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return (await res.json().catch(() => null)) as ApiEnvelope<unknown> | null;
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

  function payload(f: PlanForm): Record<string, unknown> {
    return {
      vendor: f.vendor.trim(),
      planName: f.planName.trim(),
      currency: f.currency,
      monthlyFee: f.monthlyFee === "" ? null : Number(f.monthlyFee),
      quotaDesc: f.quotaDesc.trim(),
      peakRate: f.peakRate.trim() === "" ? null : f.peakRate.trim(),
      offPeakRate: f.offPeakRate.trim() === "" ? null : f.offPeakRate.trim(),
      bestFor: f.bestFor.trim() === "" ? null : f.bestFor.trim(),
      dataAsOf: f.dataAsOf,
      sourceUrl: f.sourceUrl.trim(),
    };
  }

  function submitNew(): void {
    if (
      form.vendor.trim() === "" ||
      form.planName.trim() === "" ||
      form.quotaDesc.trim() === "" ||
      form.dataAsOf === "" ||
      form.sourceUrl.trim() === ""
    ) {
      setMsg({ tone: "err", text: "厂商 / 套餐名 / 额度口径 / 数据截至 / 来源链接 必填" });
      return;
    }
    void run(async () => {
      const env = await send("/api/pricing/plans", "POST", payload(form));
      if (env?.code === 0) setForm(EMPTY_FORM);
      return {
        ok: (env?.code ?? 1) === 0,
        message: env?.code === 0 ? "已新建(待审)" : (env?.message ?? "新建失败"),
      };
    });
  }

  function startEdit(row: CodingPlanRow): void {
    setEditingId(row.id);
    setEdit({
      vendor: row.vendor,
      planName: row.planName,
      currency: row.currency,
      monthlyFee: row.monthlyFee === null ? "" : String(row.monthlyFee),
      quotaDesc: row.quotaDesc,
      peakRate: row.peakRate ?? "",
      offPeakRate: row.offPeakRate ?? "",
      bestFor: row.bestFor ?? "",
      dataAsOf: row.dataAsOf,
      sourceUrl: row.sourceUrl,
    });
    setMsg(null);
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold">Coding Plan 套餐</h3>
        <span className="text-[11px] text-text-3">
          {rows.filter((r) => r.status === "enabled").length} 已发布 ·{" "}
          {rows.filter((r) => r.status === "pending").length} 待审 · 额度口径按官方原文呈现
        </span>
      </div>

      <div className="grid grid-cols-2 gap-1.5 rounded-md border border-line bg-panel px-4 py-3 sm:grid-cols-4 lg:grid-cols-5">
        <input
          value={form.vendor}
          onChange={(e) => setForm({ ...form, vendor: e.target.value })}
          placeholder="厂商 *"
          className={input}
        />
        <input
          value={form.planName}
          onChange={(e) => setForm({ ...form, planName: e.target.value })}
          placeholder="套餐名 * (如 GLM Coding Plan · Lite)"
          className={`${input} lg:col-span-2`}
        />
        <select
          value={form.currency}
          onChange={(e) => setForm({ ...form, currency: e.target.value })}
          className={input}
          aria-label="币种"
        >
          <option value="CNY">¥ CNY</option>
          <option value="USD">$ USD</option>
        </select>
        <input
          value={form.monthlyFee}
          onChange={(e) => setForm({ ...form, monthlyFee: e.target.value })}
          placeholder="月费"
          className={input}
          inputMode="decimal"
        />
        <input
          value={form.quotaDesc}
          onChange={(e) => setForm({ ...form, quotaDesc: e.target.value })}
          placeholder="额度口径 * (官方原文,如 GLM-4.6:120 prompts / 5h)"
          className={`${input} col-span-2 lg:col-span-2`}
        />
        <input
          value={form.peakRate}
          onChange={(e) => setForm({ ...form, peakRate: e.target.value })}
          placeholder="高峰倍率(如 峰 1×)"
          className={input}
        />
        <input
          value={form.offPeakRate}
          onChange={(e) => setForm({ ...form, offPeakRate: e.target.value })}
          placeholder="闲时倍率(如 谷 0.5×)"
          className={input}
        />
        <input
          value={form.bestFor}
          onChange={(e) => setForm({ ...form, bestFor: e.target.value })}
          placeholder="适合(如 个人日常)"
          className={input}
        />
        <input
          type="date"
          value={form.dataAsOf}
          onChange={(e) => setForm({ ...form, dataAsOf: e.target.value })}
          className={input}
          aria-label="数据截至"
        />
        <input
          value={form.sourceUrl}
          onChange={(e) => setForm({ ...form, sourceUrl: e.target.value })}
          placeholder="来源链接 * (https://…)"
          className={`${input} lg:col-span-2`}
        />
        <button
          type="button"
          onClick={submitNew}
          disabled={busy}
          className="rounded-sm bg-accent px-3 py-1 text-xs font-medium text-[color:var(--accent-contrast)] hover:opacity-90 disabled:opacity-50"
        >
          添加(待审)
        </button>
        {msg !== null && (
          <span
            className={`col-span-full text-xs ${msg.tone === "ok" ? "text-green" : "text-red"}`}
          >
            {msg.text}
          </span>
        )}
      </div>

      <div className="overflow-x-auto rounded-md border border-line bg-panel">
        <table className="w-full min-w-[860px] text-left text-[13px]">
          <thead>
            <tr className="border-b border-line bg-panel-2 text-[11px] text-text-3">
              <th className="px-4 py-2 font-medium">套餐 / 厂商</th>
              <th className="px-2 py-2 font-medium">月费</th>
              <th className="px-2 py-2 font-medium">额度口径</th>
              <th className="px-2 py-2 font-medium">时段扣费</th>
              <th className="px-2 py-2 font-medium">适合</th>
              <th className="px-2 py-2 font-medium">截至</th>
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
                  className={`border-b border-line/60 last:border-0 ${r.status === "pending" ? "opacity-60" : ""}`}
                >
                  <td className="px-4 py-2">
                    <div className="font-mono text-xs text-text-1">{r.planName}</div>
                    <div className="text-[11px] text-text-3">{r.vendor}</div>
                  </td>
                  <td className="px-2 py-2 font-mono text-xs">
                    {r.monthlyFee === null
                      ? "—"
                      : `${r.currency === "USD" ? "$" : "¥"} ${r.monthlyFee}`}
                  </td>
                  {editing ? (
                    <>
                      <td className="px-2 py-2" colSpan={3}>
                        <div className="flex flex-wrap gap-1">
                          <input
                            value={edit.quotaDesc}
                            onChange={(e) => setEdit({ ...edit, quotaDesc: e.target.value })}
                            className={`${input} w-56`}
                            placeholder="额度口径"
                          />
                          <input
                            value={edit.peakRate}
                            onChange={(e) => setEdit({ ...edit, peakRate: e.target.value })}
                            className={`${input} w-24`}
                            placeholder="峰倍率"
                          />
                          <input
                            value={edit.offPeakRate}
                            onChange={(e) => setEdit({ ...edit, offPeakRate: e.target.value })}
                            className={`${input} w-24`}
                            placeholder="谷倍率"
                          />
                          <input
                            value={edit.bestFor}
                            onChange={(e) => setEdit({ ...edit, bestFor: e.target.value })}
                            className={`${input} w-24`}
                            placeholder="适合"
                          />
                          <input
                            value={edit.monthlyFee}
                            onChange={(e) => setEdit({ ...edit, monthlyFee: e.target.value })}
                            className={`${input} w-16`}
                            placeholder="月费"
                          />
                        </div>
                      </td>
                    </>
                  ) : (
                    <>
                      <td className="px-2 py-2 text-xs text-text-2">{r.quotaDesc}</td>
                      <td className="px-2 py-2 font-mono text-xs text-amber">
                        {r.peakRate ?? "—"}
                        {r.offPeakRate !== null && r.offPeakRate !== ""
                          ? ` · ${r.offPeakRate}`
                          : ""}
                      </td>
                      <td className="px-2 py-2 text-xs text-text-2">{r.bestFor ?? "—"}</td>
                    </>
                  )}
                  <td className="px-2 py-2 font-mono text-[11px] text-text-3">{r.dataAsOf}</td>
                  <td className="px-2 py-2">
                    <button
                      type="button"
                      disabled={busy || editing}
                      onClick={() =>
                        void run(async () => {
                          const next = r.status === "enabled" ? "disabled" : "enabled";
                          const env = await send(`/api/pricing/plans/${r.id}`, "PUT", {
                            status: next,
                          });
                          return {
                            ok: (env?.code ?? 1) === 0,
                            message: env?.message ?? "操作失败",
                          };
                        })
                      }
                      className={`rounded-sm px-2 py-0.5 text-[11px] ${
                        r.status === "enabled"
                          ? "bg-green/12 text-green"
                          : r.status === "pending"
                            ? "bg-amber/12 text-amber"
                            : "bg-panel-2 text-text-3 hover:text-text-1"
                      } disabled:opacity-50`}
                    >
                      {STATUS_LABELS[r.status] ?? r.status}
                    </button>
                  </td>
                  <td className="px-2 py-2">
                    <div className="flex items-center gap-1.5 text-xs">
                      {editing ? (
                        <>
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() =>
                              void run(async () => {
                                const env = await send(
                                  `/api/pricing/plans/${r.id}`,
                                  "PUT",
                                  payload(edit),
                                );
                                if (env?.code === 0) setEditingId(null);
                                return {
                                  ok: (env?.code ?? 1) === 0,
                                  message: env?.message ?? "保存失败",
                                };
                              })
                            }
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
                              if (!window.confirm(`删除 ${r.planName}?`)) return;
                              void run(async () => {
                                const env = await send(`/api/pricing/plans/${r.id}`, "DELETE");
                                return {
                                  ok: (env?.code ?? 1) === 0,
                                  message: env?.message ?? "删除失败",
                                };
                              });
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
