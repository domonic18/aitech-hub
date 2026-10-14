"use client";

/**
 * 带点击上报的站内 Link(M28 批①):供 Server Component(首页 rail 卡)包装
 * next/link,onClick 时机发条目点击 beacon。ref 命名避让 React 保留 prop
 * (传 entryKey);外链锚在 client 组件内直接调 trackEntryClick,不经本件。
 */
import Link from "next/link";
import type { ReactNode } from "react";

import { trackEntryClick, type ClickKind, type ClickSurface } from "@/lib/stats/track-click";

export default function TrackedLink({
  href,
  surface,
  kind,
  entryKey,
  className,
  children,
}: {
  href: string;
  surface: ClickSurface;
  kind: ClickKind;
  /** 条目键(project=slug / post=id 文本) */
  entryKey: string;
  className?: string;
  children: ReactNode;
}): React.ReactElement {
  return (
    <Link
      href={href}
      className={className}
      onClick={() => trackEntryClick({ surface, kind, ref: entryKey, target: href })}
    >
      {children}
    </Link>
  );
}
