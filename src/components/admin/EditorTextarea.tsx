"use client";

/**
 * 编辑器正文域(M5-b):markdown textarea + 截图粘贴直传(clipboard image →
 * POST /api/media → 光标处插入 `![截图](站内URL)`)+ 一键发文交接消费
 * (sessionStorage IMPORT_MD_STORE_KEY,由 ImportPostsModal 写入)。
 * 粘贴非图片内容不拦截,走浏览器默认行为。
 */
import { useEffect, useRef, useState } from "react";

import { IMPORT_MD_STORE_KEY } from "@/lib/media/import-md";
import { MEDIA_LIMITS } from "@/lib/media/media-schema";
import { uploadImageFile } from "@/lib/media/upload-client";

export default function EditorTextarea({
  value,
  onChange,
  imported,
}: {
  value: string;
  onChange: (md: string) => void;
  imported: boolean;
}): React.ReactElement {
  const taRef = useRef<HTMLTextAreaElement>(null);
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

  function insertAtCursor(text: string): void {
    const ta = taRef.current;
    if (!ta) {
      onChange(value + text);
      return;
    }
    const start = ta.selectionStart ?? value.length;
    const end = ta.selectionEnd ?? start;
    onChange(value.slice(0, start) + text + value.slice(end));
    requestAnimationFrame(() => {
      ta.selectionStart = ta.selectionEnd = start + text.length;
      ta.focus();
    });
  }

  async function onPaste(e: React.ClipboardEvent<HTMLTextAreaElement>): Promise<void> {
    const item = [...e.clipboardData.items].find((i) => i.type.startsWith("image/"));
    if (!item) return; // 文本粘贴不拦截
    e.preventDefault();
    const file = item.getAsFile();
    if (!file) return;
    if (file.size > MEDIA_LIMITS.maxUploadBytes) {
      setNote(`截图超过 ${MEDIA_LIMITS.maxUploadBytes / 1024 / 1024}MB,未上传`);
      return;
    }
    setNote("截图上传中…");
    const r = await uploadImageFile(file, file.name || "paste.png");
    if (r.ok) {
      insertAtCursor(`![截图](${r.path})`);
      setNote("截图已插入");
    } else {
      setNote(`截图上传失败(${r.error}),可在媒体库手动上传`);
    }
  }

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
      <textarea
        ref={taRef}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onPaste={(e) => void onPaste(e)}
        placeholder="正文(Markdown;支持直接粘贴截图自动上传)…"
        spellCheck={false}
        className="min-h-[520px] w-full resize-y bg-transparent p-4 font-mono text-[13px] leading-relaxed text-text-1 outline-none placeholder:text-text-3"
      />
    </div>
  );
}
