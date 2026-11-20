"use client";

/**
 * 模型牌价策展板 v2(M56 策展台重构,2026-10-29 验收反馈):列表优先——
 * 状态页签筛选(全部/待审/已发布/停用)+ 关键词搜索(厂商/模型/备注)+
 * 行内高频操作(状态终审/改价/删)+ 来源列(官方页↗,验收问题三);
 * 低频新建收进抽屉表单(字段三段:归属/价格/溯源),不再常驻占首屏。
 * 三规则不变:新建落 pending;刷新不动终审行;currency 随价格走。
 *
 * 2026-11-18 反馈两改:①勾选 + 批量发布/批量停用(bulk API 本就支持任意
 * 状态,此前只接了「批量通过待审」一条);②行内操作后 refreshKeepScroll
 * 保持滚动位置(此前 refresh 换骨架会跳顶)。
 *
 * 2026-11-20 反馈(M77)再改:①批量动作补全为**上架 / 下架 / 删除**三档
 * (此前缺批量删除,过期采集行只能逐行删);②批量对象统一为「全部已勾选行」
 * (勾选跨筛选累计,此前只发当前筛选可见的部分,按钮数字与实际动作对不上);
 * ③措辞统一到全站口径「上架/下架」(原「发布/停用」)。
 */
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";

import type { ModelPricingRow } from "@/lib/pricing/admin-model";
import { TIER_UNIT_LABELS, type TierUnit } from "@/lib/pricing/constants";
import { MODALITY_LABELS, type Modality } from "@/lib/pricing/modality";

import { TierEditor } from "./TierEditor";
import type { ApiEnvelope } from "@/lib/http/response";

import DialogShell, { DialogActions } from "@/components/admin/DialogShell";

import { refreshKeepScroll } from "./refresh";

type Msg = { tone: "ok" | "err"; text: string } | null;
type StatusFilter = "all" | "pending" | "enabled" | "disabled";

const STATUS_LABELS: Record<string, string> = {
  pending: "待审",
  enabled: "已上架",
  disabled: "已下架",
};

