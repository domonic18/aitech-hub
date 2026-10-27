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

import { useToast } from "@/components/admin/Toast";
import { WECHAT_CONTENT_MAX_CHARS } from "@/lib/distribute/channels";
import { wechatTail } from "@/lib/distribute/channel-tails";
import { renderWechatHtml } from "@/lib/distribute/wechat-html";
import type { WechatParaStyle } from "@/lib/distribute/wechat-html";
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
  const { push } = useToast();
  /** 微信正文码点(M51 口径对齐:渠道主题/段落排版/目录卡 + 渠道尾注,与推送
   * 管线同源;配置拉取失败回退默认,差量仅内联样式与目录卡) */
  const [chars, setChars] = useState<number | null>(null);
  /** 渠道渲染配置(挂载拉取一次;失败回退默认,不阻塞编辑) */
  const [renderCfg, setRenderCfg] = useState({
    theme: WECHAT_THEME_DEFAULT,
    paraStyle: "default",
    enableTocMeta: false,
  });

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
      push("error", "导入交接数据损坏,请回列表重新导入");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 仅 mount/imported 变化时消费一次
  }, [imported]);

  // 渠道渲染配置:挂载拉取一次(编辑器与推送管线同口径的前提)
  useEffect(() => {
    let dead = false;
    fetch("/api/distribute/wechat-config")
      .then((res) => (res.ok ? res.json() : null))
      .then((json) => {
        const cfg = json?.data?.config;
        if (!dead && cfg) {
          setRenderCfg({
            theme: typeof cfg.theme === "string" && cfg.theme ? cfg.theme : WECHAT_THEME_DEFAULT,
            paraStyle: typeof cfg.paraStyle === "string" ? cfg.paraStyle : "default",
            enableTocMeta: cfg.enableTocMeta === true,
          });
        }
      })
      .catch(() => undefined); // 回退默认,不阻塞编辑
    return () => {
      dead = true;
    };
  }, []);

  // 码点计数防抖 300ms(与预览渲染同量级,长文 markdown-it 数毫秒)。
  // M51 口径对齐:+ 渠道尾注 + 渠道主题/段落排版/目录卡(推送管线同源)
  useEffect(() => {
    const t = setTimeout(() => {
      const { html } = renderWechatHtml(`${value}\n\n${wechatTail()}`, renderCfg.theme, {
        paraStyle: renderCfg.paraStyle as WechatParaStyle,
        tocMeta: renderCfg.enableTocMeta,
      });
      setChars([...html].length);
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
      <div className="flex items-baseline justify-end gap-1 px-1 pb-1 font-mono text-[11px]">
        {chars !== null && (
          <span
            title="按微信公众号推送同源口径预估(渠道主题/段落排版/目录卡+渠道尾注);超预算同步将被拒稿"
            className={over ? "text-red" : "text-text-3"}
          >
            微信正文 {chars.toLocaleString()} / {WECHAT_CONTENT_MAX_CHARS.toLocaleString()} 码点
            {over && "(超预算,请精简正文)"}
          </span>
        )}
      </div>
      <VditorEditor value={value} onChange={onChange} />
    </div>
  );
}
