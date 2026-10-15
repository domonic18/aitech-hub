"use client";

/**
 * 三源选择钮行(技术债批⑤,自 ImportPostsModal 抽出):选 md / 选择文件夹
 * (自动配图)/ 追加图片;行尾内联错误提示。文件 input 与回调由弹窗持有。
 */
export default function ImportSourceButtons({
  hasMd,
  running,
  error,
  onPickMd,
  onPickDir,
  onPickImages,
}: {
  hasMd: boolean;
  running: boolean;
  error: string | null;
  onPickMd: () => void;
  onPickDir: () => void;
  onPickImages: () => void;
}): React.ReactElement {
  const btnCls =
    "inline-flex cursor-pointer items-center gap-1.5 rounded-sm border border-line bg-panel-2 px-3 py-2 text-[13px] text-text-2 hover:border-line-hover hover:text-text-1 disabled:opacity-60";
  return (
    <div className="mt-3 flex items-center gap-2">
      <button type="button" disabled={running} onClick={onPickMd} className={btnCls}>
        <svg className="ic" aria-hidden="true">
          <use href="#i-paperclip" />
        </svg>
        {hasMd ? "重选 md" : "选择 md"}
      </button>
      <button type="button" disabled={running} onClick={onPickDir} className={btnCls}>
        <svg className="ic" aria-hidden="true">
          <use href="#i-folder" />
        </svg>
        选择文件夹(自动配图)
      </button>
      <button type="button" disabled={running} onClick={onPickImages} className={btnCls}>
        <svg className="ic" aria-hidden="true">
          <use href="#i-picture" />
        </svg>
        添加图片
      </button>
      {error && <span className="text-xs text-red">{error}</span>}
    </div>
  );
}
