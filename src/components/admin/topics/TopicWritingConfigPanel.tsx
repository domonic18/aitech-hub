"use client";

/**
 * 写作要求配置区(2026-10-20 详情页重构核心件;2026-10-21 §13.8 交互重构)
 * ——把写作要求拆成 MECE 四维可视化构建:内容形式 × 口吻语感 × 篇幅 × 配图,
 * 外加「生成封面图」勾选(勾选型开关不入维度组)+「补充要求」自由块。
 * §13.8 机制(src/lib/topics/writing-config.ts):选项归选项、补充归补充:
 * - 选项卡只由点击驱动(setSelection),点选永不弹确认、永不销毁已写内容;
 * - 补充要求是独立自由块,保存时以【补充要求】头并入 positioning,原样
 *   verbatim 透传 AI;
 * - custom 仅=存量文本的体裁模板曾被手改(amber 提示核对,非死胡同——手改
 *   内容已被解析无损收进补充块);
 * - 「查看将交给 AI 的写作要求」可折叠预览合成结果(所见即所交)。
 * - 每个选项带一句话说明 + 可展开样例节选(措辞示范);配图「信息卡为主」
 *   的样例走 /api/card-presets/preview 真实渲染(零副作用),所见即所得。
 * 保存 PATCH /api/topics/[id] {positioning};生成初稿(TopicDraftActions)
 * 服务端从同一文本派生体裁词与技能路由(带补充要求照常派生),无双入口漂移。
 */
import { useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import type { ApiEnvelope } from "@/lib/http/response";
import {
  composeWritingText,
  parseWritingText,
  VISUAL_SAMPLE_CARDS,
  VISUAL_SAMPLE_ILLUSTRATIONS,
  WRITING_DIMENSIONS,
  type WritingSelection,
} from "@/lib/topics/writing-config";

/** 真实渲染样例卡(懒加载:展开配图样例才请求;blob URL 会话内缓存) */
function SampleCard({ preset, data, alt }: { preset: string; data: unknown; alt: string }) {
  const cache = useRef(new Map<string, string>());
  const [url, setUrl] = useState<string | null>(() => cache.current.get(alt) ?? null);
  const [err, setErr] = useState(false);

  function load(): void {
    if (url || err) return;
    fetch("/api/card-presets/preview", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ preset, data }),
    })
      .then(async (res) => {
        if (!res.ok) throw new Error(String(res.status));
        const blob = await res.blob();
        const u = URL.createObjectURL(blob);
        cache.current.set(alt, u);
        setUrl(u);
      })
      .catch(() => setErr(true));
  }

  if (err) return <span className="text-[11px] text-red">样例渲染失败</span>;
  if (!url)
    return (
      <button
        type="button"
        onClick={load}
        className="rounded-sm border border-line px-2 py-0.5 text-[11px] text-text-2 hover:border-accent hover:text-text-1"
      >
        渲染样例
      </button>
    );
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={url} alt={alt} className="max-w-full rounded-sm border border-line" />
  );
}

