"use client";

/**
 * 添加素材弹层(v2 工作台,替代原详情页内嵌折叠库):触发钮常驻素材栏底部,
 * 弹层内容(页签/检索/候选表/翻页)由详情页服务端渲染后作 children 传入——
 * searchParams 驱动取数不变,弹层只持开合态。defaultOpen 供 ?mount= 深链直开;
 * 添加成功后 router.refresh() 只换 children,弹层保持打开可连加。
 */
import { useEffect, useState, type ReactNode } from "react";

export default function StudioMaterialModal({
  defaultOpen = false,
  children,
}: {
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="w-full cursor-pointer rounded-sm border border-dashed border-line py-2 text-xs font-medium text-text-2 hover:border-accent hover:text-accent"
      >
        添加素材
      </button>
    );
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(false)}
        className="w-full cursor-pointer rounded-sm border border-accent py-2 text-xs font-medium text-accent hover:bg-accent/12"
      >
        添加素材
      </button>
      <div className="fixed inset-0 z-50">
        <div
          className="absolute inset-0 bg-black/45"
          onClick={() => setOpen(false)}
          aria-hidden="true"
        />
        <div className="absolute left-1/2 top-1/2 flex max-h-[82vh] w-[720px] max-w-[94vw] -translate-x-1/2 -translate-y-1/2 flex-col rounded-sm border border-line bg-panel shadow-2xl">
          <div className="flex items-center gap-2.5 border-b border-line px-4 py-3">
            <h3 className="text-[14px] font-semibold">添加素材</h3>
            <span className="text-[11px] text-text-3">解读视频 / 电报图文 / 站内文章</span>
            <button
              type="button"
              aria-label="关闭"
              onClick={() => setOpen(false)}
              className="ml-auto cursor-pointer text-text-3 hover:text-text-1"
            >
              <svg className="ic" style={{ width: 16, height: 16 }} aria-hidden="true">
                <use href="#i-close" />
              </svg>
            </button>
          </div>
          <div className="flex-1 overflow-y-auto px-4 py-3">{children}</div>
        </div>
      </div>
    </>
  );
}
