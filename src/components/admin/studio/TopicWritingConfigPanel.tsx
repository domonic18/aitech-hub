"use client";

/**
 * 写作要求配置区(M43 v2 窄栏紧凑版;机制沿 §13.8)
 * ——写作要求拆成 MECE 四维:内容形式 × 口吻语感 × 篇幅 × 配图,外加
 * 「生成封面图」勾选 +「补充要求」自由块。为 312px 配置栏重排:选项收敛为
 * 单行 chips(label 悬浮 title 显示说明)、维度 hint 收进标题悬浮提示;
 * 样例(选项节选/样例参照图库)已按 2026-10-22 验收反馈移除。
 * §13.8 机制(src/lib/topics/writing-config.ts):选项归选项、补充归补充:
 * - 选项卡只由点击驱动(setSelection),点选永不弹确认、永不销毁已写内容;
 * - 补充要求是独立自由块,保存时以【补充要求】头并入 positioning,原样
 *   verbatim 透传 AI;
 * - custom 仅=存量文本的体裁模板曾被手改(amber 提示核对,非死胡同——手改
 *   内容已被解析无损收进补充块);
 * - 「查看将交给 AI 的写作要求」可折叠预览合成结果(所见即所交)。
 * 保存 PATCH /api/topics/[id] {positioning};生成初稿服务端从同一文本派生
 * 体裁词与技能路由(带补充要求照常派生),无双入口漂移。
 */
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";

import type { ApiEnvelope } from "@/lib/http/response";
import {
  composeWritingText,
  parseWritingText,
  WRITING_DIMENSIONS,
  type WritingSelection,
} from "@/lib/topics/writing-config";

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
    <div className="flex flex-col gap-3.5">
      {WRITING_DIMENSIONS.map((dim) => (
        <div key={dim.key} className="flex flex-col gap-1.5">
          <span className="cursor-help text-[12px] font-semibold text-text-1" title={dim.hint}>
            {dim.title}
          </span>
          <div className="flex flex-wrap gap-1.5">
            {dim.options.map((opt) => {
              const active = opt.key === selection[dim.key];
              return (
                <button
                  key={opt.key}
                  type="button"
                  title={opt.desc}
                  onClick={() => select(dim, opt.key)}
                  className={
                    "rounded-sm px-2.5 py-1 text-[12px] " +
                    (active
                      ? "bg-accent/12 font-medium text-accent"
                      : "border border-line text-text-2 hover:border-text-3 hover:text-text-1")
                  }
                >
                  {opt.label}
                </button>
              );
            })}
          </div>
        </div>
      ))}

      <label
        className="flex cursor-pointer items-center gap-2 border-t border-line pt-3"
        title="勾选时,AI 生成文章初稿会同步生成封面候选(默认);重新生成文章前取消勾选,AI 将不再生成封面、保留现有封面。"
      >
        <input
          type="checkbox"
          checked={selection.cover !== "skip"}
          onChange={toggleCover}
          className="h-3.5 w-3.5 accent-[color:var(--accent)]"
        />
        <span className="text-[12px] text-text-1">生成封面图</span>
      </label>

      <div className="flex flex-col gap-1.5 border-t border-line pt-3">
        <span className="text-[12px] font-semibold text-text-1">补充要求</span>
        <textarea
          value={supplement}
          maxLength={500}
          rows={3}
          onChange={(e) => setSupplement(e.target.value)}
          placeholder="可选:选材偏好、口吻细节、特别强调等,原样交给 AI;上方选项怎么切换都不会覆盖这里…"
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
      </div>

      <div className="flex flex-wrap items-center gap-2">
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
  );
}
