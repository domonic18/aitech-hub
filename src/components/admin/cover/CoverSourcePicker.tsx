"use client";

/**
 * 封面两源选图首屏(M5-d):本地上传 / 媒体库选用两卡并列。
 *
 * 第三源「AI 生成」2026-11-15 下线(D3/B3):原先唤起编辑页侧边栏 agent 做
 * 方向对齐与候选确认;站内创作职责外移线下后,该入口改为编辑器顶栏的
 * 「封面 AI」按钮(走 HTTP 触发面,见 CoverCandidatesPanel),本弹窗只管
 * 选图与裁剪导出。
 */
export default function CoverSourcePicker({
  onLocal,
  onMedia,
}: {
  onLocal: () => void;
  onMedia: () => void;
}): React.ReactElement {
  return (
    <div className="mt-4 grid gap-3 sm:grid-cols-2">
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
    </div>
  );
}
