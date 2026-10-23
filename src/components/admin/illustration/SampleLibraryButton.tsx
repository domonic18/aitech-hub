"use client";

/**
 * 工坊列表「样例图库管理」按钮(F13 工具栏位,创作域对齐批 2026-10-23):
 * 开 SampleLibraryModal(F8 弹层,增删改名即落库,关闭自动刷新列表)。
 */
import { useState } from "react";

import SampleLibraryModal from "@/components/admin/SampleLibraryModal";

export default function SampleLibraryButton(): React.ReactElement {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="cursor-pointer rounded-sm border border-line px-3 py-1.5 text-xs text-text-2 hover:text-text-1"
      >
        样例图库管理
      </button>
      <SampleLibraryModal open={open} onClose={() => setOpen(false)} />
    </>
  );
}