/** 单维选项组:标题/一句话说明 + 选项卡(label+desc)+ 可展开样例 */
function DimensionGroup({
  dim,
  selection,
  onSelect,
}: {
  dim: (typeof WRITING_DIMENSIONS)[number];
  selection: WritingSelection;
  onSelect: (key: string) => void;
}) {
  const [openKey, setOpenKey] = useState<string | null>(null);
  const selected = selection[dim.key];
  return (
    <div className="flex flex-col gap-1.5">
      <div>
        <span className="text-[12px] font-semibold text-text-1">{dim.title}</span>
        <span className="ml-2 text-[11px] text-text-3">{dim.hint}</span>
      </div>
      <div className="flex flex-wrap gap-2">
        {dim.options.map((opt) => {
          const active = opt.key === selected;
          // 配图维:信息卡走真实渲染、插画走静态样例,少图纯文字无样例
          const hasSample = opt.sample !== "" || (dim.key === "visual" && opt.key !== "minimal");
          return (
            <div key={opt.key} className="flex flex-col gap-1">
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => onSelect(opt.key)}
                  className={
                    "max-w-72 rounded-sm border px-2.5 py-1.5 text-left " +
                    (active
                      ? "border-accent bg-accent/10"
                      : "border-line bg-panel hover:border-text-3")
                  }
                >
                  <span
                    className={
                      "block text-[12px] font-medium " + (active ? "text-accent" : "text-text-1")
                    }
                  >
                    {opt.label}
                  </span>
                  <span className="mt-0.5 block text-[11px] leading-snug text-text-3">
                    {opt.desc}
                  </span>
                </button>
                {hasSample && (
                  <button
                    type="button"
                    onClick={() => setOpenKey(openKey === opt.key ? null : opt.key)}
                    className="text-[11px] text-text-3 underline decoration-line hover:text-accent"
                  >
                    {openKey === opt.key ? "收起样例" : "样例"}
                  </button>
                )}
              </div>
              {openKey === opt.key && (
                <div className="max-w-96 rounded-sm border border-dashed border-line bg-panel-2/60 px-2.5 py-2">
                  {dim.key === "visual" && opt.key === "illustrate" ? (
                    <div className="flex flex-col gap-2">
                      <span className="text-[11px] text-text-3">
                        以下为文生图插画样例(生成时按各小节内容绘制,概念/场景/氛围向;非固定模板):
                      </span>
                      {VISUAL_SAMPLE_ILLUSTRATIONS.map((img) => (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          key={img.src}
                          src={img.src}
                          alt={img.alt}
                          className="max-w-full rounded-sm border border-line"
                        />
                      ))}
                    </div>
                  ) : dim.key === "visual" ? (
                    <div className="flex flex-col gap-2">
                      <span className="text-[11px] text-text-3">
                        以下为信息卡真实渲染样例(生成时按文章内容自动设计,非固定模板):
                      </span>
                      {VISUAL_SAMPLE_CARDS.map((c, i) => (
                        <SampleCard
                          key={c.preset}
                          preset={c.preset}
                          data={c.data}
                          alt={`信息卡样例 ${i + 1}`}
                        />
                      ))}
                    </div>
                  ) : (
                    <pre className="whitespace-pre-wrap font-sans text-[11px] leading-relaxed text-text-2">
                      {opt.sample}
                    </pre>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default function TopicWritingConfigPanel({
  id,
  positioning,
}: {
  id: string;
  positioning: string | null;
}) {
  const router = useRouter();
  // §13.8:selection 只由点击驱动;supplement 是独立自由块(点选项/勾选永不
  // 触碰);custom 仅=体裁模板曾被手改(提示核对,手改内容已在 supplement 无损保留)
  const initial = useMemo(() => parseWritingText(positioning), [positioning]);
  const [selection, setSelection] = useState<WritingSelection>(initial.selection);
  const [supplement, setSupplement] = useState(initial.supplement);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: "ok" | "err"; text: string } | null>(null);

  const composed = composeWritingText(selection, supplement.trim() || null);
  const dirty = composed !== (positioning ?? "");

  /** 点选项:仅更新选择状态——不弹确认、不销毁任何已写内容(§13.8) */
  function select(dim: (typeof WRITING_DIMENSIONS)[number], key: string): void {
    setSelection((s) => ({ ...s, [dim.key]: key }) as WritingSelection);
  }

  /** 封面图勾选(M39 批④+):勾=生成(缺省不出条款);取消=写入跳过条款行 */
  function toggleCover(): void {
    setSelection((s) => ({ ...s, cover: s.cover === "skip" ? "generate" : "skip" }));
  }

  async function save(): Promise<void> {
    if (busy || !dirty) return;
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch(`/api/topics/${id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ positioning: composed }),
      });
      const resp = (await res.json()) as ApiEnvelope;
      if (!res.ok || resp.code !== 0) {
        setMsg({ tone: "err", text: resp.message || `保存失败(${res.status})` });
        return;
      }
      setMsg({ tone: "ok", text: "写作要求已保存,生成初稿时生效" });
      router.refresh();
    } catch {
      setMsg({ tone: "err", text: "网络异常,请重试" });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-4 rounded-sm border border-line bg-panel p-3">
      <div className="grid gap-4 md:grid-cols-2">
        {WRITING_DIMENSIONS.map((dim) => (
          <DimensionGroup
            key={dim.key}
            dim={dim}
            selection={selection}
            onSelect={(key) => select(dim, key)}
          />
        ))}
      </div>
      <label className="flex items-start gap-2 border-t border-line pt-2.5">
        <input
          type="checkbox"
          checked={selection.cover !== "skip"}
          onChange={toggleCover}
          className="mt-0.5 h-3.5 w-3.5 accent-[color:var(--accent)]"
        />
        <span className="flex flex-col gap-0.5">
          <span className="text-[12px] font-medium text-text-1">生成封面图</span>
          <span className="text-[11px] leading-snug text-text-3">
            勾选时,AI 生成文章初稿会同步生成封面候选(默认);重新生成文章前可取消勾选, AI
            将不再生成封面、保留现有封面。
          </span>
        </span>
      </label>
      <div className="flex flex-col gap-1.5 border-t border-line pt-2.5">
        <span className="text-[12px] font-semibold text-text-1">补充要求(可选)</span>
        <textarea
          value={supplement}
          maxLength={500}
          rows={3}
          onChange={(e) => setSupplement(e.target.value)}
          placeholder="选材偏好、口吻细节、特别强调等,原样交给 AI;上方选项怎么切换都不会覆盖这里…"
          className="rounded-sm border border-line bg-panel px-2.5 py-1.5 text-[12px] leading-relaxed outline-none focus:border-accent placeholder:text-text-3"
          aria-label="补充要求"
        />
        {initial.custom && (
          <span className="text-[11px] text-amber-hi">
            体裁描述曾被手动修改:保存后将采用标准模板,原内容已保留在补充要求;请核对上方「内容形式」选择。
          </span>
        )}
        <details>
          <summary className="cursor-pointer text-[11px] text-text-3 hover:text-accent">
            查看将交给 AI 的写作要求
          </summary>
          <pre className="mt-1.5 whitespace-pre-wrap rounded-sm border border-dashed border-line bg-panel-2/60 px-2.5 py-2 font-sans text-[11px] leading-relaxed text-text-2">
            {composed}
          </pre>
        </details>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => void save()}
            disabled={busy || !dirty}
            className="rounded-sm bg-accent px-3 py-1 text-xs font-medium text-[color:var(--accent-contrast)] hover:opacity-90 disabled:opacity-50"
          >
            保存写作要求
          </button>
          {msg && (
            <span className={`text-[11px] ${msg.tone === "ok" ? "text-green" : "text-red"}`}>
              {msg.text}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
