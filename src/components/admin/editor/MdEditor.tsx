"use client";

/**
 * Markdown 编辑器对外封装(M5-d):Vditor 为浏览器端库,经 dynamic(ssr:false) 分包。
 * 顺带承接 EditorTextarea 原有语义:一键发文交接(sessionStorage 由 ImportPostsModal
 * 写入,mount 消费一次)与图片上传提示条。
 * 右上角微信码点计数(2026-10-07 反馈):与公众号同步同口径实时预估
 * ([...renderWechatHtml(md).html].length,we sync 同函数),超预算变红——
 * 微信侧超 20000 码点直接拒稿,编辑期发现比同步失败返工早一步。
 */
import dynamic from "next/dynamic";
import { useEffect, useState } from "react";

import { WECHAT_CONTENT_MAX_CHARS } from "@/lib/distribute/channels";
import { renderWechatHtml } from "@/lib/distribute/wechat-html";
import { WECHAT_THEME_DEFAULT } from "@/lib/distribute/wechat-themes";
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
  /** 微信正文码点(按默认主题渲染后计数;渠道实际主题差异仅内联样式,量级可忽略) */
  const [chars, setChars] = useState<number | null>(null);

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

  // 码点计数防抖 300ms(与预览渲染同量级,长文 markdown-it 数毫秒)
  useEffect(() => {
    const t = setTimeout(() => {
      setChars([...renderWechatHtml(value, WECHAT_THEME_DEFAULT).html].length);
    }, 300);
    return () => clearTimeout(t);
  }, [value]);

  const over = chars !== null && chars > WECHAT_CONTENT_MAX_CHARS;

  return (
    <div className="flex flex-1 flex-col">
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
      <div className="flex items-baseline justify-end gap-1 px-1 pb-1 font-mono text-[11px]">
        {chars !== null && (
          <span
            title="按微信公众号正文口径预估(默认主题渲染后码点数);超预算同步将被拒稿"
            className={over ? "text-red" : "text-text-3"}
          >
            微信正文 {chars.toLocaleString()} / {WECHAT_CONTENT_MAX_CHARS.toLocaleString()} 码点
            {over && "(超预算,请精简正文)"}
          </span>
        )}
      </div>
      <VditorEditor value={value} onChange={onChange} onNote={setNote} />
    </div>
  );
}
