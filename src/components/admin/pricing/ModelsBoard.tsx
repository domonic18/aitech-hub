"use client";

/**
 * 模型牌价策展板 v2(M56 策展台重构,2026-10-29 验收反馈):列表优先——
 * 状态页签筛选(全部/待审/已发布/停用)+ 关键词搜索(厂商/模型/备注)+
 * 行内高频操作(状态终审/改价/删)+ 来源列(官方页↗,验收问题三);
 * 低频新建收进抽屉表单(字段三段:归属/价格/溯源),不再常驻占首屏。
 * 三规则不变:新建落 pending;刷新不动终审行;currency 随价格走。
 */
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";

import type { ModelPricingRow } from "@/lib/pricing/admin";
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
  modelKey: "",
  currency: "CNY",
  region: "cn",
  inputPrice: "",
  outputPrice: "",
  freeTier: "",
  contextWindow: "",
  dataAsOf: "",
  sourceUrl: "",
};

const input =
  "w-full rounded-sm border border-line bg-panel-2 px-2 py-1.5 text-xs outline-none focus:border-accent";
const label = "mb-1 block text-[11px] text-text-3";

function SectionTitle({ children }: { children: React.ReactNode }): React.ReactElement {
  return <div className="col-span-full mt-1 text-[11px] font-semibold text-text-2">{children}</div>;
}

/** 反常态前端预检(与后端 Zod 守卫双落,弱提交早反馈) */
function isInverted(a: string, b: string): boolean {
  const x = Number(a);
  const y = Number(b);
  return a !== "" && b !== "" && Number.isFinite(x) && Number.isFinite(y) && x > y;
}

