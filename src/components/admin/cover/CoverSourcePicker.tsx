"use client";

/**
 * 封面三源选图首屏(M5-d):本地上传 / 媒体库选用 / AI 生成三卡并列;
 * AI 源 M31 agent 化 = 唤起编辑页侧边栏(onAgent 缺省不出 AI 卡)。
 */
export default function CoverSourcePicker({
  hasAgent,
  onLocal,
  onMedia,
  onAgent,
}: {
  hasAgent: boolean;
  onLocal: () => void;
  onMedia: () => void;
  onAgent: () => void;
}): React.ReactElement {
  return (
    <div className={`mt-4 grid gap-3 ${hasAgent ? "sm:grid-cols-3" : "sm:grid-cols-2"}`}>
      <button
        type="button"
        onClick={onLocal}
        className="flex h-40 cursor-pointer flex-col items-center justify-center gap-2 rounded-sm border border-dashed border-line text-text-3 hover:border-accent hover:text-accent"
      >
        <svg className="ic-lg" aria-hidden="true">
          <use href="#i-cloudupload" />
        </svg>
        <span className="text-xs">本地上传(jpg / png / webp)</span>
        <span className="text-[11px]">将按模板比例交互裁剪</span>
      </button>
      <button
        type="button"
        onClick={onMedia}
        className="flex h-40 cursor-pointer flex-col items-center justify-center gap-2 rounded-sm border border-dashed border-line text-text-3 hover:border-accent hover:text-accent"
      >
        <svg className="ic-lg" aria-hidden="true">
          <use href="#i-picture" />
        </svg>
        <span className="text-xs">从媒体库选图</span>
        <span className="text-[11px]">复用已上传素材,无需重复占用空间</span>
      </button>
      {hasAgent && (
        <button
          type="button"
          onClick={onAgent}
          className="flex h-40 cursor-pointer flex-col items-center justify-center gap-2 rounded-sm border border-dashed border-line text-text-3 hover:border-accent hover:text-accent"
        >
          <svg className="ic-lg" aria-hidden="true">
            <use href="#i-robot" />
          </svg>
          <span className="text-xs">AI 生成封面(Agent)</span>
          <span className="text-[11px]">侧边栏对齐方向 → 候选确认入库</span>
        </button>
      )}
    </div>
  );
}
