"use client";

/**
 * Markdown 编辑器对外封装(M5-d):Vditor 为浏览器端库,经 dynamic(ssr:false) 分包。
 * 顺带承接 EditorTextarea 原有语义:一键发文交接(sessionStorage 由 ImportPostsModal
 * 写入,mount 消费一次)与图片上传提示条。
 */
import dynamic from "next/dynamic";
import { useEffect, useState } from "react";

import { IMPORT_MD_STORE_KEY } from "@/lib/media/import-md";

const VditorEditor = dynamic(() => import("./VditorEditor"), {
  ssr: false,
  loading: () => (
    <div className="flex h-[560px] items-center justify-center text-xs text-text-3">
      编辑器加载中…
    </div>
  ),
});

export default function MdEditor({
  value,
  onChange,
  imported,
}: {
  value: string;
  onChange: (md: string) => void;
  imported: boolean;
}): React.ReactElement {
  const [warnings, setWarnings] = useState<string[]>([]);
  const [note, setNote] = useState<string | null>(null);

  // 一键发文交接:mount 时消费一次,取完即删(刷新不重放)
  useEffect(() => {
    if (!imported) return;
    const raw = sessionStorage.getItem(IMPORT_MD_STORE_KEY);
    sessionStorage.removeItem(IMPORT_MD_STORE_KEY);
    if (!raw) return;
    try {
      const parsed = JSON.parse(raw) as { contentMd?: string; warnings?: string[] };
      if (typeof parsed.contentMd === "string") {
        onChange(parsed.contentMd);
        setWarnings(parsed.warnings ?? []);
      }
    } catch {
      setNote("导入交接数据损坏,请回列表重新导入");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 仅 mount/imported 变化时消费一次
  }, [imported]);

  return (
    <div>
      {warnings.length > 0 && (
        <div className="border-b border-line bg-panel-2 px-4 py-2 text-xs text-text-2">
          {warnings.map((w) => (
            <div key={w}>⚠ {w}</div>
          ))}
        </div>
      )}
      {note && (
        <div className="border-b border-line px-4 py-1.5 font-mono text-[11px] text-text-3">
          {note}
        </div>
      )}
      <VditorEditor value={value} onChange={onChange} onNote={setNote} />
    </div>
  );
}
