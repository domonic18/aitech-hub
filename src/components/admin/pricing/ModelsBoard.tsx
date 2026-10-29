"use client";

/**
 * 模型牌价策展台(M55 批A,/admin/pricing 上半区):爬虫/手工数据统一治理——
 * 手工新建(缺省落 pending)/ 行内启停(enabled=终审可见,disabled=停用)/
 * 改价(label+价格行内编辑,反常态前端预检)+ 删除。pending 行半透明+「待审」
 * 徽章;变更走 /api/pricing/models,router.refresh 重取。
 */
import { useState } from "react";
import { useRouter } from "next/navigation";

import type { ModelPricingRow } from "@/lib/pricing/admin";
import type { ApiEnvelope } from "@/lib/http/response";

type Msg = { tone: "ok" | "err"; text: string } | null;

const STATUS_LABELS: Record<string, string> = {
  pending: "待审",
  enabled: "已发布",
  disabled: "停用",
};

/** 反常态前端预检(与后端 Zod 守卫双落,弱提交早反馈) */
function isInverted(a: string, b: string): boolean {
  const x = Number(a);
  const y = Number(b);
  return a !== "" && b !== "" && Number.isFinite(x) && Number.isFinite(y) && x > y;
}

const input =
  "rounded-sm border border-line bg-panel-2 px-2 py-1 text-xs outline-none focus:border-accent";

export default function ModelsBoard({ rows }: { rows: ModelPricingRow[] }): React.ReactElement {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<Msg>(null);
  const [form, setForm] = useState({
    vendor: "",
    modelKey: "",
    currency: "CNY",
    inputPrice: "",
    outputPrice: "",
    freeTier: "",
    contextWindow: "",
    region: "cn",
    dataAsOf: "",
    sourceUrl: "",
    confirmInverted: false,
  });
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editPrice, setEditPrice] = useState({ inputPrice: "", outputPrice: "" });

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
        inputPrice: form.inputPrice === "" ? null : Number(form.inputPrice),
        outputPrice: form.outputPrice === "" ? null : Number(form.outputPrice),
        freeTier: form.freeTier.trim() === "" ? null : form.freeTier.trim(),
        contextWindow: form.contextWindow.trim() === "" ? null : form.contextWindow.trim(),
        region: form.region,
        dataAsOf: form.dataAsOf,
        sourceUrl: form.sourceUrl.trim(),
        confirmInverted: inverted,
      });
      if (env?.code === 0) {
        setForm({
          ...form,
          vendor: "",
          modelKey: "",
          inputPrice: "",
          outputPrice: "",
          freeTier: "",
          contextWindow: "",
          sourceUrl: "",
          confirmInverted: false,
        });
        return { ok: true, message: "已新建(待审)" };
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
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold">模型牌价</h3>
        <span className="text-[11px] text-text-3">
          {rows.filter((r) => r.status === "enabled").length} 已发布 ·{" "}
          {rows.filter((r) => r.status === "pending").length} 待审 · 单位:货币 / 百万 tokens
        </span>
      </div>

      <div className="grid grid-cols-2 gap-1.5 rounded-md border border-line bg-panel px-4 py-3 sm:grid-cols-4 lg:grid-cols-6">
        <input
          value={form.vendor}
          onChange={(e) => setForm({ ...form, vendor: e.target.value })}
          placeholder="厂商 *"
          className={input}
        />
        <input
          value={form.modelKey}
          onChange={(e) => setForm({ ...form, modelKey: e.target.value })}
          placeholder="模型标识 * (如 deepseek-v3.2)"
          className={input}
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
        <select
          value={form.region}
          onChange={(e) => setForm({ ...form, region: e.target.value })}
          className={input}
          aria-label="分组"
        >
          <option value="cn">国内</option>
          <option value="intl">国际</option>
        </select>
        <input
          value={form.inputPrice}
          onChange={(e) => setForm({ ...form, inputPrice: e.target.value })}
          placeholder="输入价"
          className={input}
          inputMode="decimal"
        />
        <input
          value={form.outputPrice}
          onChange={(e) => setForm({ ...form, outputPrice: e.target.value })}
          placeholder="输出价"
          className={input}
          inputMode="decimal"
        />
        <input
          value={form.freeTier}
          onChange={(e) => setForm({ ...form, freeTier: e.target.value })}
          placeholder="免费额度(空=—)"
          className={input}
        />
        <input
          value={form.contextWindow}
          onChange={(e) => setForm({ ...form, contextWindow: e.target.value })}
          placeholder="上下文(如 128K)"
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
              <th className="px-4 py-2 font-medium">模型 / 厂商</th>
              <th className="px-2 py-2 font-medium">输入价</th>
              <th className="px-2 py-2 font-medium">输出价</th>
              <th className="px-2 py-2 font-medium">免费额度</th>
              <th className="px-2 py-2 font-medium">上下文</th>
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
                    <div className="font-mono text-xs text-text-1">
                      {r.modelKey}
                      {r.currency === "USD" && <span className="ml-1 text-text-3">($)</span>}
                    </div>
                    <div className="text-[11px] text-text-3">
                      {r.vendor} · {r.region === "cn" ? "国内" : "国际"}
                    </div>
                    {r.note !== null && r.note !== "" && (
                      // note 承载通道溯源与爬虫矩阵;含「待复核」= 源爬取失败旧数据,
                      // 琥珀提醒直至该源爬取成功(pending 自动摘标)或人工复核改写
                      <div
                        title={r.note}
                        className={`mt-0.5 max-w-[280px] truncate text-[11px] ${
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
          </tbody>
        </table>
      </div>
    </div>
  );
}
