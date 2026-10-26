"use client";

/**
 * 素材库筛选(2026-10-20 详情页重构文案;M42 放开电报文本):tab 切换
 * (电报/文章)+ 关键词回车检索,均以 searchParams 驱动服务端渲染
 * (?mount=<type>&q=<kw>&page=),页内状态不另持副本。
 */
import { useState } from "react";
import { useRouter } from "next/navigation";

export type MountTab = "telegram" | "post";

export default function TopicMountControls({
  topicId,
  tab,
  q,
}: {
  topicId: string;
  tab: MountTab;
  q: string;
}) {
  const router = useRouter();
  const [draft, setDraft] = useState(q);

  function href(nextTab: MountTab, nextQ: string): string {
    const sp = new URLSearchParams();
    sp.set("mount", nextTab);
    if (nextQ) sp.set("q", nextQ);
    const qs = sp.toString();
    return `/admin/studio/${topicId}/${qs ? `?${qs}` : ""}`;
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      {(["telegram", "post"] as const).map((t) => (
        <button
          key={t}
          type="button"
          onClick={() => router.push(href(t, ""))}
          className={`rounded-sm px-2.5 py-1 text-xs font-medium ${
            t === tab
              ? "bg-accent/12 text-accent"
              : "border border-line text-text-2 hover:text-text-1"
          }`}
        >
          {t === "telegram" ? "电报(视频需已解读)" : "文章"}
        </button>
      ))}
      <input
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") router.push(href(tab, draft.trim()));
        }}
        placeholder={tab === "telegram" ? "搜标题/博主,回车检索…" : "搜文章标题,回车检索…"}
        className="w-64 rounded-sm border border-line bg-panel px-2.5 py-1 text-[12px] outline-none focus:border-accent placeholder:text-text-3"
      />
    </div>
  );
}
