"use client";

/**
 * Coding Plan 套餐策展板 v2(M56 策展台重构,2026-10-29 验收反馈):
 * 状态页签筛选+搜索(与模型板同构)/ 新建抽屉(周期价:季/年+口径原文、
 * 权益只读随爬虫更新)/ 来源列(官方页↗,验收问题三)/ 行内周期权益
 * details。三规则与周期口径不归一(D3)不变。
 */
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";

import type { CodingPlanRow } from "@/lib/pricing/admin";
import type { ApiEnvelope } from "@/lib/http/response";

import Drawer from "./Drawer";

type Msg = { tone: "ok" | "err"; text: string } | null;
type StatusFilter = "all" | "pending" | "enabled" | "disabled";

const STATUS_LABELS: Record<string, string> = {
  pending: "待审",
  enabled: "已发布",
  disabled: "停用",
};

const FILTERS: ReadonlyArray<{ key: StatusFilter; label: string }> = [
  { key: "all", label: "全部" },
  { key: "pending", label: "待审" },
  { key: "enabled", label: "已发布" },
  { key: "disabled", label: "停用" },
];

const EMPTY_FORM = {
  vendor: "",
  planName: "",
  currency: "CNY",
  monthlyFee: "",
  quarterlyFee: "",
  yearlyFee: "",
  billingNote: "",
  quotaDesc: "",
  peakRate: "",
  offPeakRate: "",
  bestFor: "",
  dataAsOf: "",
  sourceUrl: "",
};

const input =
  "w-full rounded-sm border border-line bg-panel-2 px-2 py-1.5 text-xs outline-none focus:border-accent";
const label = "mb-1 block text-[11px] text-text-3";

function SectionTitle({ children }: { children: React.ReactNode }): React.ReactElement {
  return <div className="col-span-full mt-1 text-[11px] font-semibold text-text-2">{children}</div>;
}

