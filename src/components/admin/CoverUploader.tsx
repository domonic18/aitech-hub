"use client";

/**
 * 右侧栏封面卡(M5-d 用户反馈:对齐 WordPress 精选图像交互):有封面 = 缩略图 +
 * 悬浮「更换/移除」;无封面 = 虚线设置框。路径/尺寸模板/裁剪等技术细节全部收进
 * 点击弹出的 CoverDialog,右侧栏不出现任何路径文本。移除即清空(未保存前可重设)。
 */
import { useState } from "react";

import CoverDialog from "./CoverDialog";

export default function CoverUploader({
  coverPath,
  onChange,
}: {
  coverPath: string;
  onChange: (path: string) => void;
}): React.ReactElement {
  const [open, setOpen] = useState(false);

  return (
    <div>
      <div className="mb-1 text-xs text-text-2">封面</div>
      {coverPath ? (
        // 点击缩略图重开设置弹窗;更换/移除悬浮在图上(移动端无 hover 时点图亦可进弹窗)
        <div className="group relative overflow-hidden rounded-sm border border-line">
          {/* eslint-disable-next-line @next/next/no-img-element -- 管理端内部预览,src 为站内动态路径 */}
          <img
            src={coverPath}
            alt="封面预览"
            title="点击更换封面"
            onClick={() => setOpen(true)}
            className="h-28 w-full cursor-pointer object-cover"
          />
          <div className="absolute inset-0 hidden items-center justify-center gap-2 bg-black/40 group-hover:flex">
            <button
              type="button"
              className="cursor-pointer rounded-sm bg-panel px-2.5 py-1 text-xs text-text-1 hover:bg-panel-2"
              onClick={() => setOpen(true)}
            >
              更换
            </button>
            <button
              type="button"
              className="cursor-pointer rounded-sm bg-panel px-2.5 py-1 text-xs text-red hover:bg-panel-2"
              onClick={() => onChange("")}
            >
              移除
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="flex h-28 w-full cursor-pointer flex-col items-center justify-center gap-1 rounded-sm border border-dashed border-line text-text-3 hover:border-accent hover:text-accent"
        >
          <svg className="ic-lg" aria-hidden="true">
            <use href="#i-picture" />
          </svg>
          <span className="text-xs">设置封面</span>
          <span className="text-[11px]">上传后自动裁剪各平台尺寸</span>
        </button>
      )}
      {open && <CoverDialog onClose={() => setOpen(false)} onSet={onChange} />}
    </div>
  );
}
