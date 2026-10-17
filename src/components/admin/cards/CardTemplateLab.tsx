"use client";
/**
 * 卡片模板调试台(M36 批①):preset 清单 + 示例数据编辑 + 双预览。
 * 实时预览 = renderPreset 客户端直出 HTML(纯函数,与 agent 同一 zod 校验
 * 口径)灌 iframe srcdoc(sandbox 空串=禁脚本,模板本无 JS);「渲染 PNG」
 * POST /api/card-presets/preview 走 card-renderer 真管线,所见即文章实际
 * 所出(字体/视口/高度口径全真)。
 */
import { useCallback, useMemo, useState } from "react";

import {
  CARD_PRESET_IDS,
  PRESET_META,
  PRESET_SAMPLE_DATA,
  renderPreset,
  type CardPresetId,
} from "@/lib/card/presets";

const THEME_LABEL = { dark: "深色系", light: "浅色系" } as const;

export default function CardTemplateLab(): React.ReactElement {
  const [active, setActive] = useState<CardPresetId>(CARD_PRESET_IDS[0]);
  /** 各卡型独立保留编辑中的数据文本,切卡型不丢 */
  const [texts, setTexts] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      CARD_PRESET_IDS.map((id) => [id, JSON.stringify(PRESET_SAMPLE_DATA[id], null, 2)]),
    ),
  );
  const [png, setPng] = useState<{ url: string; height: number } | null>(null);
  const [rendering, setRendering] = useState(false);
  const [renderError, setRenderError] = useState("");

  const text = texts[active] ?? "";
  // 逐键校验(数据量小无开销):合法即更新 srcdoc,报错人话直显
  const parsed = useMemo<{ doc: string | null; error: string }>(() => {
    let data: unknown;
    try {
      data = JSON.parse(text);
    } catch {
      return { doc: null, error: "JSON 语法错误" };
    }
    const r = renderPreset(active, data);
    return r.ok ? { doc: r.html, error: "" } : { doc: null, error: r.error };
  }, [active, text]);

  const onText = (t: string): void => setTexts((m) => ({ ...m, [active]: t }));

  const renderPng = useCallback(async () => {
    setRendering(true);
    setRenderError("");
    try {
      const res = await fetch("/api/card-presets/preview", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ preset: active, data: JSON.parse(texts[active]) }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { message?: string } | null;
        setRenderError(body?.message ?? `渲染失败(${res.status})`);
        return;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      setPng((prev) => {
        if (prev) URL.revokeObjectURL(prev.url);
        return { url, height: Number(res.headers.get("x-card-height")) || 0 };
      });
    } catch {
      setRenderError("渲染服务不可达(检查 card-renderer 服务)");
    } finally {
      setRendering(false);
    }
  }, [active, texts]);

  const meta = PRESET_META[active];
  return (
    <div className="grid gap-4 lg:grid-cols-[220px_1fr]">
      <nav className="flex flex-col gap-1.5" aria-label="卡型清单">
        {CARD_PRESET_IDS.map((id) => (
          <button
            key={id}
            type="button"
            onClick={() => setActive(id)}
            className={
              active === id
                ? "rounded-lg border border-accent bg-accent/10 px-3 py-2 text-left"
                : "rounded-lg border border-line px-3 py-2 text-left hover:bg-panel"
            }
          >
            <span className="text-sm font-medium">{PRESET_META[id].name}</span>
            <span className="mt-0.5 block text-xs text-text-3">{PRESET_META[id].desc}</span>
          </button>
        ))}
      </nav>
      <div className="flex min-w-0 flex-col gap-4">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-semibold">{meta.name}</span>
          <span className="rounded-full border border-line px-2 py-0.5 text-xs text-text-3">
            {THEME_LABEL[meta.theme]}
          </span>
          <span className="flex-1" />
          <button
            type="button"
            onClick={() => void renderPng()}
            disabled={rendering || parsed.doc === null}
            className="rounded-lg bg-accent px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50"
          >
            {rendering ? "渲染中…" : "渲染 PNG"}
          </button>
        </div>
        <div className="grid gap-4 xl:grid-cols-[360px_1fr]">
          <label className="flex flex-col gap-1">
            <span className="text-xs text-text-3">示例数据(JSON,zod 同口径校验)</span>
            <textarea
              value={text}
              onChange={(e) => onText(e.target.value)}
              spellCheck={false}
              className="h-96 w-full resize-y rounded-lg border border-line bg-panel p-3 font-mono text-xs"
            />
          </label>
          <div className="flex min-w-0 flex-col gap-3">
            {parsed.error ? (
              <p className="text-xs text-red-600">{parsed.error}</p>
            ) : (
              <iframe
                title="实时预览"
                sandbox=""
                srcDoc={parsed.doc ?? ""}
                className="h-96 w-full rounded-lg border border-line bg-white"
              />
            )}
            {renderError && <p className="text-xs text-red-600">PNG:{renderError}</p>}
            {png && (
              <div className="flex flex-col gap-1">
                <p className="text-xs text-text-3">真实管线出图(画布高 {png.height}px)</p>
                {/* eslint-disable-next-line @next/next/no-img-element -- 管理端内部预览,src 为本地 blob 动态路径 */}
                <img
                  src={png.url}
                  alt="PNG 预览"
                  className="w-full rounded-lg border border-line"
                />
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
