"use client";

/**
 * 配图工坊·编辑面板(M40 批 B):三回路统一表单(改字必选/消除/重绘)+
 * 候选预览确认制——生成只出预览候选,「确认存为版本」才落版本链,放弃即闲置。
 */
import { EDIT_MODES, type EditMode, type NormalizedBbox } from "./labels";

export default function EditPanel({
  mode,
  bbox,
  instruction,
  busy,
  previewPath,
  error,
  confirming,
  hasReadyGroup,
  onMode,
  onInstruction,
  onSubmit,
  onConfirm,
  onDiscard,
}: {
  mode: EditMode;
  bbox: NormalizedBbox | null;
  instruction: string;
  busy: boolean;
  /** 候选整图站内路径(null=无预览) */
  previewPath: string | null;
  error: string | null;
  confirming: boolean;
  hasReadyGroup: boolean;
  onMode: (m: EditMode) => void;
  onInstruction: (v: string) => void;
  onSubmit: () => void;
  onConfirm: () => void;
  onDiscard: () => void;
}): React.ReactElement {
  const current = EDIT_MODES.find((m) => m.key === mode) ?? EDIT_MODES[0];
  const needInstruction = mode !== "erase";
  const canSubmit =
    !busy &&
    previewPath === null &&
    bbox !== null &&
    (!needInstruction || instruction.trim() !== "");
  return (
    <section className="flex flex-col gap-2 rounded-md border border-line bg-panel-1 p-3">
      <h2 className="text-xs font-medium text-text-2">编辑</h2>
      <div className="flex gap-1">
        {EDIT_MODES.map((m) => (
          <button
            key={m.key}
            type="button"
            disabled={busy}
            onClick={() => onMode(m.key)}
            className={`flex-1 cursor-pointer rounded-sm px-2 py-1.5 text-[11px] font-medium disabled:cursor-not-allowed disabled:opacity-60 ${
              mode === m.key ? "bg-accent text-white" : "bg-panel-2 text-text-2 hover:bg-panel-2/70"
            }`}
          >
            {m.label}
          </button>
        ))}
      </div>
      <p className="text-[10px] leading-relaxed text-text-3">{current.tip}</p>
      <div className="flex items-center justify-between rounded-sm bg-panel-2 px-2 py-1.5 text-[11px]">
        {bbox ? (
          <>
            <span className="font-mono text-text-1">
              bbox {bbox[0]} {bbox[1]} {bbox[2]} {bbox[3]}
            </span>
            <span className="text-text-3">画布拖选/点图层可改</span>
          </>
        ) : (
          <span className="text-text-3">先在画布拖选区域,或点击图层带入其范围</span>
        )}
      </div>
      <textarea
        value={instruction}
        disabled={busy || previewPath !== null}
        onChange={(e) => onInstruction(e.target.value)}
        rows={2}
        maxLength={500}
        placeholder={
          mode === "text"
            ? "新文字(必填,逐字给出)"
            : mode === "redraw"
              ? "重绘内容描述(必填)"
              : "补充说明(可空)"
        }
        className="w-full resize-y rounded-sm border border-line bg-bg px-2 py-1.5 text-[11px] text-text-1 placeholder:text-text-3 focus:border-accent focus:outline-none disabled:opacity-60"
      />
      {previewPath ? (
        <div className="flex flex-col gap-2">
          {/* eslint-disable-next-line @next/next/no-img-element -- 候选整图站内路径直出 */}
          <img
            src={previewPath}
            alt="编辑候选预览"
            className="w-full rounded-sm border border-line"
          />
          <div className="flex gap-2">
            <button
              type="button"
              disabled={confirming}
              onClick={onConfirm}
              className="flex-1 cursor-pointer rounded-sm bg-accent px-2 py-1.5 text-[11px] font-medium text-white hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-60"
            >
              {confirming ? "保存中…" : "✓ 确认存为新版本"}
            </button>
            <button
              type="button"
              disabled={confirming}
              onClick={onDiscard}
              className="cursor-pointer rounded-sm border border-line bg-panel-2 px-2 py-1.5 text-[11px] text-text-2 hover:bg-panel-1 disabled:opacity-60"
            >
              放弃
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          disabled={!canSubmit}
          onClick={onSubmit}
          className="cursor-pointer rounded-sm bg-accent px-2 py-2 text-[11px] font-medium text-white hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-60"
        >
          {busy ? "生成候选中(约 15 秒)…" : `生成候选预览(${current.label})`}
        </button>
      )}
      {error && <p className="text-[11px] leading-relaxed text-red">{error}</p>}
      {!hasReadyGroup && (
        <p className="text-[10px] leading-relaxed text-text-3">
          提示:未拆层也可直接框选编辑;拆层后点选图层可精准取范围。
        </p>
      )}
    </section>
  );
}
