"use client";

/**
 * 文章「列表 ⇄ 封面卡片」视图切换(M12 问题四,2026-10-05 反馈):两个视图都是
 * 服务端渲染好的 ReactNode(client 岛只管显隐切换),默认列表视图——SSR HTML 即
 * 列表,SEO/LCP 不受影响;选择存 localStorage 记忆,水合后恢复;切换纯显隐、
 * 零二次请求。行业惯例口径:视图记忆是个人偏好,不进 URL(可分享的筛选走
 * /category、/tag 路由)。
 */
import { useEffect, useState, type ReactNode } from "react";

type ViewKind = "list" | "cards";

const STORAGE_KEY = "articles-view";

const VIEWS: ReadonlyArray<{ kind: ViewKind; icon: string; label: string }> = [
  { kind: "list", icon: "i-bars", label: "列表视图" },
  { kind: "cards", icon: "i-appstore", label: "卡片视图" },
];

export default function PostViewToggle({
  list,
  cards,
}: {
  list: ReactNode;
  cards: ReactNode;
}): React.ReactElement {
  const [view, setView] = useState<ViewKind>("list");
  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(STORAGE_KEY);
      if (saved === "cards" || saved === "list") setView(saved);
    } catch {
      /* 存储不可用(隐私模式等):保持默认列表 */
    }
  }, []);
  const pick = (kind: ViewKind): void => {
    setView(kind);
    try {
      window.localStorage.setItem(STORAGE_KEY, kind);
    } catch {
      /* 仅本次会话内生效 */
    }
  };
  return (
    <div>
      <div className="flex justify-end">
        <div
          className="inline-flex overflow-hidden rounded-sm border border-line"
          role="group"
          aria-label="列表视图切换"
        >
          {VIEWS.map((v) => (
            <button
              key={v.kind}
              type="button"
              aria-pressed={view === v.kind}
              title={v.label}
              onClick={() => pick(v.kind)}
              className={`flex cursor-pointer items-center px-2.5 py-1.5 transition-colors ${
                view === v.kind
                  ? "bg-accent text-white"
                  : "bg-panel text-text-3 hover:bg-panel-2 hover:text-text-1"
              }`}
            >
              <svg className="ic" aria-hidden="true">
                <use href={`#${v.icon}`} />
              </svg>
            </button>
          ))}
        </div>
      </div>
      <div className={view === "list" ? "" : "hidden"}>{list}</div>
      <div className={view === "cards" ? "mt-4" : "mt-4 hidden"}>{cards}</div>
    </div>
  );
}
