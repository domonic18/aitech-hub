"use client";

/**
 * 正文卡(技术债批③,自 PostEditor 抽出):编辑/前台预览双 Tab,Tab 态纯本地。
 * 「前台预览」复用线上渲染链 ArticleBody(react-markdown + GFM + 高亮)——
 * Vditor 内置预览与其有细微差异,发布前以此做最终核对(单一渲染链不变式)。
 */
import { useState } from "react";

import MdEditor from "@/components/admin/MdEditor";
import ArticleBody from "@/components/article/ArticleBody";

export default function EditorBodyCard({
  value,
  onChange,
  imported,
}: {
  value: string;
  onChange: (md: string) => void;
  /** 一键发文交接(/admin/posts/new?import=1):EditorTextarea mount 时消费 sessionStorage */
  imported: boolean;
}): React.ReactElement {
  const [tab, setTab] = useState<"edit" | "preview">("edit");
  return (
    <div className="flex flex-col rounded-md border border-line bg-panel">
      <div className="flex border-b border-line text-xs">
        {(["edit", "preview"] as const).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            className={`cursor-pointer border-r border-line px-4 py-2 ${
              tab === t ? "bg-accent-dim font-semibold text-accent" : "text-text-2 hover:bg-panel-2"
            }`}
          >
            {t === "edit" ? "编辑(分屏)" : "前台预览"}
          </button>
        ))}
      </div>

      {tab === "edit" ? (
        <MdEditor value={value} onChange={onChange} imported={imported} />
      ) : (
        <div className="min-h-[520px] max-h-[720px] overflow-y-auto p-4">
          <ArticleBody contentMd={value} contentHtml={null} />
        </div>
      )}
    </div>
  );
}
