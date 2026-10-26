"use client";

/**
 * 裁剪模板卡网格(M14 批⑤):点卡切激活(定裁剪比例),勾选进导出集;
 * 缩略卡以源图 cover-fit 预览比例。
 */
import { COVER_TEMPLATES } from "./templates";

export default function CoverTemplateGrid({
  sourceUrl,
  activeKey,
  onActivate,
  checked,
  onToggleCheck,
  busy,
}: {
  /** 源图 url(blob URL 或站内路径,均同源可作背景) */
  sourceUrl: string;
  activeKey: string;
  onActivate: (key: string) => void;
  checked: Set<string>;
  onToggleCheck: (key: string) => void;
  busy: boolean;
}): React.ReactElement {
  return (
    <>
      <div className="text-xs font-medium text-text-2">裁剪模板</div>
      <div className="mt-2 grid grid-cols-2 gap-2">
        {COVER_TEMPLATES.map((t) => (
          <div
            key={t.key}
            role="button"
            tabIndex={0}
            onClick={() => onActivate(t.key)}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") onActivate(t.key);
            }}
            className={`relative cursor-pointer rounded-sm border p-1.5 ${
              activeKey === t.key ? "border-accent" : "border-line hover:border-line-hover"
            }`}
          >
            <span
              aria-hidden="true"
              className="block w-full rounded-sm border border-line bg-panel-2 bg-center"
              style={{
                aspectRatio: `${t.w} / ${t.h}`,
                backgroundImage: `url(${sourceUrl})`,
                backgroundSize: "cover",
              }}
            />
            <div className="mt-1 flex items-start gap-1">
              <input
                type="checkbox"
                className="mt-0.5 accent-[var(--accent)]"
                checked={checked.has(t.key)}
                onChange={() => onToggleCheck(t.key)}
                disabled={busy}
              />
              <div className="min-w-0">
                <div className="truncate text-[11px] font-medium text-text-1">{t.label}</div>
                <div className="truncate font-mono text-[10px] text-text-3">
                  {t.w}×{t.h}
                </div>
              </div>
            </div>
            <div className="mt-0.5 truncate text-[10px] text-text-3" title={t.use}>
              {t.use}
            </div>
          </div>
        ))}
      </div>
      <div className="mt-2 text-[10px] leading-relaxed text-text-3">
        点卡切换裁剪比例;勾选卡进导出集(多尺寸从同一选区 cover-fit 适配)
      </div>
    </>
  );
}
