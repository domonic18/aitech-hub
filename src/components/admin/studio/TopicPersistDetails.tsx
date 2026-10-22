"use client";

/**
 * 素材库折叠容器(2026-10-20 详情页重构):开合态由客户端持有——服务端
 * <details open={零素材}> 只反映首渲染,添加素材后 router.refresh() 会把
 * items 翻成 1 而收起容器,连加 2~3 条素材每加一条就被折叠一次( 测出)。
 * useState 仅初始化一次,refresh 重渲染不重置,手动开合后保持用户选择。
 */
import { useState, type ReactNode } from "react";

export default function TopicPersistDetails({
  defaultOpen,
  summary,
  children,
}: {
  defaultOpen: boolean;
  summary: string;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <details open={open} onToggle={(e) => setOpen((e.target as HTMLDetailsElement).open)}>
      <summary className="cursor-pointer text-[13px] font-medium text-text-2 hover:text-text-1">
        {summary}
      </summary>
      {children}
    </details>
  );
}