export default function PlansBoard({ rows }: { rows: CodingPlanRow[] }): React.ReactElement {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<Msg>(null);
  const [filter, setFilter] = useState<StatusFilter>("all");
  const [query, setQuery] = useState("");
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [editing, setEditing] = useState<CodingPlanRow | null>(null);

  const counts = useMemo(
    () => ({
      all: rows.length,
      pending: rows.filter((r) => r.status === "pending").length,
      enabled: rows.filter((r) => r.status === "enabled").length,
      disabled: rows.filter((r) => r.status === "disabled").length,
    }),
    [rows],
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows.filter((r) => {
      if (filter !== "all" && r.status !== filter) return false;
      if (q === "") return true;
      return (
        r.planName.toLowerCase().includes(q) ||
        r.vendor.toLowerCase().includes(q) ||
        r.quotaDesc.toLowerCase().includes(q)
      );
    });
  }, [rows, filter, query]);

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

  function startEdit(row: CodingPlanRow): void {
    setEditing(row);
    setForm({
      vendor: row.vendor,
      planName: row.planName,
      currency: row.currency,
      monthlyFee: row.monthlyFee === null ? "" : String(row.monthlyFee),
      quarterlyFee: row.quarterlyFee === null ? "" : String(row.quarterlyFee),
      yearlyFee: row.yearlyFee === null ? "" : String(row.yearlyFee),
      billingNote: row.billingNote ?? "",
      quotaDesc: row.quotaDesc,
      peakRate: row.peakRate ?? "",
      offPeakRate: row.offPeakRate ?? "",
      bestFor: row.bestFor ?? "",
      dataAsOf: row.dataAsOf,
      sourceUrl: row.sourceUrl,
    });
    setDrawerOpen(true);
    setMsg(null);
  }

  function submit(): void {
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
    const body = {
      vendor: form.vendor.trim(),
      planName: form.planName.trim(),
      currency: form.currency,
      monthlyFee: form.monthlyFee === "" ? null : Number(form.monthlyFee),
      quarterlyFee: form.quarterlyFee === "" ? null : Number(form.quarterlyFee),
      yearlyFee: form.yearlyFee === "" ? null : Number(form.yearlyFee),
      billingNote: form.billingNote.trim() === "" ? null : form.billingNote.trim(),
      quotaDesc: form.quotaDesc.trim(),
      peakRate: form.peakRate.trim() === "" ? null : form.peakRate.trim(),
      offPeakRate: form.offPeakRate.trim() === "" ? null : form.offPeakRate.trim(),
      bestFor: form.bestFor.trim() === "" ? null : form.bestFor.trim(),
      dataAsOf: form.dataAsOf,
      sourceUrl: form.sourceUrl.trim(),
    };
    void run(async () => {
      const env =
        editing === null
          ? await send("/api/pricing/plans", "POST", body)
          : await send(`/api/pricing/plans/${editing.id}`, "PUT", body);
      if (env?.code === 0) {
        setForm(EMPTY_FORM);
        setDrawerOpen(false);
        setEditing(null);
        return { ok: true, message: editing === null ? "已新建(待审)" : "已保存" };
      }
      return { ok: false, message: env?.message ?? (editing === null ? "新建失败" : "保存失败") };
    });
  }

  const money = (v: number | null): string => (v === null ? "—" : `¥ ${v}`);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex rounded-sm border border-line bg-panel-2 p-0.5">
          {FILTERS.map((f) => (
            <button
              key={f.key}
              type="button"
              onClick={() => setFilter(f.key)}
              className={`rounded-sm px-2.5 py-1 text-xs ${
                filter === f.key
                  ? "bg-panel font-medium text-text-1"
                  : "text-text-3 hover:text-text-2"
              }`}
            >
              {f.label}
              <span className="ml-1 font-mono text-[10px]">{counts[f.key]}</span>
            </button>
          ))}
        </div>
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="搜索厂商 / 套餐 / 额度"
          className="w-48 rounded-sm border border-line bg-panel-2 px-2 py-1 text-xs outline-none focus:border-accent"
        />
        <button
          type="button"
          onClick={() => setDrawerOpen(true)}
          className="ml-auto rounded-sm bg-accent px-3 py-1 text-xs font-medium text-[color:var(--accent-contrast)] hover:opacity-90"
        >
          ＋ 新建套餐
        </button>
      </div>

      {msg !== null && (
        <span className={`text-xs ${msg.tone === "ok" ? "text-green" : "text-red"}`}>
          {msg.text}
        </span>
      )}

      <div className="overflow-x-auto rounded-md border border-line bg-panel">
        <table className="w-full min-w-[900px] text-left text-[13px]">
          <thead>
            <tr className="border-b border-line bg-panel-2 text-[11px] text-text-3">
              <th className="px-4 py-2 font-medium">厂商 · 套餐</th>
              <th className="px-2 py-2 font-medium">月费</th>
              <th className="px-2 py-2 font-medium">额度口径</th>
              <th className="px-2 py-2 font-medium">时段扣费</th>
              <th className="px-2 py-2 font-medium">适合</th>
              <th className="px-2 py-2 font-medium">截至</th>
              <th className="px-2 py-2 font-medium">来源</th>
              <th className="px-2 py-2 font-medium">状态</th>
              <th className="px-2 py-2 font-medium">操作</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((r) => (
              <tr
                key={r.id}
                className={`border-b border-line/60 last:border-0 ${r.status === "pending" ? "opacity-70" : ""}`}
              >
                <td className="px-4 py-2">
                  <div className="font-mono text-xs text-text-1">{r.planName}</div>
                  <div className="text-[11px] text-text-3">{r.vendor}</div>
                  {r.note !== null && r.note !== "" && (
                    <div
                      title={r.note}
                      className={`mt-0.5 max-w-[220px] truncate text-[11px] ${
                        r.note.includes("待复核") ? "text-amber" : "text-text-3"
                      }`}
                    >
                      {r.note}
                    </div>
                  )}
                  {(r.quarterlyFee !== null ||
                    r.yearlyFee !== null ||
                    (r.benefits !== null && r.benefits.length > 0)) && (
                    <details className="mt-1">
                      <summary className="cursor-pointer select-none text-[11px] text-accent">
                        周期与权益
                      </summary>
                      <div className="mt-1 flex flex-col gap-0.5 text-[11px] text-text-2">
                        {r.quarterlyFee !== null && <div>包季 ¥ {r.quarterlyFee}/月</div>}
                        {r.yearlyFee !== null && <div>包年 ¥ {r.yearlyFee}</div>}
                        {r.billingNote !== null && (
                          <div className="text-text-3">{r.billingNote}</div>
                        )}
                        {r.benefits !== null && r.benefits.length > 0 && (
                          <ul className="mt-0.5 flex list-disc flex-col gap-0.5 pl-4">
                            {r.benefits.map((b) => (
                              <li key={b}>{b}</li>
                            ))}
                          </ul>
                        )}
                      </div>
                    </details>
                  )}
                </td>
                <td className="px-2 py-2 font-mono text-xs">{money(r.monthlyFee)}</td>
                <td className="px-2 py-2 text-xs text-text-2">{r.quotaDesc}</td>
                <td className="px-2 py-2 font-mono text-[11px] text-amber">
                  {[r.peakRate, r.offPeakRate].filter(Boolean).join(" · ") || "—"}
                </td>
                <td className="px-2 py-2 text-xs text-text-2">{r.bestFor ?? "—"}</td>
                <td className="px-2 py-2 font-mono text-[11px] text-text-3">{r.dataAsOf}</td>
                <td className="px-2 py-2">
                  {/* 验收问题三:策展行直达官方源页核对 */}
                  <a
                    href={r.sourceUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    title={r.sourceUrl}
                    className="text-[11px] text-blue hover:text-blue/80"
                  >
                    官方↗
                  </a>
                </td>
                <td className="px-2 py-2">
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() =>
                      void run(async () => {
                        const next = r.status === "enabled" ? "disabled" : "enabled";
                        const env = await send(`/api/pricing/plans/${r.id}`, "PUT", {
                          status: next,
                        });
                        return { ok: (env?.code ?? 1) === 0, message: env?.message ?? "操作失败" };
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
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => startEdit(r)}
                      className="text-text-2 hover:text-text-1 disabled:opacity-50"
                    >
                      编辑
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
                      className="text-xs text-text-3 hover:text-red disabled:opacity-50"
                    >
                      删
                    </button>
                  </div>
                </td>
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={9} className="px-4 py-8 text-center text-xs text-text-3">
                  {rows.length === 0
                    ? "暂无套餐行:点右上「新建套餐」或爬取初稿"
                    : "无匹配行(调整筛选或搜索词)"}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* 新建抽屉(字段三段:归属/价格与周期/溯源) */}
      <Drawer
        open={drawerOpen}
        title={editing === null ? "新建套餐(落待审)" : `编辑套餐:${editing.planName}`}
        onClose={() => {
          setDrawerOpen(false);
          setEditing(null);
        }}
        footer={
          <button
            type="button"
            disabled={busy}
            onClick={submit}
            className="w-full rounded-sm bg-accent px-4 py-1.5 text-xs font-medium text-[color:var(--accent-contrast)] hover:opacity-90 disabled:opacity-50"
          >
            {editing === null ? "提交(待审)" : "保存修改"}
          </button>
        }
      >
        <div className="grid grid-cols-2 gap-3">
          <SectionTitle>归属</SectionTitle>
          <div>
            <span className={label}>厂商 *</span>
            <input
              value={form.vendor}
              onChange={(e) => setForm({ ...form, vendor: e.target.value })}
              placeholder="如 智谱 AI · BigModel"
              className={input}
            />
          </div>
          <div>
            <span className={label}>套餐名 *</span>
            <input
              value={form.planName}
              onChange={(e) => setForm({ ...form, planName: e.target.value })}
              placeholder="如 GLM Coding Plan · Lite"
              className={input}
            />
          </div>
          <div>
            <span className={label}>币种</span>
            <select
              value={form.currency}
              onChange={(e) => setForm({ ...form, currency: e.target.value })}
              className={input}
              aria-label="币种"
            >
              <option value="CNY">¥ CNY</option>
              <option value="USD">$ USD</option>
            </select>
          </div>
          <div>
            <span className={label}>适合人群</span>
            <input
              value={form.bestFor}
              onChange={(e) => setForm({ ...form, bestFor: e.target.value })}
              placeholder="如 个人日常"
              className={input}
            />
          </div>
          <SectionTitle>价格与周期(口径不归一,按官方原文)</SectionTitle>
          <div>
            <span className={label}>月费</span>
            <input
              value={form.monthlyFee}
              onChange={(e) => setForm({ ...form, monthlyFee: e.target.value })}
              placeholder="空=未公布"
              className={input}
              inputMode="decimal"
            />
          </div>
          <div>
            <span className={label}>连续包季(折合/月)</span>
            <input
              value={form.quarterlyFee}
              onChange={(e) => setForm({ ...form, quarterlyFee: e.target.value })}
              placeholder="空=无季付"
              className={input}
              inputMode="decimal"
            />
          </div>
          <div>
            <span className={label}>连续包年</span>
            <input
              value={form.yearlyFee}
              onChange={(e) => setForm({ ...form, yearlyFee: e.target.value })}
              placeholder="折合/月或周期总价"
              className={input}
              inputMode="decimal"
            />
          </div>
          <div className="col-span-2">
            <span className={label}>周期口径说明</span>
            <input
              value={form.billingNote}
              onChange={(e) => setForm({ ...form, billingNote: e.target.value })}
              placeholder="如 连续包季9折/包年8折,季年价为折合每月"
              className={input}
            />
          </div>
          <div>
            <span className={label}>高峰倍率</span>
            <input
              value={form.peakRate}
              onChange={(e) => setForm({ ...form, peakRate: e.target.value })}
              placeholder="如 峰 1×"
              className={input}
            />
          </div>
          <div>
            <span className={label}>闲时倍率</span>
            <input
              value={form.offPeakRate}
              onChange={(e) => setForm({ ...form, offPeakRate: e.target.value })}
              placeholder="如 谷 0.5×"
              className={input}
            />
          </div>
          <SectionTitle>溯源</SectionTitle>
          <div className="col-span-2">
            <span className={label}>额度口径 *(官方原文)</span>
            <input
              value={form.quotaDesc}
              onChange={(e) => setForm({ ...form, quotaDesc: e.target.value })}
              placeholder="如 GLM-4.6:120 prompts / 5h"
              className={input}
            />
          </div>
          <div>
            <span className={label}>数据截至 *</span>
            <input
              type="date"
              value={form.dataAsOf}
              onChange={(e) => setForm({ ...form, dataAsOf: e.target.value })}
              className={input}
            />
          </div>
          <div>
            <span className={label}>来源链接 *</span>
            <input
              value={form.sourceUrl}
              onChange={(e) => setForm({ ...form, sourceUrl: e.target.value })}
              placeholder="https://…"
              className={input}
            />
          </div>
        </div>
      </Drawer>
    </div>
  );
}
