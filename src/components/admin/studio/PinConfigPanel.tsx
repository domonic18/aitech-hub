"use client";

/**
 * 贴图配置面板(M42 批④;M43 v2 窄栏紧凑重排)——张数/比例/首图裁剪/
 * 画面风格 + 参照图选择 + 补充要求,落 topic.pin_positioning(与长文
 * positioning 独立列、互不派生,机制见 src/lib/topics/writing-pin-config.ts)。
 * 为 312px 配置栏重排:参数收敛为「标签左 · 控件右」单行,段落分明;
 * 保存 PATCH /api/topics/[id] {pinPositioning};生成贴图时 agent 经
 * get_topic_brief 读到同一份结构化配置,无双入口漂移。
 */
import { useState } from "react";
import { useRouter } from "next/navigation";

import type { ApiEnvelope } from "@/lib/http/response";
import { PIN_CROP_SPECS } from "@/lib/pins/constants";
import {
  composePinWritingText,
  parsePinWritingText,
  PIN_ASPECT_LABEL,
  PIN_ASPECTS,
  PIN_COUNT_MAX,
  PIN_COUNT_MIN,
  PIN_CROP_LABEL,
  type PinWritingSelection,
} from "@/lib/topics/writing-pin-config";

import ReferenceRail, { type ReferenceRailItem } from "./ReferenceRail";

const FIELD_CLS =
  "rounded-sm border border-line bg-panel px-2.5 py-1 text-[12px] outline-none focus:border-accent placeholder:text-text-3";

/** 参数行:标签左 · 控件右(窄栏单行,段落间距统一) */
function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="shrink-0 text-[12px] font-semibold text-text-1">{label}</span>
      {children}
    </div>
  );
}

/** 单选 chips(与长文配置同一套视觉语言) */
function Chips<T extends string>({
  value,
  options,
  labels,
  onChange,
}: {
  value: T;
  options: readonly T[];
  labels: Record<string, string>;
  onChange: (v: T) => void;
}) {
  return (
    <div className="flex flex-wrap justify-end gap-1">
      {options.map((o) => (
        <button
          key={o}
          type="button"
          onClick={() => onChange(o)}
          className={`rounded-sm px-2 py-1 text-[12px] ${
            value === o
              ? "bg-accent/12 font-medium text-accent"
              : "border border-line text-text-2 hover:border-text-3 hover:text-text-1"
          }`}
        >
          {labels[o]}
        </button>
      ))}
    </div>
  );
}

export default function PinConfigPanel({
  id,
  pinPositioning,
  candidates,
}: {
  id: string;
  pinPositioning: string | null;
  candidates: ReferenceRailItem[];
}) {
  const router = useRouter();
  const parsed = parsePinWritingText(pinPositioning);
  const [sel, setSel] = useState<PinWritingSelection>(parsed.selection);
  const [supplement, setSupplement] = useState(parsed.supplement);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: "ok" | "err"; text: string } | null>(null);

  const dirty =
    composePinWritingText(sel, supplement) !==
    composePinWritingText(parsed.selection, parsed.supplement);

  async function save(): Promise<void> {
    if (busy) return;
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch(`/api/topics/${id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ pinPositioning: composePinWritingText(sel, supplement) }),
      });
      const resp = (await res.json()) as ApiEnvelope;
      if (!res.ok || resp.code !== 0) {
        setMsg({ tone: "err", text: resp.message || `保存失败(${res.status})` });
        return;
      }
      setMsg({ tone: "ok", text: "贴图配置已保存,生成贴图时生效" });
      router.refresh();
    } catch {
      setMsg({ tone: "err", text: "网络异常,请重试" });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-3.5">
      <Row label="张数">
        <input
          type="number"
          min={PIN_COUNT_MIN}
          max={PIN_COUNT_MAX}
          value={sel.count}
          onChange={(e) => setSel((s) => ({ ...s, count: Number(e.target.value) }))}
          className={`w-16 text-right ${FIELD_CLS}`}
          aria-label="张数"
        />
      </Row>
      <Row label="比例">
        <Chips
          value={sel.aspect}
          options={PIN_ASPECTS}
          labels={PIN_ASPECT_LABEL}
          onChange={(aspect) => setSel((s) => ({ ...s, aspect }))}
        />
      </Row>
      <Row label="首图裁剪">
        <Chips
          value={sel.crop}
          options={PIN_CROP_SPECS}
          labels={PIN_CROP_LABEL}
          onChange={(crop) => setSel((s) => ({ ...s, crop }))}
        />
      </Row>

      <div className="flex flex-col gap-1.5 border-t border-line pt-3">
        <span
          className="cursor-help text-[12px] font-semibold text-text-1"
          title="写风格时不要再让 agent 编配色词,风格由参照图与此处共同承载"
        >
          画面风格
        </span>
        <textarea
          value={sel.style}
          maxLength={200}
          rows={2}
          onChange={(e) => setSel((s) => ({ ...s, style: e.target.value }))}
          placeholder="可选:如手绘笔记风、粗描边、纸感底纹…"
          className={FIELD_CLS}
        />
        <ReferenceRail
          candidates={candidates}
          value={sel.reference}
          onChange={(mediaPath) => setSel((s) => ({ ...s, reference: mediaPath }))}
          disabled={busy}
        />
      </div>

      <div className="flex flex-col gap-1.5 border-t border-line pt-3">
        <span className="text-[12px] font-semibold text-text-1">补充要求</span>
        <textarea
          value={supplement}
          maxLength={1000}
          rows={3}
          onChange={(e) => setSupplement(e.target.value)}
          placeholder="可选,原样交给 AI:如每张都要带中文大标题;最后一张放行动清单"
          className={FIELD_CLS}
        />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => void save()}
          disabled={busy || !dirty}
          className="rounded-sm bg-accent px-3 py-1 text-xs font-medium text-[color:var(--accent-contrast)] hover:opacity-90 disabled:opacity-50"
        >
          {busy ? "保存中…" : "保存贴图配置"}
        </button>
        {parsed.custom && (
          <span className="text-[11px] text-amber-hi">
            配置文本曾被手动改过,未识别内容已收进补充要求(保存不会丢)
          </span>
        )}
        {msg && (
          <span className={`text-[11px] ${msg.tone === "ok" ? "text-green" : "text-red"}`}>
            {msg.text}
          </span>
        )}
      </div>
    </div>
  );
}