const FILTERS: ReadonlyArray<{ key: StatusFilter; label: string }> = [
  { key: "all", label: "全部" },
  { key: "pending", label: "待审" },
  { key: "enabled", label: "已上架" },
  { key: "disabled", label: "已下架" },
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
  const [dialogOpen, setDialogOpen] = useState(false);
  const [form, setForm] = useState({ ...EMPTY_FORM, confirmInverted: false });
  const [editingId, setEditingId] = useState<string | null>(null);
  const [tierRowId, setTierRowId] = useState<string | null>(null);
  const [editPrice, setEditPrice] = useState({ inputPrice: "", outputPrice: "" });
  /** 勾选行 id 集(批量发布/停用的对象;筛选变化不清空,跨页签可累计) */
  const [selected, setSelected] = useState<Set<string>>(new Set());

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

  /** 当前筛选结果里的 pending 行(批量终审的对象) */
  const pendingIds = useMemo(
    () => filtered.filter((r) => r.status === "pending").map((r) => r.id),
    [filtered],
  );

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
    // 反馈问题三:refresh 会触发 loading 骨架换页跳顶,归位保持滚动
    if (r.ok) refreshKeepScroll(router);
    setBusy(false);
  }

  /** 批量状态变更(M77 反馈):上架/下架所选;下架前台即下架,须确认。
   *  对象 = **全部已勾选行**(勾选跨筛选累计,不能只发当前筛选可见的那部分,
   *  否则按钮上的数字与实际动作对不上)。 */
  function bulkStatus(status: "enabled" | "disabled"): void {
    const ids = [...selected];
    if (ids.length === 0 || busy) return;
    if (
      status === "disabled" &&
      !window.confirm(`下架所选 ${ids.length} 行?前台将立即下架(人工定稿行不动)`)
    ) {
      return;
    }
    void run(async () => {
      const env = await send("/api/pricing/models/bulk", "POST", { ids, status });
      const count = (env?.data as { count?: number } | null)?.count ?? 0;
      if (env?.code === 0) {
        setSelected(new Set());
        return { ok: true, message: `${status === "enabled" ? "已上架" : "已下架"} ${count} 行` };
      }
      return { ok: false, message: env?.message ?? "批量操作失败" };
    });
  }

  /** 批量删除(M77 反馈:清理过期采集行)。不可逆,须确认。 */
  function bulkDelete(): void {
    const ids = [...selected];
    if (ids.length === 0 || busy) return;
    const pinned = rows.filter((r) => selected.has(r.id) && r.isPinned).length;
    const ok = window.confirm(
      `删除所选 ${ids.length} 行?不可逆(档位与变更史一并删除)。` +
        `人工定稿行会跳过${pinned > 0 ? `(${pinned} 行)` : ""}。` +
        `注意:源若仍在采集,被删的行下一轮会以「待审」重新落库。`,
    );
    if (!ok) return;
    void run(async () => {
      const env = await send("/api/pricing/models/bulk", "DELETE", { ids });
      const data = env?.data as { count?: number; skippedPinned?: number } | null;
      if (env?.code === 0) {
        setSelected(new Set());
        const skipped = data?.skippedPinned ?? 0;
        return {
          ok: true,
          message: `已删除 ${data?.count ?? 0} 行${skipped > 0 ? `;跳过人工定稿 ${skipped} 行` : ""}`,
        };
      }
      return { ok: false, message: env?.message ?? "批量删除失败" };
    });
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
        setDialogOpen(false);
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
        {/* 批量终审(M74 批C):采集落 pending,批量上架才能进前台 */}
        <button
          type="button"
          disabled={busy || pendingIds.length === 0}
          onClick={() =>
            void run(async () => {
              const env = await send("/api/pricing/models/bulk", "POST", {
                ids: pendingIds,
                status: "enabled",
              });
              const count = (env?.data as { count?: number } | null)?.count ?? 0;
              if (env?.code === 0) {
                refreshKeepScroll(router);
                return { ok: true, message: `已上架 ${count} 行` };
              }
              return { ok: false, message: env?.message ?? "批量上架失败" };
            })
          }
          className="rounded-sm border border-line px-3 py-1 text-xs text-text-2 hover:border-line-hover hover:text-text-1 disabled:opacity-40"
        >
          批量上架(待审){pendingIds.length > 0 ? ` ${pendingIds.length}` : ""}
        </button>
        {/* M77 反馈:勾选对象的上架/下架/删除(此前只有「批量通过待审」一条) */}
        <button
          type="button"
          disabled={busy || selected.size === 0}
          onClick={() => bulkStatus("enabled")}
          title="把所选行上架(前台可见)"
          className="rounded-sm border border-green/40 bg-green/8 px-3 py-1 text-xs text-green hover:bg-green/15 disabled:opacity-40"
        >
          上架所选 {selected.size}
        </button>
        <button
          type="button"
          disabled={busy || selected.size === 0}
          onClick={() => bulkStatus("disabled")}
          title="把所选行下架(前台立即不可见;人工定稿行不动)"
          className="rounded-sm border border-line px-3 py-1 text-xs text-text-3 hover:border-red/50 hover:text-red disabled:opacity-40"
        >
          下架所选 {selected.size}
        </button>
        <button
          type="button"
          disabled={busy || selected.size === 0}
          onClick={bulkDelete}
          title="删除所选行(不可逆;人工定稿行跳过)"
          className="rounded-sm border border-line px-3 py-1 text-xs text-text-3 hover:border-red/50 hover:text-red disabled:opacity-40"
        >
          删除所选 {selected.size}
        </button>
        {selected.size > 0 && (
          <button
            type="button"
            onClick={() => setSelected(new Set())}
            className="rounded-sm border border-line px-2 py-1 text-[11px] text-text-3 hover:text-text-1"
          >
            清空选择({selected.size})
          </button>
        )}
        <button
          type="button"
          onClick={() => setDialogOpen(true)}
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
              <th className="w-9 px-2 py-2">
                <input
                  type="checkbox"
                  aria-label="全选当前筛选行"
                  className="accent-accent"
                  checked={filtered.length > 0 && filtered.every((r) => selected.has(r.id))}
                  onChange={(e) =>
                    setSelected(
                      e.target.checked
                        ? new Set([...selected, ...filtered.map((r) => r.id)])
                        : new Set([...selected].filter((id) => !filtered.some((r) => r.id === id))),
                    )
                  }
                />
              </th>
              <th className="px-4 py-2 font-medium">模型 / 厂商</th>
              <th className="px-2 py-2 font-medium">输入价</th>
              <th className="px-2 py-2 font-medium">输出价</th>
              <th className="px-2 py-2 font-medium">免费额度</th>
              <th className="px-2 py-2 font-medium">完全免费</th>
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
                  <td className="px-2 py-2">
                    <input
                      type="checkbox"
                      aria-label={`选择 ${r.modelKey}`}
                      className="accent-accent"
                      checked={selected.has(r.id)}
                      onChange={(e) =>
                        setSelected((prev) => {
                          const next = new Set(prev);
                          if (e.target.checked) next.add(r.id);
                          else next.delete(r.id);
                          return next;
                        })
                      }
                    />
                  </td>
                  <td className="px-4 py-2">
                    <div className="font-mono text-xs text-text-1">
                      {r.modelKey}
                      {r.currency === "USD" && <span className="ml-1 text-text-3">($)</span>}
                      {(r.modality ?? "text") !== "text" && (
                        <span className="ml-1.5 rounded border border-blue/40 bg-blue/10 px-1 py-0.5 align-middle text-[10px] leading-none text-blue">
                          {MODALITY_LABELS[(r.modality ?? "text") as Exclude<Modality, "text">] ??
                            r.modality}
                        </span>
                      )}
                      {r.priceUnit !== "per_1m_tokens" && (
                        <span className="ml-1 align-middle text-[10px] text-amber">
                          {TIER_UNIT_LABELS[r.priceUnit as TierUnit] ?? r.priceUnit}
                        </span>
                      )}
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
                  <td className="px-2 py-2">
                    {/* 完全免费(M74 批C):与「免费额度」是两种语义,分开标 */}
                    <button
                      type="button"
                      disabled={busy || editing}
                      title={
                        r.isFree
                          ? "完全免费:所有档位价均为 0(点击取消)"
                          : "非完全免费(点击标记为完全免费)"
                      }
                      onClick={() =>
                        void run(async () => {
                          const env = await send(`/api/pricing/models/${r.id}`, "PUT", {
                            isFree: !r.isFree,
                          });
                          if (env?.code === 0) {
                            refreshKeepScroll(router);
                            return {
                              ok: true,
                              message: r.isFree ? "已取消完全免费" : "已标记完全免费",
                            };
                          }
                          return { ok: false, message: env?.message ?? "保存失败" };
                        })
                      }
                      className={`rounded-sm border px-1.5 py-0.5 text-[10.5px] leading-none ${
                        r.isFree
                          ? "border-green/50 bg-green/10 text-green-hi"
                          : "border-line text-text-3 hover:text-text-2"
                      }`}
                    >
                      {r.isFree ? "免费" : "—"}
                    </button>
                  </td>
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
                            className="cursor-pointer rounded-sm px-2 py-1 text-accent hover:bg-accent-dim disabled:opacity-50"
                          >
                            保存
                          </button>
                          <button
                            type="button"
                            onClick={() => setEditingId(null)}
                            className="cursor-pointer rounded-sm px-2 py-1 text-text-2 hover:bg-panel-2"
                          >
                            取消
                          </button>
                        </>
                      ) : (
                        <>
                          <button
                            type="button"
                            disabled={busy}
                            title={
                              r.isPinned
                                ? "已人工定稿:采集不覆盖此行。点击改为「跟随官方价」(采集将刷新本行)"
                                : "跟随官方价:采集会刷新本行价格。点击改为「人工定稿」(采集不再覆盖)"
                            }
                            onClick={() =>
                              void run(async () => {
                                const env = await send(`/api/pricing/models/${r.id}`, "PUT", {
                                  isPinned: !r.isPinned,
                                });
                                return {
                                  ok: (env?.code ?? 1) === 0,
                                  message: env?.message ?? "操作失败",
                                };
                              })
                            }
                            className={`cursor-pointer rounded-sm px-2 py-1 disabled:opacity-50 ${
                              r.isPinned
                                ? "bg-panel-2 text-text-2"
                                : "text-text-3 hover:bg-panel-2 hover:text-text-1"
                            }`}
                          >
                            {r.isPinned ? "人工定稿" : "跟随官方"}
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setEditingId(r.id);
                              setEditPrice({
                                inputPrice: r.inputPrice === null ? "" : String(r.inputPrice),
                                outputPrice: r.outputPrice === null ? "" : String(r.outputPrice),
                              });
                            }}
                            className="cursor-pointer rounded-sm px-2 py-1 text-text-2 hover:bg-panel-2"
                          >
                            改价
                          </button>
                          <button
                            type="button"
                            title="订正价格档位(阶梯/缓存/峰谷)"
                            onClick={() => setTierRowId(tierRowId === r.id ? null : r.id)}
                            className="cursor-pointer rounded-sm px-2 py-1 text-text-2 hover:bg-panel-2"
                          >
                            档位
                            <span className="ml-0.5 font-mono text-[10.5px] text-text-3">
                              {r.tiers?.length ?? 0}
                            </span>
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
                            className="cursor-pointer rounded-sm px-2 py-1 text-text-3 hover:bg-red/10 hover:text-red disabled:opacity-50"
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
            {tierRowId !== null &&
              filtered
                .filter((r) => r.id === tierRowId)
                .map((r) => (
                  <tr key={`tiers-${r.id}`} className="border-b border-line/60 last:border-b-0">
                    <td colSpan={10} className="px-4 py-3">
                      <TierEditor
                        rowId={r.id}
                        tiers={r.tiers ?? []}
                        onDone={() => {
                          setTierRowId(null);
                          refreshKeepScroll(router);
                        }}
                      />
                    </td>
                  </tr>
                ))}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={10} className="px-4 py-8 text-center text-xs text-text-3">
                  {rows.length === 0
                    ? "暂无牌价行:点右上「新建牌价」或爬取初稿"
                    : "无匹配行(调整筛选或搜索词)"}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* 新建弹窗(字段三段:归属/价格/溯源;系统 DialogShell 同壳) */}
      {dialogOpen && (
        <DialogShell width="2xl" scroll title="新建牌价(落待审)">
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
          <DialogActions>
            <label className="mr-auto flex items-center gap-1 text-[11px] text-text-3">
              <input
                type="checkbox"
                checked={form.confirmInverted}
                onChange={(e) => setForm({ ...form, confirmInverted: e.target.checked })}
              />
              确认反常态
            </label>
            <button
              type="button"
              onClick={() => setDialogOpen(false)}
              className="cursor-pointer rounded-sm px-3 py-1.5 text-xs text-text-2 hover:bg-panel-2"
            >
              取消
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={submitNew}
              className="cursor-pointer rounded-sm bg-accent px-3 py-1.5 text-xs font-medium text-[color:var(--accent-contrast)] hover:opacity-90 disabled:opacity-50"
            >
              提交(待审)
            </button>
          </DialogActions>
        </DialogShell>
      )}
    </div>
  );
}
