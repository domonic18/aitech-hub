"use client";

/**
 * 同步弹窗右侧正文预览(M17 主题扩展批⑧):POST preview 路由按主题渲染
 * 内联样式 HTML(与推送管线同一 renderWechatHtml 纯函数;图片仍为站内地址,
 * 推送时才转存微信)。主题切换即重取;首次响应回传生效主题(行快照 > 渠道
 * 默认)供弹窗高亮回显。白底容器:内联样式按浅色正文设计,与 admin 主题色无关。
 * dangerouslySetInnerHTML 内容来自自家渲染管线(markdown-it html:true 透传
 * 原生 HTML),输入为 admin 本人文章,与站点正文渲染同信任级别。
 */
import { useEffect, useState } from "react";

import type { ApiEnvelope } from "@/lib/http/response";

type PreviewBody = ApiEnvelope<{ html: string; theme: string } | null>;

export default function SyncWechatPreview({
  postId,
  theme,
  onTheme,
}: {
  postId: string;
  /** undefined = 未手动指定(服务端按 行快照 > 渠道默认 解析) */
  theme: string | undefined;
  /** 每次渲染成功回传生效主题(高亮回显;父组件需 useCallback 稳定传入) */
  onTheme?: (theme: string) => void;
}) {
  const [html, setHtml] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError(null);
    (async () => {
      try {
        const res = await fetch("/api/distribute/wechat/preview", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ postId, ...(theme ? { theme } : {}) }),
        });
        const body = (await res.json().catch(() => null)) as PreviewBody | null;
        if (!alive) return;
        if (!res.ok || body?.code !== 0 || !body.data) {
          setHtml(null);
          setError(body?.message ?? `预览失败(${res.status})`);
        } else {
          setHtml(body.data.html);
          onTheme?.(body.data.theme);
        }
      } catch {
        if (alive) {
          setHtml(null);
          setError("网络错误,预览不可用");
        }
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
    // onTheme 经父组件 useCallback 稳定;postId/theme 是唯一触发源
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [postId, theme]);

  return (
    <div className="flex min-h-0 flex-col">
      <div className="mb-1 flex items-center justify-between text-[11px] text-text-3">
        <span>正文预览(公众号样式)</span>
        {loading && <span className="text-accent">渲染中…</span>}
      </div>
      <div className="max-h-[52vh] flex-1 overflow-y-auto rounded-sm border border-line bg-white p-3">
        {error ? (
          <p className="font-mono text-xs text-red">{error}</p>
        ) : html !== null ? (
          <div dangerouslySetInnerHTML={{ __html: html }} />
        ) : (
          <p className="text-xs text-text-3">—</p>
        )}
      </div>
      <p className="mt-1 text-[10px] leading-relaxed text-text-3">
        预览图片为站内地址;推送时自动转存微信 CDN。
      </p>
    </div>
  );
}
