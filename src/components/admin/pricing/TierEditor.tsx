"use client";

/**
 * 档位订正编辑器(M74 批C2):人工改阶梯价/缓存价/峰谷价。
 *
 * 档位是采集解析出来的——页面改版或口径解析有偏差时需要人工订正,此前只能
 * 直改库。**整行档位替换**(与采集侧 replaceTiers 同口径),不是增量合并:
 * 采集下一轮会用源里的完整档位集覆盖,人工改的行若被采集覆盖需另行定稿
 * (人工定稿闸是行上的 is_pinned)。
 */
import { useState } from "react";

import type { ModelPricingRow } from "@/lib/pricing/admin";
import { TIER_UNITS } from "@/lib/pricing/constants";

/** 编辑中的一档 */
interface Draft {
  tierLabel: string;
  inputPrice: string;
  outputPrice: string;
  cachePrice: string;
  minTokens: string;
  maxTokens: string;
  unit: string;
}

type RowTier = NonNullable<ModelPricingRow["tiers"]>[number];

function toDraft(t: RowTier): Draft {
  return {
    tierLabel: t.tierLabel,
    inputPrice: t.inputPrice === null ? "" : String(t.inputPrice),
    outputPrice: t.outputPrice === null ? "" : String(t.outputPrice),
    cachePrice: t.cachePrice === null ? "" : String(t.cachePrice),
    minTokens: t.minTokens === null ? "" : String(t.minTokens),
    maxTokens: t.maxTokens === null ? "" : String(t.maxTokens),
    unit: t.unit,
  };
}

const num = (v: string): number | null => (v.trim() === "" ? null : Number(v));

export function TierEditor({
  rowId,
  tiers,
  onDone,
}: {
  rowId: string;
  tiers: RowTier[];
  onDone: () => void;
}): React.ReactElement {
  const [drafts, setDrafts] = useState<Draft[]>(tiers.map(toDraft));
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: "ok" | "err"; text: string } | null>(null);

  const patch = (i: number, p: Partial<Draft>): void =>
    setDrafts((prev) => prev.map((d, idx) => (idx === i ? { ...d, ...p } : d)));

  async function save(): Promise<void> {
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch(`/api/pricing/models/${rowId}/tiers`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          tiers: drafts.map((d) => ({
            tierLabel: d.tierLabel,
            inputPrice: num(d.inputPrice),
            outputPrice: num(d.outputPrice),
            cachePrice: num(d.cachePrice),
            minTokens: num(d.minTokens),
            maxTokens: num(d.maxTokens),
            unit: d.unit,
          })),
        }),
      });
      const env = (await res.json().catch(() => null)) as {
        code?: number;
        message?: string;
      } | null;
      if (env?.code === 0) {
        setMsg({ tone: "ok", text: "档位已保存" });
        onDone();
      } else {
        setMsg({ tone: "err", text: env?.message ?? "保存失败" });
      }
    } catch {
      setMsg({ tone: "err", text: "保存失败" });
    } finally {
      setBusy(false);
    }
  }

  const input =
    "w-16 rounded-sm border border-line bg-panel-2 px-1 py-0.5 font-mono text-xs outline-none focus:border-accent";
  const label = "w-10 shrink-0 text-[10.5px] text-text-3";

  return (
    <div className="mt-2 rounded-md border border-line bg-panel-2/40 p-2">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[11px] text-text-2">价格档位</span>
        <span className="text-[10.5px] text-text-3">
          阶梯/缓存/峰谷价;整行替换保存,采集下一轮会按源覆盖(需长期生效请在行上定稿)
        </span>
        <button
          type="button"
          disabled={busy}
          onClick={() =>
            setDrafts((prev) => [
              ...prev,
              {
                tierLabel: `新档位 ${prev.length + 1}`,
                inputPrice: "",
                outputPrice: "",
                cachePrice: "",
                minTokens: "",
                maxTokens: "",
                unit: "per_1m_tokens",
              },
            ])
          }
          className="ml-auto rounded-sm border border-line px-2 py-0.5 text-[10.5px] text-text-2 hover:text-text-1 disabled:opacity-40"
        >
          ＋ 加档位
        </button>
      </div>

      <div className="mt-2 flex flex-col gap-1.5">
        {drafts.map((d, i) => (
          <div key={i} className="flex flex-wrap items-center gap-1.5">
            <input
              value={d.tierLabel}
              onChange={(e) => patch(i, { tierLabel: e.target.value })}
              placeholder="档位名"
              className="w-40 rounded-sm border border-line bg-panel-2 px-1 py-0.5 text-xs outline-none focus:border-accent"
            />
            <span className={label}>输入</span>
            <input
              value={d.inputPrice}
              onChange={(e) => patch(i, { inputPrice: e.target.value })}
              placeholder="—"
              className={input}
            />
            <span className={label}>输出</span>
            <input
              value={d.outputPrice}
              onChange={(e) => patch(i, { outputPrice: e.target.value })}
              placeholder="—"
              className={input}
            />
            <span className={label}>缓存</span>
            <input
              value={d.cachePrice}
              onChange={(e) => patch(i, { cachePrice: e.target.value })}
              placeholder="—"
              className={input}
            />
            <span className={label}>tokens</span>
            <input
              value={d.minTokens}
              onChange={(e) => patch(i, { minTokens: e.target.value })}
              placeholder="下界"
              className={input}
            />
            <span className={label}>–</span>
            <input
              value={d.maxTokens}
              onChange={(e) => patch(i, { maxTokens: e.target.value })}
              placeholder="上界"
              className={input}
            />
            <select
              value={d.unit}
              onChange={(e) => patch(i, { unit: e.target.value })}
              className="rounded-sm border border-line bg-panel-2 px-1 py-0.5 text-[10.5px] outline-none"
            >
              {TIER_UNITS.map((u) => (
                <option key={u} value={u}>
                  {u}
                </option>
              ))}
            </select>
            <button
              type="button"
              disabled={busy}
              onClick={() => setDrafts((prev) => prev.filter((_, idx) => idx !== i))}
              className="rounded-sm border border-line px-1.5 py-0.5 text-[10.5px] text-text-3 hover:text-red"
            >
              删
            </button>
          </div>
        ))}
        {drafts.length === 0 && <p className="text-[11px] text-text-3">无档位(该行只有基准价)</p>}
      </div>

      <div className="mt-2 flex items-center gap-2">
        <button
          type="button"
          disabled={busy}
          onClick={() => void save()}
          className="rounded-sm bg-accent px-2.5 py-1 text-[11px] font-medium text-[color:var(--accent-contrast)] hover:opacity-90 disabled:opacity-40"
        >
          保存档位
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={onDone}
          className="rounded-sm border border-line px-2.5 py-1 text-[11px] text-text-2 hover:text-text-1"
        >
          收起
        </button>
        {msg !== null && (
          <span className={`text-[11px] ${msg.tone === "ok" ? "text-green" : "text-red"}`}>
            {msg.text}
          </span>
        )}
      </div>
    </div>
  );
}