export default function ModelsBoard({ rows }: { rows: ModelPricingRow[] }): React.ReactElement {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<Msg>(null);
  const [filter, setFilter] = useState<StatusFilter>("all");
  const [query, setQuery] = useState("");
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [form, setForm] = useState({ ...EMPTY_FORM, confirmInverted: false });
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editPrice, setEditPrice] = useState({ inputPrice: "", outputPrice: "" });

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
        r.modelKey.toLowerCase().includes(q) ||
        r.vendor.toLowerCase().includes(q) ||
        (r.note ?? "").toLowerCase().includes(q)
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

  function submitNew(): void {
    if (
      form.vendor.trim() === "" ||
      form.modelKey.trim() === "" ||
      form.dataAsOf === "" ||
      form.sourceUrl.trim() === ""
    ) {
      setMsg({ tone: "err", text: "厂商 / 模型标识 / 数据截至 / 来源链接 必填" });
      return;
    }
    const inverted = isInverted(form.inputPrice, form.outputPrice);
    if (inverted && !form.confirmInverted) {
      setMsg({ tone: "err", text: "输入价高于输出价(反常态),请核对后勾选「确认反常态」再提交" });
      return;
    }
    void run(async () => {
      const env = await send("/api/pricing/models", "POST", {
        vendor: form.vendor.trim(),
        modelKey: form.modelKey.trim(),
        currency: form.currency,
        region: form.region,
        inputPrice: form.inputPrice === "" ? null : Number(form.inputPrice),
        outputPrice: form.outputPrice === "" ? null : Number(form.outputPrice),
        freeTier: form.freeTier.trim() === "" ? null : form.freeTier.trim(),
        contextWindow: form.contextWindow.trim() === "" ? null : form.contextWindow.trim(),
        dataAsOf: form.dataAsOf,
        sourceUrl: form.sourceUrl.trim(),
        confirmInverted: inverted,
      });
      if (env?.code === 0) {
        setForm({ ...EMPTY_FORM, confirmInverted: false });
        setDrawerOpen(false);
        return { ok: true, message: "已新建(待审),在「待审」页签终审发布" };
      }
      return { ok: false, message: env?.message ?? "新建失败" };
    });
  }

  function savePrice(row: ModelPricingRow): void {
    const inverted = isInverted(editPrice.inputPrice, editPrice.outputPrice);
    if (inverted) {
      setMsg({ tone: "err", text: "输入价高于输出价,请核对两列数值" });
      return;
    }
    void run(async () => {
      const env = await send(`/api/pricing/models/${row.id}`, "PUT", {
        inputPrice: editPrice.inputPrice === "" ? null : Number(editPrice.inputPrice),
        outputPrice: editPrice.outputPrice === "" ? null : Number(editPrice.outputPrice),
      });
      if (env?.code === 0) setEditingId(null);
      return { ok: (env?.code ?? 1) === 0, message: env?.message ?? "保存失败" };
    });
  }

  return (
    <div className="flex flex-col gap-3">
      {/* 工具行:状态筛选 + 搜索 + 新建 */}
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
          placeholder="搜索厂商 / 模型 / 备注"
          className="w-48 rounded-sm border border-line bg-panel-2 px-2 py-1 text-xs outline-none focus:border-accent"
        />
        <button
          type="button"
          onClick={() => setDrawerOpen(true)}
          className="ml-auto rounded-sm bg-accent px-3 py-1 text-xs font-medium text-[color:var(--accent-contrast)] hover:opacity-90"
        >
          ＋ 新建牌价
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
              <th className="px-4 py-2 font-medium">模型 / 厂商</th>
              <th className="px-2 py-2 font-medium">输入价</th>
              <th className="px-2 py-2 font-medium">输出价</th>
              <th className="px-2 py-2 font-medium">免费额度</th>
              <th className="px-2 py-2 font-medium">上下文</th>
              <th className="px-2 py-2 font-medium">截至</th>
              <th className="px-2 py-2 font-medium">来源</th>
              <th className="px-2 py-2 font-medium">状态</th>
              <th className="px-2 py-2 font-medium">操作</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((r) => {
              const editing = editingId === r.id;
              return (
                <tr
                  key={r.id}
                  className={`border-b border-line/60 last:border-0 ${r.status === "pending" ? "opacity-70" : ""}`}
                >
                  <td className="px-4 py-2">
                    <div className="font-mono text-xs text-text-1">
                      {r.modelKey}
                      {r.currency === "USD" && <span className="ml-1 text-text-3">($)</span>}
                    </div>
                    <div className="text-[11px] text-text-3">
                      {r.vendor} · {r.region === "cn" ? "国内" : "国际"}
                    </div>
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
                  </td>
                  <td className="px-2 py-2 font-mono text-xs">
                    {editing ? (
                      <input
                        value={editPrice.inputPrice}
                        onChange={(e) => setEditPrice({ ...editPrice, inputPrice: e.target.value })}
                        className="w-16 rounded-sm border border-accent bg-panel-2 px-1 py-0.5 font-mono text-xs outline-none"
                      />
                    ) : r.inputPrice === null ? (
                      "—"
                    ) : (
                      `${r.currency === "USD" ? "$" : "¥"} ${r.inputPrice}`
                    )}
                  </td>
                  <td className="px-2 py-2 font-mono text-xs">
                    {editing ? (
                      <input
                        value={editPrice.outputPrice}
                        onChange={(e) =>
                          setEditPrice({ ...editPrice, outputPrice: e.target.value })
                        }
                        className="w-16 rounded-sm border border-accent bg-panel-2 px-1 py-0.5 font-mono text-xs outline-none"
                      />
                    ) : r.outputPrice === null ? (
                      "—"
                    ) : (
                      `${r.currency === "USD" ? "$" : "¥"} ${r.outputPrice}`
                    )}
                  </td>
                  <td className="px-2 py-2 text-xs text-text-2">{r.freeTier ?? "—"}</td>
                  <td className="px-2 py-2 font-mono text-xs text-text-2">
                    {r.contextWindow ?? "—"}
                  </td>
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
                      disabled={busy || editing}
                      onClick={() =>
                        void run(async () => {
                          const next = r.status === "enabled" ? "disabled" : "enabled";
                          const env = await send(`/api/pricing/models/${r.id}`, "PUT", {
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
                            onClick={() => savePrice(r)}
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
                            onClick={() => {
                              setEditingId(r.id);
                              setEditPrice({
                                inputPrice: r.inputPrice === null ? "" : String(r.inputPrice),
                                outputPrice: r.outputPrice === null ? "" : String(r.outputPrice),
                              });
                            }}
                            className="text-text-2 hover:text-text-1"
                          >
                            改价
                          </button>
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => {
                              if (!window.confirm(`删除 ${r.modelKey}?`)) return;
                              void run(async () => {
                                const env = await send(`/api/pricing/models/${r.id}`, "DELETE");
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
            {filtered.length === 0 && (
              <tr>
                <td colSpan={9} className="px-4 py-8 text-center text-xs text-text-3">
                  {rows.length === 0
                    ? "暂无牌价行:点右上「新建牌价」或爬取初稿"
                    : "无匹配行(调整筛选或搜索词)"}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* 新建抽屉(字段三段:归属/价格/溯源) */}
      <Drawer
        open={drawerOpen}
        title="新建牌价(落待审)"
        onClose={() => setDrawerOpen(false)}
        footer={
          <div className="flex items-center justify-between gap-2">
            <label className="flex items-center gap-1 text-[11px] text-text-3">
              <input
                type="checkbox"
                checked={form.confirmInverted}
                onChange={(e) => setForm({ ...form, confirmInverted: e.target.checked })}
              />
              确认反常态
            </label>
            <button
              type="button"
              disabled={busy}
              onClick={submitNew}
              className="rounded-sm bg-accent px-4 py-1.5 text-xs font-medium text-[color:var(--accent-contrast)] hover:opacity-90 disabled:opacity-50"
            >
              提交(待审)
            </button>
          </div>
        }
      >
        <div className="grid grid-cols-2 gap-3">
          <SectionTitle>归属</SectionTitle>
          <div>
            <span className={label}>厂商 *</span>
            <input
              value={form.vendor}
              onChange={(e) => setForm({ ...form, vendor: e.target.value })}
              placeholder="如 DeepSeek 深度求索"
              className={input}
            />
          </div>
          <div>
            <span className={label}>模型标识 *</span>
            <input
              value={form.modelKey}
              onChange={(e) => setForm({ ...form, modelKey: e.target.value })}
              placeholder="如 deepseek-v3.2"
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
            <span className={label}>分组</span>
            <select
              value={form.region}
              onChange={(e) => setForm({ ...form, region: e.target.value })}
              className={input}
              aria-label="分组"
            >
              <option value="cn">国内</option>
              <option value="intl">国际</option>
            </select>
          </div>
          <SectionTitle>价格(货币 / 百万 tokens)</SectionTitle>
          <div>
            <span className={label}>输入价</span>
            <input
              value={form.inputPrice}
              onChange={(e) => setForm({ ...form, inputPrice: e.target.value })}
              placeholder="空=未公布"
              className={input}
              inputMode="decimal"
            />
          </div>
          <div>
            <span className={label}>输出价</span>
            <input
              value={form.outputPrice}
              onChange={(e) => setForm({ ...form, outputPrice: e.target.value })}
              placeholder="空=未公布"
              className={input}
              inputMode="decimal"
            />
          </div>
          <div>
            <span className={label}>免费额度</span>
            <input
              value={form.freeTier}
              onChange={(e) => setForm({ ...form, freeTier: e.target.value })}
              placeholder="空=—"
              className={input}
            />
          </div>
          <div>
            <span className={label}>上下文</span>
            <input
              value={form.contextWindow}
              onChange={(e) => setForm({ ...form, contextWindow: e.target.value })}
              placeholder="如 128K"
              className={input}
            />
          </div>
          <SectionTitle>溯源</SectionTitle>
          <div>
            <span className={label}>数据截至 *</span>
            <input
              type="date"
              value={form.dataAsOf}
              onChange={(e) => setForm({ ...form, dataAsOf: e.target.value })}
              className={input}
            />
          </div>
          <div className="col-span-2">
            <span className={label}>来源链接 *(官方牌价页)</span>
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
