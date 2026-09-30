"use client";

/** 一键发文入口(文章列表工具条):按钮 + 导入弹窗的挂载壳,状态内聚,页面保持 RSC */
import { useState } from "react";

import ImportPostsModal from "./ImportPostsModal";

export default function ImportPostsButton(): React.ReactElement {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex cursor-pointer items-center gap-1.5 rounded-sm border border-line bg-panel px-3 py-2 text-sm text-text-2 hover:border-line-hover hover:text-text-1"
      >
        <svg className="ic" aria-hidden="true">
          <use href="#i-cloudupload" />
        </svg>
        一键发文(md 导入)
      </button>
      {open && <ImportPostsModal onClose={() => setOpen(false)} />}
    </>
  );
}
